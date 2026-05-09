# Vehicle Image Processing Pipeline

## Overview

A backend system that accepts vehicle image uploads, processes them asynchronously through a BullMQ worker queue, runs 7 image quality checks, and returns structured results per check. Built with Node.js, TypeScript, Fastify, Prisma, PostgreSQL, and Redis. Each uploaded image is validated on upload, stored to disk, queued for processing, and independently assessed for blur, brightness, dimensions, duplicate content, screenshot detection, number plate presence, and potential tampering.

---

## Architecture

**Monolith — API and worker run in the same process.**

The worker is imported directly in `src/index.ts`. Reasoning: shared Prisma client, single deployment unit, straightforward local setup. The worker is structured so it can be extracted into a separate entry point (`src/worker/image.worker.ts` is already a standalone file) without refactoring if independent scaling becomes necessary.

**Request flow:**

```
POST /upload
  → validate (MIME type, size, empty)
  → save file to disk (UUID filename)
  → insert DB record (status: pending)
  → push BullMQ job
  → return { id, status: "pending" }

Worker picks up job:
  → status: processing
  → run 7 checks via Promise.allSettled
  → save all check results to analysis_results
  → status: completed / failed
```

Queue failure on upload is **fatal** — the DB record and file are deleted and a 500 is returned. A 201 with a job that never runs is a lie.

---

## Queue Strategy

BullMQ was chosen over RabbitMQ/SQS and over in-memory queues for the following reasons:

- **Over RabbitMQ/SQS**: persistent job storage via Redis without a separate broker. No additional infrastructure to run locally.
- **Over in-memory**: jobs survive process restarts. A crash mid-processing doesn't silently drop work.

Jobs are retried up to **3 times** with **exponential backoff** (2s, 4s, 8s). Concurrency defaults to **2** (configurable via `WORKER_CONCURRENCY`). Tesseract.js is CPU-heavy and can consume ~150MB RAM per instance — higher concurrency saturates the machine on typical 2–4 core hardware.

---

## Image Checks

| Check | Approach |
|---|---|
| **Blur** | Laplacian convolution via Sharp `.convolve()` — measures edge response variance; low variance indicates blurry image |
| **Brightness** | Sharp `.stats()` greyscale mean — fails if mean pixel brightness is below 50 (too dark) or above 220 (overexposed) |
| **Dimensions** | Sharp `.metadata()` — rejects images below 480×480px minimum |
| **Duplicate** | 8×8 greyscale average perceptual hash (aHash); Hamming distance < 10 against stored hashes = duplicate |
| **Screenshot** | Heuristic: 2 of 3 signals — missing camera make/model, common screen aspect ratio (16:9/4:3), no GPS EXIF data |
| **Number plate** | Tesseract.js full-image OCR + regex match for Indian plate formats (old: `MH12AB1234`, BH series: `22BH1234AB`) |
| **Tamper** | EXIF analysis via `exifr` — flags editing software tags (Photoshop, GIMP, Lightroom), missing `DateTimeOriginal`, and `CreateDate`/`ModifyDate` mismatch > 60s |

Every check returns the same `CheckResult` shape: `{ checkName, passed, message, confidence }`. A check throwing an exception is normalized to `passed: false, confidence: 0` by the worker — it never aborts sibling checks.

---

## Key Design Decisions

**Job failure vs check failure are separate.**
`status: failed` on an image means an infrastructure error (DB down, file unreadable, unhandled exception). `passed: false` on a check result means the image failed a quality assessment. These are distinct and exposed separately: `GET /failure/:id` vs `GET /results/:id`. A user can distinguish "retry your upload" from "fix your image" without guessing.

**Queue failure is fatal.**
If BullMQ push fails after the DB record is created, the controller deletes the DB record and the file, then returns 500. The alternative — keeping the record and returning 201 — leaves the image in `pending` forever with no feedback to the caller. Without a background poller to re-queue stuck jobs, optimism is just deferred failure.

