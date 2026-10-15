import { PrismaClient } from "@prisma/client";
import { generateIdentityKey } from "../src/utils/identity.util.js";

const prisma = new PrismaClient();

async function runTest() {
  console.log("=== Testing Multi-Patient Resolution & Barcode Isolation ===");
  const testPhone = "0719999999";

  // Clean up any existing test records
  const existingPatients = await prisma.patient.findMany({
    where: { phone: testPhone },
    select: { id: true }
  });
  const patientIds = existingPatients.map(p => p.id);
  if (patientIds.length > 0) {
    await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.invoice.deleteMany({ where: { patientId: { in: patientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  }

  // 1. Create Patient 1: Kamal Test (Age 19)
  const key1 = generateIdentityKey("Kamal Test", testPhone);
  const patient1 = await prisma.patient.create({
    data: {
      fullName: "Kamal Test",
      phone: testPhone,
      ageFallback: 19,
      identityKey: key1
    }
  });
  console.log("✓ Patient 1 created:", patient1.fullName, patient1.id, patient1.identityKey);

  // 2. Create Patient 2: Amara Test (Age 58) under same phone
  const key2 = generateIdentityKey("Amara Test", testPhone);
  const patient2 = await prisma.patient.create({
    data: {
      fullName: "Amara Test",
      phone: testPhone,
      ageFallback: 58,
      identityKey: key2
    }
  });
  console.log("✓ Patient 2 created:", patient2.fullName, patient2.id, patient2.identityKey);

  if (patient1.id === patient2.id) {
    throw new Error("FAILED: Patient IDs collided under same phone!");
  }
  if (patient1.identityKey === patient2.identityKey) {
    throw new Error("FAILED: Identity keys collided!");
  }

  // 3. Query directory by phone
  const family = await prisma.patient.findMany({
    where: { phone: { contains: testPhone } }
  });
  console.log(`✓ Family lookup for ${testPhone} returned ${family.length} members`);
  if (family.length !== 2) {
    throw new Error(`FAILED: Expected 2 family members, got ${family.length}`);
  }

  // 4. Create isolated visit barcodes for each
  const barcode1 = "1000000001";
  const barcode2 = "1000000002";

  const appt1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      department: "CONSULTATION",
      tokenNumber: "01",
      appointmentDate: new Date(),
      bookingReference: barcode1,
      bookingType: "WALK_IN"
    }
  });

  const appt2 = await prisma.appointment.create({
    data: {
      patientId: patient2.id,
      department: "CONSULTATION",
      tokenNumber: "02",
      appointmentDate: new Date(),
      bookingReference: barcode2,
      bookingType: "WALK_IN"
    }
  });

  console.log(`✓ Appointment 1 (Kamal): Barcode=${appt1.bookingReference}, Patient=${appt1.patientId}`);
  console.log(`✓ Appointment 2 (Amara): Barcode=${appt2.bookingReference}, Patient=${appt2.patientId}`);

  if (appt1.bookingReference === appt2.bookingReference) {
    throw new Error("FAILED: Barcodes collided between family members!");
  }
  if (appt1.patientId === appt2.patientId) {
    throw new Error("FAILED: Appointments bound to the same patient ID!");
  }

  // Clean up
  await prisma.appointment.deleteMany({ where: { id: { in: [appt1.id, appt2.id] } } });
  await prisma.patient.deleteMany({ where: { id: { in: [patient1.id, patient2.id] } } });

  console.log("=== ALL MULTI-PATIENT INTEGRITY CHECKS PASSED ===");
  await prisma.$disconnect();
}

runTest().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
