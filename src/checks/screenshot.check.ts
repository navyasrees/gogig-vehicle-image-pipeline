import sharp from "sharp";
import exifr from "exifr";
import { CheckResult } from "../types/index";

// Common screen aspect ratios to flag
const SCREEN_RATIOS = [
  { w: 16, h: 9 },
  { w: 4, h: 3 },
  { w: 9, h: 16 }, // portrait phone
  { w: 3, h: 4 },
];
const ASPECT_TOLERANCE = 0.02; // 2% — "exactly" means very close, not pixel-perfect

function isScreenAspectRatio(width: number, height: number): boolean {
  if (width === 0 || height === 0) return false;
  const ratio = width / height;
  return SCREEN_RATIOS.some(({ w, h }) => Math.abs(ratio - w / h) < ASPECT_TOLERANCE);
}

/**
 * Detects whether an image is likely a screenshot rather than a camera photo.
 *
 * Heuristics (any 2 of 3 triggers = failed):
 *   1. Missing camera make/model — real camera photos always have this in EXIF
 *   2. Aspect ratio matches a common screen ratio (16:9, 4:3, 9:16, 3:4)
 *   3. No GPS data — vehicle photos are typically taken on-location
 *
 * Confidence: fraction of heuristics triggered (0 → 0.0, 3 → 1.0).
 *   This is intentionally symmetric: 0 triggers = confidence 0 (no screenshot signal),
 *   3 triggers = confidence 1.0 (strong screenshot signal).
 *   For the passing case (0–1 triggers), lower confidence signals borderline cases.
 *
 * Limitation: legitimate indoor/studio photos may lack GPS and have common aspect
 * ratios. False positive rate is higher than camera-specific metadata would allow.
 */
export async function screenshotCheck(imagePath: string): Promise<CheckResult> {
  const [meta, exif] = await Promise.all([
    sharp(imagePath).metadata(),
    exifr
      .parse(imagePath, { pick: ["Make", "Model", "GPSLatitude", "GPSLongitude"] })
      .catch(() => null),
  ]);

  const { width = 0, height = 0 } = meta;

  const heuristics = {
    missingCameraInfo: !exif?.Make && !exif?.Model,
    screenAspectRatio: isScreenAspectRatio(width, height),
    noGPS: !exif?.GPSLatitude && !exif?.GPSLongitude,
  };

  const triggeredCount = Object.values(heuristics).filter(Boolean).length;
  const passed = triggeredCount < 2;
  const confidence = parseFloat((triggeredCount / 3).toFixed(4));

  const triggeredNames = (Object.keys(heuristics) as Array<keyof typeof heuristics>)
    .filter((k) => heuristics[k]);

  return {
    checkName: "screenshot",
    passed,
    confidence,
    message: passed
      ? null
      : `Image likely a screenshot. Triggered heuristics (${triggeredCount}/3): ${triggeredNames.join(", ")}.`,
  };
}
