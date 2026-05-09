import sharp from "sharp";
import { CheckResult } from "../types/index";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 480;

/**
 * Validates that the image meets minimum dimension requirements (480×480).
 *
 * Confidence uses distance from threshold — symmetric for pass and fail:
 *   - Exactly at threshold (480px): confidence = 0 (borderline, could go either way)
 *   - 960px (2× threshold): confidence = 1.0 (clearly passes)
 *   - 0px: confidence = 1.0 (clearly fails)
 *
 * The smallest dimension drives both pass/fail and confidence, since a
 * 4000×100 image is just as unusable as a 100×100 image.
 */
export async function dimensionsCheck(imagePath: string): Promise<CheckResult> {
  const { width = 0, height = 0 } = await sharp(imagePath).metadata();

  const passed = width >= MIN_WIDTH && height >= MIN_HEIGHT;
  const minDim = Math.min(width, height);
  const threshold = Math.min(MIN_WIDTH, MIN_HEIGHT); // 480

  // Distance from threshold — larger distance = more confident in either direction
  const distFromThreshold = Math.abs(minDim - threshold);
  const confidence = parseFloat(Math.min(distFromThreshold / threshold, 1).toFixed(4));

  return {
    checkName: "dimensions",
    passed,
    confidence,
    message: passed
      ? null
      : `Image too small: ${width}×${height}px. Minimum required: ${MIN_WIDTH}×${MIN_HEIGHT}px.`,
  };
}
