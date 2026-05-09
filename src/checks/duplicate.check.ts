import sharp from "sharp";
import { prisma } from "../db/prisma.client";
import { CheckResult } from "../types/index";

// Hamming distance below this = images are considered duplicates.
// Average hash is 64 bits — distance < 10 means ≥84% bit agreement.
const DUPLICATE_THRESHOLD = 10;

/**
 * Computes a 64-bit average perceptual hash (aHash) for the image.
 *
 * Process:
 *   1. Resize to 8×8 (discards high-frequency detail, retains structure)
 *   2. Convert to greyscale (single luminance channel)
 *   3. Get raw pixel buffer (64 bytes, values 0–255)
 *   4. Threshold each pixel against the mean → '1' or '0'
 *   5. Return 64-character binary string
 *
 * Known limitation: aHash is fast but produces more false positives than
 * dHash or pHash. Good enough for ~10k images; breaks down at larger scale.
 */
async function computePhash(imagePath: string): Promise<string> {
  const buffer = await sharp(imagePath)
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();

  const pixels = Array.from(buffer);
  const mean = pixels.reduce((sum, p) => sum + p, 0) / pixels.length;
  return pixels.map((p) => (p > mean ? "1" : "0")).join("");
}

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

/**
 * Detects duplicate images using perceptual hash comparison.
 *
 * This check is the exception to the "pure function" rule — it intentionally
 * has DB access because it must both read existing hashes for comparison and
 * write the computed hash back to the current image record.
 *
 * The worker wires this as: `(fp) => duplicateCheck(fp, image.id)`
 *
 * @param imagePath - Absolute path to the image file on disk
 * @param imageId   - ID of the current image record (excluded from comparison,
 *                    used for persisting the computed hash)
 */
export async function duplicateCheck(
  imagePath: string,
  imageId: string
): Promise<CheckResult> {
  const hash = await computePhash(imagePath);

  // Fetch all previously stored hashes, excluding the current image.
  // The current image starts with phash=null so the filter already excludes it,
  // but the explicit id exclusion is belt-and-suspenders.
  const existing = await prisma.image.findMany({
    where: {
      phash: { not: null },
      id: { not: imageId },
    },
    select: { id: true, phash: true },
  });

  let minDistance = Infinity;
  let closestMatchId: string | null = null;

  for (const img of existing) {
    if (!img.phash) continue;
    const dist = hammingDistance(hash, img.phash);
    if (dist < minDistance) {
      minDistance = dist;
      if (dist < DUPLICATE_THRESHOLD) {
        closestMatchId = img.id;
      }
    }
  }

  // Persist the hash regardless of result — the next image upload will compare against this one
  await prisma.image.update({
    where: { id: imageId },
    data: { phash: hash },
  });

  const isDuplicate = closestMatchId !== null;

  if (isDuplicate) {
    // confidence: 0 distance → 1.0 (exact match), 9 distance → 0.1 (borderline)
    const confidence = parseFloat(
      ((DUPLICATE_THRESHOLD - minDistance) / DUPLICATE_THRESHOLD).toFixed(4)
    );
    return {
      checkName: "duplicate",
      passed: false,
      confidence,
      message: `Duplicate image detected (matched ID: ${closestMatchId}, Hamming distance: ${minDistance}).`,
    };
  }

  return {
    checkName: "duplicate",
    passed: true,
    // Not 1.0 — aHash has known collision risk; we can't be certain
    confidence: 0.9,
    message: null,
  };
}