**`Promise.allSettled` with named `CheckEntry` registry.**
All 7 checks run concurrently. Each entry in the registry carries a `name` field alongside the function — this is necessary because if a check throws, there is no `CheckResult.checkName` to read from a value that never resolved. The registry name is the only reliable attribution for a crashed check.

**Monolith with a clean extraction boundary.**
Worker and API share a process for simplicity. The worker is already a self-contained file. Extracting it means changing one import in `index.ts` and running the worker as a separate process. The tradeoff — inability to scale API and worker independently — is documented and acceptable for this scope.

---

## AI Usage Disclosure

Claude generated boilerplate, check implementations, controller logic, error handling patterns, and the entire frontend (`public/index.html`). All AI output was reviewed and validated: thresholds were questioned (blur variance threshold, Laplacian kernel selection over raw pixel variance), logic was traced through, and incorrect decisions were caught and corrected.

Specific corrections made during the build:

- **Queue failure was initially non-fatal** — the first implementation logged the error and returned 201 anyway. This was identified as incorrect: a `pending` record with no job is a silent failure. Corrected to a full rollback with 500.
- **Blur check used raw pixel variance** — the initial implementation measured scene contrast, not sharpness. Identified as content-sensitive (a blurry colourful scene outscores a sharp white wall). Corrected to Laplacian convolution, which measures edge response specifically.
- **Worker concurrency was hardcoded to 5** — flagged as a concern at write time but shipped anyway. Identified as inconsistent (knowing something is wrong and not acting on it is worse than not knowing). Reduced to 2, made configurable via `WORKER_CONCURRENCY`.
- **Screenshot check confidence: 0 on clear pass** — `triggeredCount / 3` means 0 signals = confidence 0. Semantically awkward (high confidence in a pass reads as 0). Documented as a known limitation rather than changed, since the brief specified signals-based confidence.
- **UI card IDs not fully swapped on upload response** — when the server returned the real image `id`, the code updated the outer card element's `id` (`card-${tempId}` → `card-${id}`) but left the inner badge and body elements still keyed to `tempId`. Polling then looked up `badge-${id}` and `body-${id}` — elements that didn't exist — so the card stayed frozen at "Pending / Waiting for worker…" indefinitely even after processing completed. Corrected to swap all three IDs atomically.

---

## Known Limitations

- **Screenshot false positives on downloaded images** — hosting sites strip EXIF on upload, removing camera make/model and GPS. These images trigger two heuristics by default and fail the screenshot check even if they're genuine photos.
- **Numberplate OCR confidence is misleading** — the confidence value reflects Tesseract's overall text recognition quality on the full image, not the certainty that a plate was correctly detected. A clear image with no plate can return high confidence alongside `passed: false`.
- **Blur confidence normalization may need tuning** — the Laplacian variance is normalized against a fixed scale of 1000. Real-world images likely require empirical calibration against a labelled dataset.
- **Perceptual hash not saved on duplicate check DB write failure** — if the `phash` update throws, the image is permanently absent from future duplicate comparisons. The check itself is normalized to `passed: false` by `Promise.allSettled`, but the data loss is silent.
- **Duplicate result rows on worker retry** — mitigated by a `@@unique([imageId, checkName])` constraint on `analysis_results`. Without it, a retry after a partial success would write 14 rows instead of 7 with no error.
- **API and worker cannot scale independently** — consequence of the monolith architecture. Addressed by the clean extraction boundary described above.

---

## Trade-offs

**Job failure vs check failure separation**
`failed` status means infrastructure error; `passed: false` means image quality issue. Slightly more complex mental model for API consumers, but the alternative — conflating the two — makes the API ambiguous. A caller cannot act on "something went wrong" without knowing whether to retry the upload or fix the image.

**Queue failure is fatal with full rollback**
If BullMQ push fails, the DB record and file are deleted and a 500 is returned. Stricter than necessary — a background retry poller could salvage stuck `pending` records. But without one, a silent `pending` forever is worse than an honest error. Chose correctness over optimism.

**`Promise.allSettled` with `CheckEntry` registry**
All 7 checks run in parallel and exceptions are normalized into `CheckResult` shape. The registry carries each check's name so crashes are attributable without depending on a value that was never returned. Tradeoff: all checks run even when one crashes early. Slightly wasteful, but partial results (6 of 7 checks completed) are more useful than nothing.

