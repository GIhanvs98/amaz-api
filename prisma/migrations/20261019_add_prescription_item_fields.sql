-- Safe migration: Add frequency, route, strength, dosageAmount, doseUnit, and schedule fields to PrescriptionItem
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "strength" TEXT;
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "dosageAmount" TEXT;
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "doseUnit" TEXT;
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "route" TEXT DEFAULT 'ORAL';
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PrescriptionItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Data preservation: For existing items where route is NULL, default to 'ORAL'
UPDATE "PrescriptionItem" SET "route" = 'ORAL' WHERE "route" IS NULL;

-- Normalize existing frequencies to canonical codes safely
UPDATE "PrescriptionItem" SET "frequency" = 'OD' WHERE "frequency" IN ('od', 'Once daily', 'once daily', '1');
UPDATE "PrescriptionItem" SET "frequency" = 'BD' WHERE "frequency" IN ('bd', 'bid', 'BID', 'Twice daily', 'twice daily', '2');
UPDATE "PrescriptionItem" SET "frequency" = 'TDS' WHERE "frequency" IN ('tds', 'tid', 'TID', 'Three times daily', 'three times daily', '3');
UPDATE "PrescriptionItem" SET "frequency" = 'QDS' WHERE "frequency" IN ('qds', 'qid', 'QID', 'Four times daily', 'four times daily', '4');
