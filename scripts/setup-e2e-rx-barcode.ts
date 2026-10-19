import "dotenv/config";
import process from "node:process";
import { prisma } from "../src/lib/prisma.js";
import { clearCache } from "../src/middlewares/cache.middleware.js";

async function run() {
  await clearCache("pharmacy/medicines");
  const masterBarcode = process.argv[2] || `99${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 1. Create a dedicated test patient for this barcode cycle
  const patientPhone = `077${Math.floor(1000000 + Math.random() * 9000000)}`;
  const patient = await prisma.patient.create({
    data: {
      fullName: `Rx Test Patient ${masterBarcode.slice(-4)}`,
      phone: patientPhone,
      gender: "Female",
      ageFallback: 28
    }
  });

  // 2. Get Doctor
  const doctor = await prisma.user.findFirst({
    where: { Role: { name: "Doctor" } },
    include: { room: true }
  });
  if (!doctor) throw new Error("No Doctor found");

  // 3. Ensure Medicine with StockBatch exists
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
            currentQuantity: 100,
            initialQuantity: 100,
            unitPrice: 45,
            costPrice: 30,
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        }
      },
      include: { stockBatches: true }
    });
  }
  // Ensure all stock batches for this medicine have ample stock for testing
  await prisma.stockBatch.updateMany({
    where: { medicineId: medicine.id },
    data: { currentQuantity: 500 }
  });
  const batchCount = await prisma.stockBatch.count({ where: { medicineId: medicine.id } });
  if (batchCount === 0) {
    await prisma.stockBatch.create({
      data: {
        medicineId: medicine.id,
        batchNumber: "BAT-AMOX-01",
        currentQuantity: 500,
        initialQuantity: 500,
        unitPrice: 45,
        costPrice: 30,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });
  }

  if (!medicine) throw new Error("Medicine not found or created");

  // 4. Create consultation appointment with masterBarcode
  const appt = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor.id,
      department: "CONSULTATION",
      tokenNumber: "15",
      bookingReference: masterBarcode,
      status: "WAITING",
      appointmentDate: new Date()
    }
  });

  // 5. Create PAID invoice for consultation fee
  const invoice = await prisma.invoice.create({
    data: {
      visitId: appt.id,
      patientId: patient.id,
      status: "PAID",
      subtotal: 2500,
      totalAmount: 2500,
      lineItems: {
        create: [
          { department: "CONSULTATION", description: `Doctor Consultation - Token #15`, quantity: 1, unitPrice: 2500, total: 2500 }
        ]
      }
    }
  });

  // 6. Create PENDING prescription with medicine
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
            dispenseQty: 15
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
    appointmentId: appt.id,
    prescriptionId: prescription.id,
    medicineId: medicine.id,
    medicineName: medicine.name,
    invoiceId: invoice.id
  }));

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
