import exifr from "exifr";
import { CheckResult } from "../types/index";

// Software strings that indicate post-processing (case-insensitive)
const EDITING_SOFTWARE_PATTERNS = [
  "photoshop",
  "gimp",
  "lightroom",
  "affinity",
  "pixelmator",
  "snapseed",
  "capture one",
  "darktable",
];

// Date mismatch tolerance — small differences (< 60s) are acceptable
// due to filesystem rounding or camera clock drift
const DATE_MISMATCH_THRESHOLD_MS = 60_000;

/**
 * Detects potential image tampering using EXIF metadata analysis.
 *
 * Three signals (any combination → failed):
 *   1. Software tag contains known editing application
 *   2. DateTimeOriginal is missing (set at shutter press by camera — not by editors)
 *   3. CreateDate and ModifyDate differ by more than 60 seconds
 *
 * Confidence: fraction of signals triggered (0 → 0.0, 3 → 1.0).
 *   0 signals fired = confidence 0 (no tampering evidence).
 *   3 signals fired = confidence 1.0 (strong tampering evidence).
 *
 * Important caveats:
 *   - PNG and WebP images often have no EXIF at all — this check fires 0 signals
 *     in that case (treated as inconclusive, not suspicious). If your use-case
 *     requires EXIF presence for JPEG uploads, add a format-specific check.
 *   - This is purely heuristic. A sophisticated edit that preserves/forges EXIF
 *     will pass. Error Level Analysis (ELA) would be more robust but requires
 *     pixel-level comparison after re-compression, which is out of scope here.
 *   - High false-positive rate: any photo edited for legitimate reasons
 *     (colour correction, cropping) will carry an editing software tag.
 */
export async function tamperCheck(imagePath: string): Promise<CheckResult> {
  const exif = await exifr
    .parse(imagePath, {
      pick: ["Software", "DateTimeOriginal", "CreateDate", "ModifyDate"],
    })
    .catch(() => null);

  const signals: string[] = [];

  if (exif) {
    // Signal 1: known editing software in Software tag
    const software = (exif.Software ?? "").toLowerCase();
    if (EDITING_SOFTWARE_PATTERNS.some((pattern) => software.includes(pattern))) {
      signals.push(`editing software detected ("${exif.Software}")`);
    }

    // Signal 2: DateTimeOriginal absent — editors typically strip or never set this
    if (!exif.DateTimeOriginal) {
      signals.push("DateTimeOriginal field missing");
    }

    // Signal 3: CreateDate and ModifyDate differ significantly
    if (exif.CreateDate && exif.ModifyDate) {
      const createMs = new Date(exif.CreateDate).getTime();
      const modifyMs = new Date(exif.ModifyDate).getTime();
      const diffMs = Math.abs(createMs - modifyMs);
      if (diffMs > DATE_MISMATCH_THRESHOLD_MS) {
        const diffSec = Math.round(diffMs / 1000);
        signals.push(`CreateDate/ModifyDate mismatch (${diffSec}s apart)`);
      }
    }
  }
  // If exif is null (PNG, WebP, or stripped EXIF): no signals fire — treated as inconclusive

  const passed = signals.length === 0;
  // confidence = fraction of signals triggered (0 signals → 0.0, all 3 → 1.0)
  const confidence = parseFloat((signals.length / 3).toFixed(4));

  return {
    checkName: "tamper",
    passed,
    confidence,
    message: passed
      ? null
      : `Potential tampering detected. Signals (${signals.length}/3): ${signals.join("; ")}.`,
  };
}
