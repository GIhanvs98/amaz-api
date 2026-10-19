import { PrismaClient } from "@prisma/client";
import { generateIdentityKey } from "../src/utils/identity.util.js";
import { generateMRN } from "../src/utils/mrn.util.js";

const prisma = new PrismaClient();

async function main() {
  const phone = process.argv[2] || `076${Math.floor(1000000 + Math.random() * 9000000)}`;
  const barcodeKamal = `77${Math.floor(10000000 + Math.random() * 90000000)}`;
  const barcodeAmara = `78${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Find a doctor
  const doctor = await prisma.user.findFirst({
    where: { Role: { name: 'Doctor' }, isActive: true },
    include: { room: true }
  });
  const doctorId = doctor ? doctor.id : null;

  // Find or create medicine
  let med1 = await prisma.medicine.findFirst({ where: { name: "Amoxicillin 500mg" } });
  if (!med1) {
    med1 = await prisma.medicine.create({
      data: {
        name: "Amoxicillin 500mg",
        genericName: "Amoxicillin",
        category: "Antibiotics",
        form: "Capsule",
        unit: "capsule",
        retailPrice: 25.00
      }
    });
  }

  // Find or create lab test
  let labTest = await prisma.labTest.findFirst({ where: { code: "FBC" } });
  if (!labTest) {
    labTest = await prisma.labTest.create({
      data: {
        name: "Full Blood Count",
        code: "FBC",
        category: "Hematology",
        price: 1200.00
      }
    });
  }

  // 1. Clean up phone if existing
  const existing = await prisma.patient.findMany({
    where: { phone },
    select: { id: true }
  });
  const ids = existing.map(e => e.id);
  if (ids.length > 0) {
    const labReqs = await prisma.labRequest.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
    const labIds = labReqs.map(l => l.id);
    if (labIds.length > 0) {
      await prisma.labRequestItem.deleteMany({ where: { labRequestId: { in: labIds } } });
      await prisma.labRequest.deleteMany({ where: { id: { in: labIds } } });
    }

    const rxList = await prisma.prescription.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
    const rxIds = rxList.map(r => r.id);
    if (rxIds.length > 0) {
      await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: rxIds } } });
      await prisma.prescription.deleteMany({ where: { id: { in: rxIds } } });
    }

    const invList = await prisma.invoice.findMany({ where: { patientId: { in: ids } }, select: { id: true } });
    const invIds = invList.map(i => i.id);
    if (invIds.length > 0) {
      await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invIds } } });
      await prisma.invoicePayment.deleteMany({ where: { invoiceId: { in: invIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
    }

    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });
  }

  // 2. Create Kamal (Age 24)
  const mrn1 = await generateMRN(prisma);
  const key1 = generateIdentityKey("Kamal PortalTest", phone);
  const patient1 = await prisma.patient.create({
    data: {
      patientId: mrn1,
      identityKey: key1,
      fullName: "Kamal PortalTest",
      phone,
      ageFallback: 24,
      gender: "MALE",
      bloodGroup: "O+"
    }
  });

  // 3. Create Amara (Age 56)
  const mrn2 = await generateMRN(prisma);
  const key2 = generateIdentityKey("Amara PortalTest", phone);
  const patient2 = await prisma.patient.create({
    data: {
      patientId: mrn2,
      identityKey: key2,
      fullName: "Amara PortalTest",
      phone,
      ageFallback: 56,
      gender: "FEMALE",
      bloodGroup: "B+"
    }
  });

  // 4. Create Kamal's Today Appointment (Active Visit)
  const today = new Date();
  const appt1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId,
      department: "CONSULTATION",
      tokenNumber: "08",
      appointmentDate: today,
      bookingReference: barcodeKamal,
      bookingType: "WALK_IN",
      status: "BOOKED"
    }
  });

  // 5. Create Kamal's Prescription with directions
  const rx1 = await prisma.prescription.create({
    data: {
      patientId: patient1.id,
      patientName: patient1.fullName,
      visitId: barcodeKamal,
      doctorId: doctorId || "c5142551-d513-4451-a97b-d10fcbefaa12",
      doctorName: doctor?.fullName || "Dr. V.K.P.A. Mahesh Lakshman",
      diagnosis: "Acute Upper Respiratory Tract Infection",
      clinicalNotes: "Drink plenty of warm water. Complete antibiotic course.",
      status: "DISPENSED",
      items: {
        create: [
          {
            drugName: med1.name,
            dosage: "500mg",
            frequency: "1-0-1",
            instructions: "Take after meals with water",
            duration: "5 days",
            medicineId: med1.id
          }
        ]
      }
    }
  });

  // 6. Create Kamal's Lab Appointment & Lab Request
  const labAppt1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      department: "LAB",
      tokenNumber: "03",
      appointmentDate: today,
      bookingReference: barcodeKamal,
      bookingType: "WALK_IN",
      status: "BOOKED"
    }
  });

  const labReq1 = await prisma.labRequest.create({
    data: {
      patientId: patient1.id,
      visitId: appt1.id,
      status: "SAMPLE_COLLECTED",
      priority: "ROUTINE",
      items: {
        create: [
          {
            labTestId: labTest.id,
            price: labTest.price
          }
        ]
      }
    }
  });

  // 7. Create Kamal's Invoice
  const inv1 = await prisma.invoice.create({
    data: {
      visitId: barcodeKamal,
      patientId: patient1.id,
      subtotal: 3700.00,
      discountAmount: 0,
      totalAmount: 3700.00,
      status: "PAID",
      lineItems: {
        create: [
          {
            description: "Doctor Consultation Fee",
            department: "CONSULTATION",
            quantity: 1,
            unitPrice: 2500.00,
            total: 2500.00
          },
          {
            description: "Full Blood Count (FBC)",
            department: "LAB",
            quantity: 1,
            unitPrice: 1200.00,
            total: 1200.00
          }
        ]
      },
      payments: {
        create: [
          {
            amount: 3700.00,
            method: "CASH",
            status: "COMPLETED"
          }
        ]
      }
    }
  });

  // 8. Create Amara's Past Appointment (Yesterday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const appt2 = await prisma.appointment.create({
    data: {
      patientId: patient2.id,
      doctorId,
      department: "CONSULTATION",
      tokenNumber: "02",
      appointmentDate: yesterday,
      bookingReference: barcodeAmara,
      bookingType: "WALK_IN",
      status: "COMPLETED"
    }
  });

  const payload = {
    phone,
    patient1: {
      id: patient1.id,
      fullName: patient1.fullName,
      barcode: barcodeKamal,
      token: "08",
      rxId: rx1.id,
      labId: labReq1.id,
      invId: inv1.id
    },
    patient2: {
      id: patient2.id,
      fullName: patient2.fullName,
      barcode: barcodeAmara,
      token: "02"
    }
  };

  console.log(JSON.stringify(payload));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
