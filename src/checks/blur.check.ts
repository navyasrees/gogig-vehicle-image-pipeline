import sharp from "sharp";
import { CheckResult } from "../types/index";

// Laplacian variance below this threshold → image considered blurry.
// Using Laplacian (not raw pixel) variance makes this threshold
// content-independent: it measures edge response, not scene contrast.
// A white-wall photo and a busy street photo will both score near-zero
// when blurry, and high when sharp — regardless of content.
const BLUR_THRESHOLD = 100;

// Laplacian variance at which confidence saturates to 1.0.
// Calibrated empirically: sharp real-world images typically score 200–800+.
const CONFIDENCE_SCALE = 1000;

// Discrete 3×3 Laplacian kernel (8-connected).
// Highlights regions of rapid intensity change (edges).
// Blurring suppresses high-frequency content → low Laplacian response.
const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
};

/**
 * Detects whether an image is blurry using Laplacian variance.
 *
 * Approach:
 *   1. Convert to greyscale — single-channel, eliminates chromatic variance
 *   2. Apply Laplacian convolution — isolates edge/high-frequency content
 *   3. Compute variance of the Laplacian response (stdev² from Sharp stats)
 *   4. Low variance → edges are soft → image is blurry
 *
 * Why Laplacian variance over raw pixel variance:
 *   Raw pixel variance is content-sensitive — a sharp white wall scores low,
 *   a blurry colourful scene scores high. Laplacian variance measures edge
 *   sharpness specifically, making the threshold meaningful across image types.
 *
 * Known limitation: heuristic-based, not ML. Very low-detail images (solid
 * backgrounds, gradients) may produce false positives even when sharp.
 *
 * @param imagePath - Absolute path to the image file on disk
 */
export async function blurCheck(imagePath: string): Promise<CheckResult> {
  const { channels } = await sharp(imagePath)
    .greyscale()
    .convolve(LAPLACIAN_KERNEL)
    .stats();

  // After .greyscale(), there is always exactly one channel
  const stdev = channels[0].stdev;
  const variance = stdev * stdev;

  const passed = variance >= BLUR_THRESHOLD;
  const confidence = Math.min(variance / CONFIDENCE_SCALE, 1);

  return {
    checkName: "blur",
    passed,
    confidence: parseFloat(confidence.toFixed(4)),
    message: passed
      ? null
      : `Image appears blurry. Laplacian variance: ${variance.toFixed(2)} (threshold: ${BLUR_THRESHOLD}).`,
  };
}
