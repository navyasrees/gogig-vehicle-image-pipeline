/*
  Warnings:

  - A unique constraint covering the columns `[image_id,check_name]` on the table `analysis_results` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "analysis_results_image_id_check_name_key" ON "analysis_results"("image_id", "check_name");
