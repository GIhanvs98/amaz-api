import "dotenv/config";
import process from "node:process";
import { prisma } from "../src/lib/prisma.js";

async function run() {
  const masterBarcode = process.argv[2] || `DOC${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 1. Create a dedicated test patient
  const patientPhone = `071${Math.floor(1000000 + Math.random() * 9000000)}`;
  const patient = await prisma.patient.create({
    data: {
      fullName: `Consultation Test Patient ${masterBarcode.slice(-4)}`,
      phone: patientPhone,
      gender: "Male",
      ageFallback: 35
    }
  });

  // 2. Find or create doctor
  let doctor = await prisma.user.findFirst({
    where: { Role: { name: { in: ["Doctor", "DOCTOR"] } } },
    include: { Role: true }
  });
  
  if (!doctor) {
    let docRole = await prisma.role.findFirst({
      where: { name: { in: ["Doctor", "DOCTOR"] } }
    });
    if (!docRole) {
      docRole = await prisma.role.create({
        data: { name: "Doctor" }
      });
    }
    doctor = await prisma.user.create({
      data: {
        email: `testdoctor_${Date.now()}@amaz.com`,
        password: "$2a$10$hashedpassworddummy",
        fullName: "Dr. E2E Specialist",
        roleId: docRole.id,
        specialty: "General Medicine",
        consultationFee: 2500,
        feeType: "POST"
      },
      include: { Role: true }
    });
  }

  // 3. Ensure Medicine exists
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
        retailPrice: 10,
        stockBatches: {
          create: {
            batchNumber: "BAT-PARA-01",
            currentQuantity: 200,
            initialQuantity: 200,
            unitPrice: 10,
            costPrice: 5,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        }
      },
      include: { stockBatches: true }
    });
  }

  // 4. Create consultation appointment/token in WAITING status
  const tokenNo = Math.floor(10 + Math.random() * 89).toString();
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      department: "CONSULTATION",
      tokenNumber: tokenNo,
      bookingReference: masterBarcode,
      status: "WAITING",
      appointmentDate: new Date()
    }
  });

  console.log(JSON.stringify({
    success: true,
    masterBarcode,
    patientId: patient.id,
    patientName: patient.fullName,
    patientPhone: patient.phone,
    doctorId: doctor.id,
    doctorName: doctor.fullName,
    doctorEmail: doctor.email,
    visitId: appointment.id,
    tokenNumber: appointment.tokenNumber,
    medicineId: medicine.id,
    medicineName: medicine.name
  }));
}

run()
  .catch((err) => {
    console.error("Setup error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
