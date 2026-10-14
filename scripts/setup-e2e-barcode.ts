import { prisma } from "../src/lib/prisma.js";

async function run() {
  const masterBarcode = process.argv[2] || `99${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 1. Get or create a patient
  let patient = await prisma.patient.findFirst({
    where: { phone: "0771122334" }
  });
  if (!patient) {
    patient = await prisma.patient.create({
      data: {
        fullName: "Universal Barcode Test Patient",
        phone: "0771122334",
        gender: "Male",
        ageFallback: 35
      }
    });
  }

  // 2. Get Doctor
  const doctor = await prisma.user.findFirst({
    where: { Role: { name: "Doctor" } },
    include: { room: true }
  });

  // 3. Ensure Lab Tests exist
  let labTests = await prisma.labTest.findMany({ take: 3 });
  if (labTests.length < 3) {
    const t1 = await prisma.labTest.create({
      data: { name: "Full Blood Count", code: "FBC", price: 1500, category: "Hematology" }
    });
    const t2 = await prisma.labTest.create({
      data: { name: "Lipid Profile", code: "LIPID", price: 2500, category: "Biochemistry" }
    });
    const t3 = await prisma.labTest.create({
      data: { name: "Serum Creatinine", code: "CREAT", price: 1200, category: "Biochemistry" }
    });
    labTests = [t1, t2, t3];
  }

  // 4. Create 3 Appointments sharing the same masterBarcode
  const consultAppt = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId: doctor?.id,
      department: "CONSULTATION",
      tokenNumber: "08",
      bookingReference: masterBarcode,
      status: "WAITING"
    }
  });

  const labAppt = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      department: "LAB",
      tokenNumber: "03",
      bookingReference: masterBarcode,
      status: "WAITING"
    }
  });

  const extraAppt = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      department: "EXTRA_SERVICE",
      tokenNumber: "02",
      bookingReference: masterBarcode,
      status: "WAITING"
    }
  });

  // 5. Create Lab Requests:
  // Frontdesk booked tests (linked to labAppt)
  const fdLabReq = await prisma.labRequest.create({
    data: {
      patientId: patient.id,
      visitId: labAppt.id,
      status: "PENDING",
      priority: "ROUTINE",
      items: {
        create: [
          { labTestId: labTests[0].id, price: labTests[0].price },
          { labTestId: labTests[1].id, price: labTests[1].price }
        ]
      }
    }
  });

  // Doctor ordered test (linked to consultAppt with doctorId)
  const docLabReq = await prisma.labRequest.create({
    data: {
      patientId: patient.id,
      visitId: consultAppt.id,
      doctorId: doctor?.id,
      status: "PENDING",
      priority: "URGENT",
      items: {
        create: [
          { labTestId: labTests[2].id, price: labTests[2].price }
        ]
      }
    }
  });

  // 6. Create Extra Service item
  let extraService = await prisma.extraService.findFirst({
    where: { title: "Wound Dressing" }
  });
  if (!extraService) {
    extraService = await prisma.extraService.create({
      data: {
        title: "Wound Dressing",
        barcode: "EXT-WD-01",
        price: 800,
        description: "PROCEDURE"
      }
    });
  }

  // 7. Create DRAFT Invoice on consultAppt
  const invoice = await prisma.invoice.create({
    data: {
      visitId: consultAppt.id,
      patientId: patient.id,
      status: "DRAFT",
      subtotal: 5000,
      totalAmount: 5000,
      lineItems: {
        create: [
          { department: "CONSULTATION", description: `Doctor Consultation - Token #08`, quantity: 1, unitPrice: 2500, total: 2500 },
          { department: "EXTRA_SERVICE", description: `${extraService.title} - PROCEDURE`, quantity: 1, unitPrice: 800, total: 800 }
        ]
      }
    }
  });

  console.log(JSON.stringify({
    masterBarcode,
    patientId: patient.id,
    patientName: patient.fullName,
    consultApptId: consultAppt.id,
    labApptId: labAppt.id,
    extraApptId: extraAppt.id,
    fdLabReqId: fdLabReq.id,
    docLabReqId: docLabReq.id,
    invoiceId: invoice.id
  }));

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
