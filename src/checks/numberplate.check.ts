import { createWorker } from "tesseract.js";
import { CheckResult } from "../types/index";

// Indian number plate formats
// Old format: MH12AB1234  (state code + district + letters + digits)
// BH series:  22BH1234AB  (year + BH + digits + letters)
const OLD_FORMAT = /[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}/;
const BH_FORMAT = /\d{2}BH\d{4}[A-Z]{1,2}/;

/**
 * Searches OCR text for an Indian number plate match.
 *
 * Strategy:
 *   1. Uppercase and strip all whitespace from the full text → single string search
 *   2. Also test each line individually (plate may be on its own line in OCR output)
 *   3. Return first matched plate string, or null if none found
 *
 * Why not use ^ and $ anchors: OCR output includes surrounding noise (margins,
 * other text in the image). Anchors would miss valid plates embedded in longer strings.
 */
function findPlate(rawText: string): string | null {
  const candidates = [
    rawText.replace(/\s+/g, "").toUpperCase(),
    ...rawText
      .split("\n")
      .map((line) => line.replace(/\s+/g, "").toUpperCase())
      .filter((line) => line.length >= 8), // plates are at least 8 chars
  ];

  for (const candidate of candidates) {
    const oldMatch = candidate.match(OLD_FORMAT);
    if (oldMatch) return oldMatch[0];

    const bhMatch = candidate.match(BH_FORMAT);
    if (bhMatch) return bhMatch[0];
  }

  return null;
}

/**
 * Detects a valid Indian vehicle number plate using Tesseract OCR.
 *
 * Confidence: Tesseract's own word-level confidence (0–100) normalised to 0–1.
 * This reflects OCR quality, not plate detection certainty — a high-confidence
 * "no match" means the OCR read the text well but found no plate format.
 *
 * Limitation: Tesseract.js (~50MB) adds significant latency per image (~1–3s).
 * It performs best on cropped, high-contrast plate regions; full-image OCR
 * produces more noise. A pre-processing step (Sharp crop/contrast boost)
 * would improve accuracy but is out of scope here.
 */
export async function numberplateCheck(imagePath: string): Promise<CheckResult> {
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(imagePath);
    const { text, confidence: ocrConfidence } = data;

    const plate = findPlate(text);
    const passed = plate !== null;

    // Tesseract confidence is 0–100; normalise to 0–1
    const confidence = parseFloat((ocrConfidence / 100).toFixed(4));

    return {
      checkName: "numberplate",
      passed,
      confidence,
      message: passed
        ? null
        : `No valid Indian number plate detected in image. OCR confidence: ${ocrConfidence.toFixed(1)}%.`,
    };
  } finally {
    // Always terminate — Tesseract workers hold a thread open until explicitly closed
    await worker.terminate();
  }
}
