-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'pending',
    "phash" TEXT,
    "failureReason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" TEXT NOT NULL,
    "image_id" TEXT NOT NULL,
    "check_name" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "message" TEXT,

    CONSTRAINT "analysis_results_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
