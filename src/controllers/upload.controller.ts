import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.client";
import { saveFile, deleteFile } from "../services/storage.service";
import { addImageJob } from "../services/queue.service";
import { env } from "../config/env";

const MAX_BYTES = env.storage.maxFileSizeMb * 1024 * 1024;

export async function uploadController(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // 1. Parse multipart
  const data = await req.file();

  // 2. No file field in body
  if (!data) {
    return reply.status(400).send({ error: "No file uploaded." });
  }

  // 3. Consume stream → Buffer, rejecting mid-stream if size limit is exceeded
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of data.file) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BYTES) {
      data.file.resume(); // drain so the connection doesn't hang
      return reply.status(413).send({
        error: `File too large. Maximum allowed size is ${env.storage.maxFileSizeMb} MB.`,
      });
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  // 4. Empty file
  if (buffer.length === 0) {
    return reply.status(400).send({ error: "Uploaded file is empty." });
  }

  // 5. Save to disk (validates MIME type internally)
  let saved: { filename: string; filepath: string };
  try {
    saved = await saveFile(buffer, data.filename, data.mimetype);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "File validation failed.";
    const status = message.includes("Invalid file type") ? 415 : 400;
    return reply.status(status).send({ error: message });
  }

  // 6. Persist DB record — roll back file on failure
  let image: { id: string };
  try {
    image = await prisma.image.create({
      data: {
        filename: saved.filename,
        filepath: saved.filepath,
        status: "pending",
      },
      select: { id: true },
    });
  } catch (err) {
    await deleteFile(saved.filepath).catch((cleanupErr) =>
      req.log.error({ cleanupErr, filepath: saved.filepath }, "Rollback failed: could not delete file after DB error")
    );
    req.log.error({ err }, "DB insert failed — file rolled back");
    return reply.status(500).send({ error: "Failed to save image record." });
  }

  // 7. Enqueue job — fatal: roll back DB record AND file if this fails.
  //    Returning 201 when queuing fails would leave the image stuck in
  //    "pending" forever with no way for the user to know.
  try {
    await addImageJob(image.id);
  } catch (err) {
    req.log.error({ err, imageId: image.id }, "Queue failure — rolling back DB record and file");

    // Best-effort rollback: delete DB record, then file.
    // If either cleanup fails we log loudly — an operator can reconcile,
    // but the client still gets an honest 500.
    await prisma.image.delete({ where: { id: image.id } }).catch((dbErr) =>
      req.log.error({ dbErr, imageId: image.id }, "Rollback failed: could not delete DB record after queue error")
    );
    await deleteFile(saved.filepath).catch((cleanupErr) =>
      req.log.error({ cleanupErr, filepath: saved.filepath }, "Rollback failed: could not delete file after queue error")
    );

    return reply.status(500).send({ error: "Failed to queue image for processing. Please try again." });
  }

  // 8. All three steps succeeded — respond
  return reply.status(201).send({ id: image.id, status: "pending" });
}
