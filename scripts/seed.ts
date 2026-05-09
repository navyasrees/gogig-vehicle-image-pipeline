/**
 * Seed script — uploads sample images and prints check results.
 *
 * Usage:
 *   npm run seed
 *
 * Prerequisites:
 *   - Server running on localhost:3000 (npm run dev)
 *   - Sample images present in samples/
 */

import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";
const WAIT_SECONDS = 15;

// ---------------------------------------------------------------------------
// Sample image manifest
// ---------------------------------------------------------------------------
interface Sample {
  filepath: string;
  label: string;
}

const SAMPLES: Sample[] = [
  {
    filepath: "samples/vehicle-1.jpg",
    label: "Normal vehicle (MH20DV2366)",
  },
  {
    filepath: "samples/vehicle-1.jpg",
    label: "Duplicate of vehicle-1 (should trigger duplicate check)",
  },
  {
    filepath: "samples/blurred-vehicle-image.jpeg",
    label: "Blurry vehicle",
  },
  {
    filepath: "samples/dark-vehicle.jpg",
    label: "Dark/low light vehicle",
  },
  {
    filepath: "samples/no-number-plate.webp",
    label: "No number plate",
  },
  {
    filepath: "samples/vehicle-screenshot.png",
    label: "Screenshot",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface UploadResponse {
  id: string;
  status: string;
}

interface CheckResult {
  checkName: string;
  passed: boolean;
  confidence: number;
  message: string | null;
}

interface ResultsResponse {
  id: string;
  status: string;
  results: CheckResult[];
}

interface ErrorResponse {
  error: string;
}

interface UploadedImage {
  id: string;
  label: string;
  filename: string;
  status: "uploaded" | "failed";
}

interface ProcessedImage extends UploadedImage {
  results: CheckResult[];
  processingStatus: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CHECK_NAMES = [
  "blur",
  "brightness",
  "dimensions",
  "duplicate",
  "screenshot",
  "numberplate",
  "tamper",
];

function mimeTypeFromExt(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
  };
  return map[ext] ?? "application/octet-stream";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function printSeparator(widths: number[]): void {
  console.log("+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+");
}

function printRow(cells: string[], widths: number[]): void {
  const row = cells.map((cell, i) => ` ${pad(cell, widths[i])} `).join("|");
  console.log("|" + row + "|");
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
async function uploadImage(sample: Sample): Promise<UploadedImage> {
  const filename = path.basename(sample.filepath);
  const absPath = path.resolve(sample.filepath);

  if (!fs.existsSync(absPath)) {
    console.error(`  ✗ File not found: ${absPath}`);
    return { id: "", label: sample.label, filename, status: "failed" };
  }

  const fileBuffer = fs.readFileSync(absPath);
  const mimeType = mimeTypeFromExt(sample.filepath);
  const blob = new Blob([fileBuffer], { type: mimeType });

  const form = new FormData();
  form.append("image", blob, filename);

  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const err = (await res.json()) as ErrorResponse;
      console.error(`  ✗ Upload failed (${res.status}): ${err.error}`);
      return { id: "", label: sample.label, filename, status: "failed" };
    }

    const body = (await res.json()) as UploadResponse;
    console.log(`  ✓ Uploaded  id=${body.id}  file=${filename}`);
    return { id: body.id, label: sample.label, filename, status: "uploaded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Network error: ${message}`);
    return { id: "", label: sample.label, filename, status: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Fetch results
// ---------------------------------------------------------------------------
async function fetchResults(image: UploadedImage): Promise<ProcessedImage> {
  try {
    const res = await fetch(`${BASE_URL}/results/${image.id}`);

    if (res.status === 400) {
      // Processing not complete — fetch status instead
      const statusRes = await fetch(`${BASE_URL}/status/${image.id}`);
      const statusBody = (await statusRes.json()) as { status: string };
      console.error(
        `  ✗ ${image.label}: still not complete after ${WAIT_SECONDS}s (status: ${statusBody.status})`
      );
      return { ...image, results: [], processingStatus: statusBody.status };
    }

    if (!res.ok) {
      const err = (await res.json()) as ErrorResponse;
      console.error(`  ✗ ${image.label}: failed to fetch results — ${err.error}`);
      return { ...image, results: [], processingStatus: "unknown" };
    }

    const body = (await res.json()) as ResultsResponse;
    console.log(`  ✓ ${image.label}: ${body.results.length} check(s) returned`);
    return { ...image, results: body.results, processingStatus: body.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Network error fetching results: ${message}`);
    return { ...image, results: [], processingStatus: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------
function printSummaryTable(images: ProcessedImage[]): void {
  const LABEL_WIDTH = 48;
  const CHECK_WIDTH = 11;

  const colWidths = [LABEL_WIDTH, ...CHECK_NAMES.map(() => CHECK_WIDTH)];
  const headers = ["Image / Label", ...CHECK_NAMES];

  console.log("\n" + "═".repeat(colWidths.reduce((a, b) => a + b + 3, 1)));
  console.log("  RESULTS SUMMARY");
  console.log("═".repeat(colWidths.reduce((a, b) => a + b + 3, 1)));

  printSeparator(colWidths);
  printRow(headers, colWidths);
  printSeparator(colWidths);

  for (const image of images) {
    if (image.status === "failed") {
      const row = [
        `${image.label} [UPLOAD FAILED]`,
        ...CHECK_NAMES.map(() => "—"),
      ];
      printRow(row, colWidths);
      continue;
    }

    if (image.results.length === 0) {
      const row = [
        `${image.label} [${image.processingStatus.toUpperCase()}]`,
        ...CHECK_NAMES.map(() => "?"),
      ];
      printRow(row, colWidths);
      continue;
    }

    // Build a map so we can look up by checkName regardless of order
    const resultMap = new Map(image.results.map((r) => [r.checkName, r]));

    const cells = CHECK_NAMES.map((name) => {
      const result = resultMap.get(name);
      if (!result) return "missing";
      return result.passed
        ? `✓ (${result.confidence.toFixed(2)})`
        : `✗ (${result.confidence.toFixed(2)})`;
    });

    printRow([image.label, ...cells], colWidths);
  }

  printSeparator(colWidths);

  // Legend
  console.log("\n  ✓ = passed   ✗ = failed   (n.nn) = confidence score   — = upload failed   ? = not yet processed");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║        Vehicle Image Pipeline — Seed Script       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Step 1: Upload all images
  console.log(`── Uploading ${SAMPLES.length} images ──────────────────────────\n`);

  const uploaded: UploadedImage[] = [];
  for (const sample of SAMPLES) {
    console.log(`→ ${sample.label}`);
    const result = await uploadImage(sample);
    uploaded.push(result);
    console.log("");
  }

  const successCount = uploaded.filter((u) => u.status === "uploaded").length;
  console.log(`Uploaded ${successCount}/${SAMPLES.length} images successfully.\n`);

  if (successCount === 0) {
    console.error("No images uploaded. Is the server running on localhost:3000?");
    process.exit(1);
  }

  // Step 2: Wait for processing
  console.log(`── Waiting ${WAIT_SECONDS}s for worker to process... ─────────────\n`);
  for (let i = WAIT_SECONDS; i > 0; i--) {
    process.stdout.write(`\r  ${i}s remaining...`);
    await sleep(1000);
  }
  process.stdout.write("\r  Done waiting.         \n\n");

  // Step 3: Fetch results for successfully uploaded images
  console.log("── Fetching results ────────────────────────────────\n");

  const processed: ProcessedImage[] = [];
  for (const image of uploaded) {
    if (image.status === "failed" || !image.id) {
      processed.push({ ...image, results: [], processingStatus: "upload_failed" });
      continue;
    }
    const result = await fetchResults(image);
    processed.push(result);
  }

  // Step 4: Print summary table
  printSummaryTable(processed);
  console.log("");
}

main().catch((err) => {
  console.error("Seed script crashed:", err);
  process.exit(1);
});
