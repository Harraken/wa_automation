-- CreateTable
CREATE TABLE "learned_clicks" (
    "id" TEXT NOT NULL,
    "button_type" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_used" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learned_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learned_clicks_button_type_idx" ON "learned_clicks"("button_type");

-- CreateIndex
CREATE INDEX "learned_clicks_success_count_idx" ON "learned_clicks"("success_count");

-- CreateIndex
CREATE UNIQUE INDEX "learned_clicks_button_type_key" ON "learned_clicks"("button_type");

-- CreateIndex
CREATE INDEX "session_logs_level_idx" ON "session_logs"("level");
