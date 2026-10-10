-- Migration: Fix appointment unique constraint to be session-scoped
-- This corrects a critical concurrency bug where tokens could collide across sessions
-- Run this when the database is accessible

-- Drop old constraint
DROP INDEX IF EXISTS "Appointment_doctorId_appointmentDate_tokenNumber_key";

-- Add session-scoped constraint
CREATE UNIQUE INDEX "Appointment_sessionId_appointmentDate_tokenNumber_key" 
ON "Appointment"("sessionId", "appointmentDate", "tokenNumber");
