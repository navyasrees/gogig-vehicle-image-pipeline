import sharp from "sharp";
import { CheckResult } from "../types/index";

const LOW_THRESHOLD = 50;   // below = too dark
const HIGH_THRESHOLD = 220; // above = overexposed
const HALF_RANGE = (HIGH_THRESHOLD - LOW_THRESHOLD) / 2; // 85

/**
 * Checks whether an image is too dark or overexposed.
 *
 * Approach: greyscale mean pixel value (0–255) from Sharp stats.
 * Acceptable range: 50–220.
 *
 * Confidence semantics:
 *   - If passed: how far the mean sits from the nearest boundary.
 *     Mean at the exact boundary → confidence 0 (borderline).
 *     Mean at the centre (135) → confidence 1 (clearly fine).
 *   - If failed: how far outside the boundary the mean is.
 *     Mean just past the threshold → confidence ~0 (borderline).
 *     Mean at 0 or 255 → confidence 1 (clearly wrong).
 */
export async function brightnessCheck(imagePath: string): Promise<CheckResult> {
  const { channels } = await sharp(imagePath).greyscale().stats();
  const mean = channels[0].mean; // 0–255

  const tooDark = mean < LOW_THRESHOLD;
  const overexposed = mean > HIGH_THRESHOLD;
  const passed = !tooDark && !overexposed;

  let confidence: number;
  if (passed) {
    const distFromNearestBoundary = Math.min(mean - LOW_THRESHOLD, HIGH_THRESHOLD - mean);
    confidence = Math.min(distFromNearestBoundary / HALF_RANGE, 1);
  } else if (tooDark) {
    confidence = Math.min((LOW_THRESHOLD - mean) / LOW_THRESHOLD, 1);
  } else {
    confidence = Math.min((mean - HIGH_THRESHOLD) / (255 - HIGH_THRESHOLD), 1);
  }

  let message: string | null = null;
  if (tooDark) {
    message = `Image is too dark. Mean brightness: ${mean.toFixed(1)} (minimum: ${LOW_THRESHOLD}).`;
  } else if (overexposed) {
    message = `Image is overexposed. Mean brightness: ${mean.toFixed(1)} (maximum: ${HIGH_THRESHOLD}).`;
  }

  return {
    checkName: "brightness",
    passed,
    confidence: parseFloat(confidence.toFixed(4)),
    message,
  };
}
