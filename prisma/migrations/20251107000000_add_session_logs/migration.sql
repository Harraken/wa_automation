-- CreateTable
CREATE TABLE IF NOT EXISTS "session_logs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "session_logs_session_id_idx" ON "session_logs"("session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "session_logs_created_at_idx" ON "session_logs"("created_at");

-- AddForeignKey
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

