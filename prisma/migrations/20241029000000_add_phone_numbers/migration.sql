-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "request_id" TEXT,
    "provider" TEXT NOT NULL,
    "country_id" TEXT,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "provision_id" TEXT,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_phone_key" ON "phone_numbers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_request_id_key" ON "phone_numbers"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_provision_id_key" ON "phone_numbers"("provision_id");

-- CreateIndex
CREATE INDEX "phone_numbers_phone_idx" ON "phone_numbers"("phone");

-- CreateIndex
CREATE INDEX "phone_numbers_is_used_idx" ON "phone_numbers"("is_used");

-- CreateIndex
CREATE INDEX "phone_numbers_used_at_idx" ON "phone_numbers"("used_at");

-- CreateIndex
CREATE INDEX "phone_numbers_created_at_idx" ON "phone_numbers"("created_at");


