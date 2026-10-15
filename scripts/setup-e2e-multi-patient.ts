import { PrismaClient } from "@prisma/client";
import { generateIdentityKey } from "../src/utils/identity.util.js";
import { generateMRN } from "../src/utils/mrn.util.js";

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2] || `077${Math.floor(1000000 + Math.random() * 9000000)}`;
  const barcode1 = `88${Math.floor(10000000 + Math.random() * 90000000)}`;
  const barcode2 = `89${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Find a doctor
  const doctor = await prisma.user.findFirst({
    where: { Role: { name: 'Doctor' }, isActive: true }
  });
  const doctorId = doctor ? doctor.id : null;

  // 1. Clean up phone if existing
  const existing = await prisma.patient.findMany({
    where: { phone },
    select: { id: true }
  });
  const ids = existing.map(e => e.id);
  if (ids.length > 0) {
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }

  // 2. Create Patient 1: Kamal MultiTest (19)
  const mrn1 = await generateMRN(prisma);
  const key1 = generateIdentityKey("Kamal MultiTest", phone);
  const patient1 = await prisma.patient.create({
    data: {
      patientId: mrn1,
      identityKey: key1,
      fullName: "Kamal MultiTest",
      phone,
      ageFallback: 19,
      gender: "MALE"
    }
  });

  // 3. Create Patient 2: Amara MultiTest (58)
  const mrn2 = await generateMRN(prisma);
  const key2 = generateIdentityKey("Amara MultiTest", phone);
  const patient2 = await prisma.patient.create({
    data: {
      patientId: mrn2,
      identityKey: key2,
      fullName: "Amara MultiTest",
      phone,
      ageFallback: 58,
      gender: "FEMALE"
    }
  });

  // 4. Create isolated appointments
  const appt1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId,
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
      doctorId,
      department: "CONSULTATION",
      tokenNumber: "02",
      appointmentDate: new Date(),
      bookingReference: barcode2,
      bookingType: "WALK_IN"
    }
  });

  const payload = {
    phone,
    patient1: {
      id: patient1.id,
      patientId: patient1.patientId,
      fullName: patient1.fullName,
      identityKey: patient1.identityKey,
      age: 19,
      barcode: barcode1,
      apptId: appt1.id
    },
    patient2: {
      id: patient2.id,
      patientId: patient2.patientId,
      fullName: patient2.fullName,
      identityKey: patient2.identityKey,
      age: 58,
      barcode: barcode2,
      apptId: appt2.id
    }
  };

  console.log(JSON.stringify(payload));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
