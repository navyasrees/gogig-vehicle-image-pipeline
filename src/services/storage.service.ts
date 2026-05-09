import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);

export interface SavedFile {
  filename: string;
  filepath: string;
}

/**
 * Ensures the uploads directory exists.
 * Called once at app startup — not on every request.
 */
export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(env.storage.uploadDir, { recursive: true });
}

/**
 * Validates and persists an uploaded image buffer to disk.
 * Returns the generated filename and absolute filepath.
 *
 * Throws with a descriptive message on any validation failure —
 * callers are responsible for mapping these to HTTP error codes.
 */
export async function saveFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<SavedFile> {
  // 1. MIME type check
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Invalid file type "${mimeType}". Allowed: jpeg, png, webp, tiff.`
    );
  }

  // 2. Empty file check
  if (buffer.length === 0) {
    throw new Error("Uploaded file is empty.");
  }

  // 3. Size check (defence-in-depth — Fastify multipart limit is the first gate)
  const maxBytes = env.storage.maxFileSizeMb * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error(
      `File too large (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Max allowed: ${env.storage.maxFileSizeMb} MB.`
    );
  }

  // 4. Build a UUID-based filename preserving the original extension
  const ext = path.extname(originalFilename).toLowerCase() || extFromMime(mimeType);
  const filename = `${uuidv4()}${ext}`;
  const filepath = path.resolve(env.storage.uploadDir, filename);

  await fs.writeFile(filepath, buffer);

  return { filename, filepath };
}

/**
 * Removes a file from disk. Used during cleanup on DB write failures.
 * Swallows ENOENT — file may already be gone.
 */
export async function deleteFile(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
  };
  return map[mime] ?? ".jpg";
}
