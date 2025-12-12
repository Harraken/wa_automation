-- CreateEnum
CREATE TYPE "ProvisionState" AS ENUM ('PENDING', 'BUYING_NUMBER', 'SPAWNING_CONTAINER', 'WAITING_OTP', 'INJECTING_OTP', 'SETTING_UP', 'LINKING_WEB', 'ACTIVE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "provisions" (
    "id" TEXT NOT NULL,
    "request_id_smsman" TEXT,
    "phone" TEXT,
    "country_id" TEXT,
    "application_id" TEXT,
    "state" "ProvisionState" NOT NULL DEFAULT 'PENDING',
    "label" TEXT,
    "metadata" JSONB,
    "link_to_web" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "provision_id" TEXT NOT NULL,
    "container_id" TEXT,
    "stream_url" TEXT,
    "vnc_port" INTEGER,
    "appium_port" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "linked_web" BOOLEAN NOT NULL DEFAULT false,
    "web_session_id" TEXT,
    "agent_token" TEXT,
    "last_seen" TIMESTAMP(3),
    "snapshot_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "raw" JSONB,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_logs" (
    "id" TEXT NOT NULL,
    "provision_id" TEXT NOT NULL,
    "raw_sms" TEXT NOT NULL,
    "code" TEXT,
    "parsed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provisions_request_id_smsman_key" ON "provisions"("request_id_smsman");

-- CreateIndex
CREATE INDEX "provisions_state_idx" ON "provisions"("state");

-- CreateIndex
CREATE INDEX "provisions_phone_idx" ON "provisions"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_container_id_key" ON "sessions"("container_id");

-- CreateIndex
CREATE INDEX "sessions_provision_id_idx" ON "sessions"("provision_id");

-- CreateIndex
CREATE INDEX "sessions_is_active_idx" ON "sessions"("is_active");

-- CreateIndex
CREATE INDEX "messages_session_id_idx" ON "messages"("session_id");

-- CreateIndex
CREATE INDEX "messages_direction_idx" ON "messages"("direction");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "otp_logs_provision_id_idx" ON "otp_logs"("provision_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_logs" ADD CONSTRAINT "otp_logs_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;






