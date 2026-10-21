import "dotenv/config";
import process from "node:process";
import { prisma } from "../src/lib/prisma.js";
import { clearCache } from "../src/middlewares/cache.middleware.js";

async function run() {
  await clearCache("pharmacy/medicines");
  const masterBarcode = process.argv[2] || `EXS99${Math.floor(100000 + Math.random() * 900000)}`;

  // 1. Create test patient
  const patientPhone = `077${Math.floor(1000000 + Math.random() * 9000000)}`;
  const patient = await prisma.patient.create({
    data: {
      fullName: `Extra Svc Patient ${masterBarcode.slice(-4)}`,
      phone: patientPhone,
      gender: "Male",
      ageFallback: 35
    }
  });

  // 2. Doctor
  const doctor = await prisma.user.findFirst({
    where: { Role: { name: "Doctor" } },
    include: { room: true }
  });
  if (!doctor) throw new Error("No Doctor found");

  // 3. Extra Service
  let extraService = await prisma.extraService.findFirst({
    where: { isActive: true }
  });
  if (!extraService) {
    extraService = await prisma.extraService.create({
      data: {
        code: "EXS-ECG",
        title: "Standard ECG Recording",
        description: "12-lead ECG procedure",
        price: 800,
        isActive: true
      }
    });
  }

  // 4. Medicine with batch
  let medicine = await prisma.medicine.findFirst({
    where: { name: "Amoxicillin 500mg" },
    include: { stockBatches: true }
  });
  if (!medicine) {
    medicine = await prisma.medicine.create({
      data: {
        name: "Amoxicillin 500mg",
        genericName: "Amoxicillin",
        category: "Antibiotics",
        unit: "capsule",
        retailPrice: 45,
        stockBatches: {
          create: {
            batchNumber: "BAT-AMOX-01",
            currentQuantity: 500,
            initialQuantity: 500,
            unitPrice: 45,
            costPrice: 30,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        }
      },
      include: { stockBatches: true }
    });
  } else {
    await prisma.stockBatch.updateMany({
      where: { medicineId: medicine.id },
      data: { currentQuantity: 500 }
    });
  }

  // 5. Create Consultation Appointment
  const appt = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      department: "CONSULTATION",
      tokenNumber: "22",
      bookingReference: masterBarcode,
      status: "WAITING",
      appointmentDate: new Date()
    }
  });

  // 6. Create Extra Service Order
  const extraOrder = await prisma.extraServiceOrder.create({
    data: {
      orderNumber: `EXS-${Date.now().toString().slice(-6)}`,
      serviceId: extraService.id,
      patientId: patient.id,
      doctorId: doctor.id,
      visitId: appt.id,
      finalPrice: 800,
      status: "COMPLETED",
      completedAt: new Date()
    }
  });

  // 7. Create DRAFT Invoice with Consultation and Extra Service Line Items
  const draftInvoice = await prisma.invoice.create({
    data: {
      visitId: appt.id,
      patientId: patient.id,
      status: "DRAFT",
      subtotal: 2300,
      totalAmount: 2300,
      lineItems: {
        create: [
          {
            department: "CONSULTATION",
            description: `Doctor Consultation - Dr. ${doctor.fullName}`,
            quantity: 1,
            unitPrice: 1500,
            total: 1500
          },
          {
            department: "EXTRA_SERVICE",
            referenceId: extraOrder.id,
            description: `Extra Service: ${extraService.title}`,
            quantity: 1,
            unitPrice: 800,
            total: 800
          }
        ]
      }
    },
    include: { lineItems: true }
  });

  // 8. Create PENDING prescription
  const prescription = await prisma.prescription.create({
    data: {
      patientId: patient.id,
      patientName: patient.fullName,
      doctorId: doctor.id,
      doctorName: doctor.fullName,
      visitId: appt.id,
      status: "PENDING",
      clinicalNotes: "Take after meals",
      items: {
        create: [
          {
            medicineId: medicine.id,
            drugName: medicine.name,
            dosage: "1 tablet",
            frequency: "Three times a day",
            duration: "5 days",
            dispenseQty: 10
          }
        ]
      }
    },
    include: { items: true }
  });

  console.log(JSON.stringify({
    masterBarcode,
    patientId: patient.id,
    patientName: patient.fullName,
    patientPhone,
    appointmentId: appt.id,
    serviceId: extraService.id,
    serviceTitle: extraService.title,
    orderId: extraOrder.id,
    prescriptionId: prescription.id,
    medicineId: medicine.id,
    medicineName: medicine.name,
    invoiceId: draftInvoice.id,
    consultationFee: 1500,
    serviceFee: 800,
    medicinePrice: 45,
    medicineQty: 10,
    expectedMedicineTotal: 450,
    expectedTotal: 2750
  }));

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
