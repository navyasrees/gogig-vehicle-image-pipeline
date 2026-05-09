import Fastify, { FastifyError } from "fastify";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import { ensureUploadDir } from "./services/storage.service";
import { uploadRoutes } from "./routes/upload.route";
import { statusRoutes } from "./routes/status.route";
import { resultsRoutes } from "./routes/results.route";
import { failureRoutes } from "./routes/failure.route";
import "./worker/image.worker";

const app = Fastify({ logger: true });

app.register(multipart, {
  limits: {
    fileSize: env.storage.maxFileSizeMb * 1024 * 1024,
  },
});

// ---------------------------------------------------------------------------
// Global error handler
//
// Normalises all unhandled errors to { error: string } so every failure
// surface returns the same shape regardless of where it originated.
//
// Two cases that need special treatment:
//   1. RequestFileTooLargeError — thrown by @fastify/multipart when the
//      stream hits the fileSize limit before our controller reads it.
//      Should be 413, not 500.
//   2. Validation errors from Fastify's JSON Schema (statusCode 400) —
//      surface the validation message rather than a generic string.
//   3. Everything else — 500 with the error message, never leaking a stack.
// ---------------------------------------------------------------------------
app.setErrorHandler((error: FastifyError, req, reply) => {
  // @fastify/multipart sets code = "FST_FILES_LIMIT" or the error name
  // "RequestFileTooLargeError" when the file size limit is exceeded
  if (
    error.code === "FST_FILES_LIMIT" ||
    error.message?.toLowerCase().includes("file too large") ||
    error.constructor?.name === "RequestFileTooLargeError"
  ) {
    return reply.status(413).send({
      error: `File too large. Maximum allowed size is ${env.storage.maxFileSizeMb} MB.`,
    });
  }

  // Fastify validation errors (malformed request body, wrong param type, etc.)
  if (error.statusCode === 400 && error.validation) {
    return reply.status(400).send({ error: error.message });
  }

  // Log unexpected errors with full details server-side, return nothing useful to the client
  req.log.error({ err: error, path: req.url }, "Unhandled error");
  return reply.status(error.statusCode ?? 500).send({
    error: "An unexpected error occurred.",
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async () => ({ status: "ok" }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.register(uploadRoutes);
app.register(statusRoutes);
app.register(resultsRoutes);
app.register(failureRoutes);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const start = async () => {
  try {
    await ensureUploadDir();
    await app.listen({ port: env.port, host: "0.0.0.0" });
    console.log(`Server running on port ${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
