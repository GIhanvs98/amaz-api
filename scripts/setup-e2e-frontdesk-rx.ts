import "dotenv/config";
import process from "node:process";
import { prisma } from "../src/lib/prisma.js";

async function run() {
  const barcode = process.argv[2] || `RXTEST${Math.floor(100000 + Math.random() * 900000)}`;

  // 1. Patient
  const patient = await prisma.patient.create({
    data: {
      fullName: `Test Rx Patient ${barcode.slice(-4)}`,
      phone: `077${Math.floor(1000000 + Math.random() * 9000000)}`,
      gender: "Female",
      ageFallback: 28
    }
  });

  // 2. Doctor
  let doctor = await prisma.user.findFirst({
    where: { Role: { name: { in: ["Doctor", "DOCTOR"] } } }
  });
  if (!doctor) {
    let docRole = await prisma.role.findFirst({ where: { name: "Doctor" } });
    if (!docRole) docRole = await prisma.role.create({ data: { name: "Doctor" } });
    doctor = await prisma.user.create({
      data: {
        email: `doc_${Date.now()}@amaz.com`,
        password: "$2a$10$hashedpassworddummy",
        fullName: "Dr. Clinic Specialist",
        roleId: docRole.id,
        specialty: "General Medicine",
        consultationFee: 2500,
        feeType: "POST"
      }
    });
  }

  // 3. Ensure Medicine exists in pharmacy catalog
  let medicine = await prisma.medicine.findFirst({
    where: { name: "Paracetamol 500mg" },
    include: { stockBatches: true }
  });
  if (!medicine) {
    medicine = await prisma.medicine.create({
      data: {
        name: "Paracetamol 500mg",
        genericName: "Paracetamol",
        category: "Analgesics",
        unit: "tablet",
        retailPrice: 15,
        stockBatches: {
          create: {
            batchNumber: `BAT-${Date.now()}`,
            currentQuantity: 100,
            initialQuantity: 100,
            unitPrice: 15,
            costPrice: 8,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        }
      },
      include: { stockBatches: true }
    });
  }

  // 4. Create an Appointment
  const now = new Date();
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      appointmentDate: now,
      tokenNumber: "TK-99",
      bookingReference: barcode,
      status: "COMPLETED"
    }
  });

  // 5. Create a Pending Prescription
  const prescription = await prisma.prescription.create({
    data: {
      patientId: patient.id,
      patientName: patient.fullName,
      doctorId: doctor.id,
      doctorName: doctor.fullName,
      visitId: appointment.id,
      diagnosis: "Acute viral fever",
      clinicalNotes: "Patient brought handwritten note from doctor",
      status: "PENDING"
    }
  });

  console.log(JSON.stringify({
    patientId: patient.id,
    patientName: patient.fullName,
    doctorId: doctor.id,
    doctorName: doctor.fullName,
    appointmentId: appointment.id,
    prescriptionId: prescription.id,
    barcode
  }));

  process.exit(0);
}

run().catch(err => {
  console.error("setup-e2e-frontdesk-rx error:", err);
  process.exit(1);
});
