// Core result shape returned by every check
export interface CheckResult {
  checkName: string;
  passed: boolean;
  message: string | null;
  confidence: number; // 0 to 1
}

// Mirrors the Prisma ImageStatus enum
export type JobStatus = "pending" | "processing" | "completed" | "failed";

// POST /upload → 201
export interface UploadResponse {
  id: string;
  status: "pending";
}

// GET /status/:id → 200
export interface StatusResponse {
  id: string;
  filename: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
}

// GET /results/:id → 200
export interface ResultsResponse {
  id: string;
  filename: string;
  status: JobStatus;
  results: CheckResult[];
}

// GET /failure/:id → 200
// failureReason lives on Image (no separate Failure table)
export interface FailureResponse {
  id: string;
  filename: string;
  reason: string | null;
}
