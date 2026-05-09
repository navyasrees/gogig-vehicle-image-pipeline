import { Worker, Job } from "bullmq";
import { prisma } from "../db/prisma.client";
import { IMAGE_QUEUE_NAME, ImageJobData } from "../services/queue.service";
import { env } from "../config/env";
import { CheckResult } from "../types/index";
import { blurCheck } from "../checks/blur.check";
import { brightnessCheck } from "../checks/brightness.check";
import { duplicateCheck } from "../checks/duplicate.check";
import { dimensionsCheck } from "../checks/dimensions.check";
import { screenshotCheck } from "../checks/screenshot.check";
import { numberplateCheck } from "../checks/numberplate.check";
import { tamperCheck } from "../checks/tamper.check";

// ---------------------------------------------------------------------------
// Check registry
//
// Each entry pairs a stable name with the check function.
// The name is the fallback for error normalization: if a check throws, we
// can't read CheckResult.checkName from a value that never resolved.
//
// IMPORTANT: duplicate check is intentionally absent here — it needs imageId,
// which is only available at job-execution time. It is injected inside the
// job processor using a closure. See buildChecks() below.
// ---------------------------------------------------------------------------
interface CheckEntry {
  name: string;
  run: (filepath: string) => Promise<CheckResult>;
}

// Static checks: filepath is the only input needed
const STATIC_CHECKS: CheckEntry[] = [
  { name: "blur",        run: blurCheck },
  { name: "brightness",  run: brightnessCheck },
  { name: "dimensions",  run: dimensionsCheck },
  { name: "screenshot",  run: screenshotCheck },
  { name: "numberplate", run: numberplateCheck },
  { name: "tamper",      run: tamperCheck },
];

/**
 * Builds the full check list for a specific job.
 * Duplicate check is constructed here so its closure captures the imageId
 * at the right scope — not at module load time.
 */
function buildChecks(imageId: string): CheckEntry[] {
  return [
    ...STATIC_CHECKS,
    {
      name: "duplicate",
      run: (filepath: string) => duplicateCheck(filepath, imageId),
    },
  ];
}

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------
function normalizeSettled(
  settled: PromiseSettledResult<CheckResult>[],
  checks: CheckEntry[]
): CheckResult[] {
  return settled.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const reason = result.reason;
    const message =
      reason instanceof Error
        ? `Check failed to execute: ${reason.message}`
        : `Check failed to execute: ${String(reason)}`;

    return {
      checkName: checks[i].name,
      passed: false,
      confidence: 0,
      message,
    };
  });
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
const worker = new Worker<ImageJobData>(
  IMAGE_QUEUE_NAME,
  async (job: Job<ImageJobData>) => {
    const { imageId } = job.data;

    // 1. Fetch image — if not found, discard without retry.
    //    Retrying will never fix a missing record; it just wastes attempts.
    const image = await prisma.image.findUnique({ where: { id: imageId } });
    if (!image) {
      await job.log(`Image ${imageId} not found in DB — discarding job, no retry`);
      return;
    }

    // 2. Mark as processing
    await prisma.image.update({
      where: { id: imageId },
      data: { status: "processing" },
    });

    try {
      // 3. Build check list for this job (injects imageId into duplicate check)
      const checks = buildChecks(imageId);

      // 4. Run all 7 checks concurrently.
      //    Promise.allSettled never rejects — a crashing check doesn't abort the others.
      const settled = await Promise.allSettled(
        checks.map((c) => c.run(image.filepath))
      );

      // 5. Normalise: fulfilled results pass through, rejected ones become a
      //    { passed: false, confidence: 0 } CheckResult so every check always
      //    has a row in analysis_results.
      const results = normalizeSettled(settled, checks);

      // 6. Persist all results in one batch insert
      await prisma.analysisResult.createMany({
        data: results.map((r) => ({
          imageId,
          checkName: r.checkName,
          passed: r.passed,
          confidence: r.confidence,
          message: r.message,
        })),
      });

      // 7. Mark as completed
      await prisma.image.update({
        where: { id: imageId },
        data: { status: "completed" },
      });

      await job.log(
        `Completed ${results.length}/7 checks for image ${imageId}. ` +
          `Passed: ${results.filter((r) => r.passed).length}`
      );
    } catch (err) {
      // Unexpected failure (DB down, file unreadable, etc.).
      // Record reason on the Image row, then rethrow so BullMQ applies retries.
      const reason = err instanceof Error ? err.message : "Unknown worker error";

      await prisma.image
        .update({
          where: { id: imageId },
          data: { status: "failed", failureReason: reason },
        })
        .catch((updateErr) => {
          // If this update also fails (DB is down), log and move on.
          // Rethrowing updateErr would swallow the original error.
          console.error(
            `[worker] Failed to update image ${imageId} to failed status:`,
            updateErr
          );
        });

      throw err; // rethrow → BullMQ applies exponential backoff retries
    }
  },
  {
    connection: {
      host: env.redis.host,
      port: env.redis.port,
    },
    concurrency: env.worker.concurrency,
  }
);

// ---------------------------------------------------------------------------
// Worker lifecycle events
// ---------------------------------------------------------------------------
worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed (imageId: ${job.data.imageId})`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[worker] Job ${job?.id} failed (imageId: ${job?.data.imageId}):`,
    err.message
  );
});

worker.on("error", (err) => {
  console.error("[worker] Worker error:", err);
});

console.log(
  `[worker] Listening on queue "${IMAGE_QUEUE_NAME}" (concurrency: ${env.worker.concurrency})...`
);