**Unique constraint on `(imageId, checkName)`**
Added after identifying that worker retries could produce duplicate result rows if `createMany` succeeded but the subsequent status update failed. Requires a migration. Without it, retry logic silently corrupts results — 14 rows instead of 7, with no indication anything went wrong.

**Monolith with clean extraction boundary**
Worker and API share a process. Structured so the worker can be moved to a separate entry point without refactoring. Tradeoff: cannot scale independently right now. Acceptable for this scope, documented honestly.

---

## Frontend

A single-page UI is served at `GET /` from `public/index.html`. No framework, no build step — vanilla HTML, CSS, and JavaScript served directly by `@fastify/static`.

**Three sections:**

**Upload** — drag-and-drop zone that accepts `.jpg`, `.jpeg`, `.png`, and `.webp` files. Files can also be selected via a browse button. Multiple files can be queued before submission. Each file is shown with its name, size, and a remove button. The "Analyse" button is disabled until at least one file is queued.

**Processing** — a live job board. Each uploaded image gets a card immediately (before the server responds), showing a spinner and "Pending / Waiting for worker…". Once the server returns the real image `id`, polling begins at 2-second intervals against `GET /status/:id`. When status transitions to `completed`, the card fetches `GET /results/:id` and renders a table of all 7 checks with pass/fail indicators, confidence scores, and messages. If the job `failed`, it fetches `GET /failure/:id` and shows the failure reason instead.

**History** — a compact log of every completed or failed job in the current session. Shows filename, a `n/7 checks passed` summary (or "Job failed"), and the time the upload started. New entries are prepended so the most recent appears first.

**Implementation notes:**

- Cards are created with a `tempId` immediately on submit (before the `POST /upload` response) so the UI feels instant. When the real `id` arrives, the outer card element and both inner elements (`badge-*`, `body-*`) are all re-keyed to the real id atomically, so subsequent DOM lookups by the poller always resolve correctly.
- Polling stops as soon as the terminal status (`completed` or `failed`) is observed; the interval is cleared and removed from the poller map.
- Network blips during polling are swallowed silently — the interval keeps running and retries on the next tick.
- Accepted MIME types are enforced client-side by filtering on file extension (`.jpe?g|png|webp`) before files are added to the queue.

---

## Running Locally

**Prerequisites:** Docker, Node.js 20+

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start PostgreSQL and Redis
docker-compose up -d postgres redis

# 3. Install dependencies
npm install

# 4. Run migrations and generate Prisma client
npm run prisma:migrate

# 5. Start the server (API + worker)
npm run dev
```

**Sample requests:**

```bash
# Health check
curl http://localhost:3000/health
# → { "status": "ok" }

# Upload an image
curl -X POST http://localhost:3000/upload \
  -F "image=@/path/to/vehicle.jpg"
# → { "id": "uuid", "status": "pending" }

# Check processing status
curl http://localhost:3000/status/{id}
# → { "id": "...", "status": "processing", "createdAt": "...", "updatedAt": "..." }

# Get check results (once status = completed)
curl http://localhost:3000/results/{id}
# → { "id": "...", "status": "completed", "results": [ { "checkName": "blur", "passed": true, ... }, ... ] }

# Get failure reason (if status = failed)
curl http://localhost:3000/failure/{id}
# → { "id": "...", "failureReason": "..." }
```

---

## What I'd Improve With More Time

- **Separate worker process** — extract the worker into its own entry point for independent scaling and deployment
- **Plate region crop before OCR** — pre-process the image with Sharp to isolate the plate area before passing to Tesseract; would significantly improve detection accuracy and reduce noise
- **Confidence score calibration** — run checks against a labelled dataset of real vehicle images and tune thresholds empirically rather than heuristically
- **Rate limiting on the upload endpoint** — prevent abuse and protect Tesseract from being hammered concurrently
- **Automated tests for each check** — unit tests per check function with known-good and known-bad fixture images; integration tests for the full upload → worker → results flow
