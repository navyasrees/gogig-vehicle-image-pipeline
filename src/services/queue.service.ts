import { Queue } from "bullmq";
import { env } from "../config/env";

export const IMAGE_QUEUE_NAME = "image-processing";

export interface ImageJobData {
  imageId: string;
}

// Single shared Queue instance — reused across the app lifetime.
// The worker connects to the same queue by name from its own process.
export const imageQueue = new Queue<ImageJobData>(IMAGE_QUEUE_NAME, {
  connection: {
    host: env.redis.host,
    port: env.redis.port,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: 100, // keep last 100 completed jobs in Redis
    removeOnFail: 200,     // keep last 200 failed jobs for inspection
  },
});

/**
 * Adds an image processing job to the queue.
 * Returns the BullMQ Job so callers can log the job ID if needed.
 */
export async function addImageJob(imageId: string) {
  return imageQueue.add(
    "process-image",
    { imageId },
    { jobId: imageId } // idempotent: same imageId won't be queued twice
  );
}
