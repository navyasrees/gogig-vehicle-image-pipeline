import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",

  databaseUrl: process.env.DATABASE_URL ?? "",

  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  },

  storage: {
    uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? "10", 10),
  },

  worker: {
    // How many jobs the worker processes simultaneously. Tesseract.js is the
    // bottleneck — it's CPU-heavy and can use ~150MB RAM per instance. Keep
    // this low and tune up only after profiling on your target hardware.
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10),
  },
} as const;

// Validate required env vars at startup
const required = ["DATABASE_URL"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
