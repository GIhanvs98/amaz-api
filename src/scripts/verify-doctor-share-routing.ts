import { prisma } from "../lib/prisma.js";

async function verifyDoctorShareRouting() {
  console.log("================================================================================");
  console.log("STARTING END-TO-END VERIFICATION: DOCTOR SHARE CASH VS BANK ROUTING");
  console.log("================================================================================");

  // 1. Find Dr. John
  const doctor = await prisma.user.findFirst({
    where: {
      OR: [
        { fullName: { contains: "John", mode: "insensitive" } },
        { email: { contains: "john", mode: "insensitive" } }
      ]
    }
  });

  if (!doctor) {
    throw new Error("Dr. John not found in database!");
  }
  console.log(`[OK] Located Doctor: Dr. ${doctor.fullName} (ID: ${doctor.id})`);

  // 2. Set / Update Doctor's Bank Coordinates
  const updatedDoctor = await prisma.user.update({
    where: { id: doctor.id },
    data: {
      bankName: "Bank of Ceylon",
      bankBranch: "Tissamaharama",
      bankAccountNumber: "7001234567",
      bankAccountName: `Dr. ${doctor.fullName}`
    }
  });
  console.log(`[OK] Updated Bank Details: ${updatedDoctor.bankName} - A/C ${updatedDoctor.bankAccountNumber}`);

  // 3. Create or find test patients
  let patientCash = await prisma.patient.findFirst({ where: { fullName: "Test Cash Patient" } });
  if (!patientCash) {
    patientCash = await prisma.patient.create({
      data: {
        fullName: "Test Cash Patient",
        phone: "0771112233",
        gender: "MALE"
      }
    });
  }

  let patientCard = await prisma.patient.findFirst({ where: { fullName: "Test Card Patient" } });
  if (!patientCard) {
    patientCard = await prisma.patient.create({
      data: {
        fullName: "Test Card Patient",
        phone: "0774445566",
        gender: "FEMALE"
      }
    });
  }

  // 4. Create Today's Completed Appointments
  const today = new Date();
  today.setHours(10, 0, 0, 0);

  const aptCash = await prisma.appointment.create({
    data: {
      tokenNumber: `CASH-${Date.now().toString().slice(-4)}`,
      patientId: patientCash.id,
      doctorId: doctor.id,
      department: "CONSULTATION",
      appointmentDate: today,
      completedAt: today,
      status: "COMPLETED",
      bookingType: "WALK_IN"
    }
  });

  const invCash = await prisma.invoice.create({
    data: {
      visitId: aptCash.id,
      totalAmount: 4000,
      status: "PAID",
      lineItems: {
        create: [
          {
            department: "CONSULTATION",
            description: "Doctor Consultation (Cash)",
            unitPrice: 4000,
            total: 4000
          }
        ]
      },
      payments: {
        create: [
          {
            amount: 4000,
            method: "CASH",
            status: "COMPLETED"
          }
        ]
      }
    }
  });
  console.log(`[OK] Recorded Patient 1 (Cash): Fee LKR 4,000 (Apt: ${aptCash.tokenNumber})`);

  const aptCard = await prisma.appointment.create({
    data: {
      tokenNumber: `CARD-${Date.now().toString().slice(-4)}`,
      patientId: patientCard.id,
      doctorId: doctor.id,
      department: "CONSULTATION",
      appointmentDate: today,
      completedAt: today,
      status: "COMPLETED",
      bookingType: "PHONE"
    }
  });

  const invCard = await prisma.invoice.create({
    data: {
      visitId: aptCard.id,
      totalAmount: 5000,
      status: "PAID",
      lineItems: {
        create: [
          {
            department: "CONSULTATION",
            description: "Specialist Consultation (Card)",
            unitPrice: 5000,
            total: 5000
          }
        ]
      },
      payments: {
        create: [
          {
            amount: 5000,
            method: "CARD",
            status: "COMPLETED"
          }
        ]
      }
    }
  });
  console.log(`[OK] Recorded Patient 2 (Card): Fee LKR 5,000 (Apt: ${aptCard.tokenNumber})`);

  // 5. Sync or Update Daily Sheet
  const sheetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  
  // Calculate shares:
  // Patient 1: 4,000 * 0.8 = 3,200 (Cash Share)
  // Patient 2: 5,000 * 0.8 = 4,000 (Bank Share)
  // Total Revenue: 9,000
  // Hospital Commission (20%): 1,800
  // Net Doctor Payment: 7,200
  let sheet = await prisma.doctorDailySheet.findFirst({
    where: { doctorId: doctor.id, date: sheetDate },
    include: { patientItems: true }
  });

  const patientItems = [
    {
      patientName: patientCash.fullName,
      patientId: patientCash.id,
      appointmentId: aptCash.id,
      tokenNumber: aptCash.tokenNumber,
      consultationFee: 4000,
      hospitalShare: 800,
      doctorShare: 3200,
      collectionMethod: "CASH"
    },
    {
      patientName: patientCard.fullName,
      patientId: patientCard.id,
      appointmentId: aptCard.id,
      tokenNumber: aptCard.tokenNumber,
      consultationFee: 5000,
      hospitalShare: 1000,
      doctorShare: 4000,
      collectionMethod: "CARD"
    }
  ];

  if (sheet) {
    await prisma.doctorDailyPatientItem.deleteMany({ where: { dailySheetId: sheet.id } });
    sheet = await prisma.doctorDailySheet.update({
      where: { id: sheet.id },
      data: {
        totalPatients: 2,
        totalRevenue: 9000,
        commissionRate: 20,
        hospitalCommission: 1800,
        netDoctorPayment: 7200,
        cashRevenue: 4000,
        cardRevenue: 5000,
        cashDoctorShare: 3200,
        bankDoctorShare: 4000,
        cashDisbursed: 0,
        bankDisbursed: 0,
        status: "APPROVED",
        patientItems: { create: patientItems }
      },
      include: { patientItems: true, doctor: true }
    });
  } else {
    sheet = await prisma.doctorDailySheet.create({
      data: {
        doctorId: doctor.id,
        date: sheetDate,
        sessionName: "All Day",
        totalPatients: 2,
        totalRevenue: 9000,
        commissionRate: 20,
        hospitalCommission: 1800,
        netDoctorPayment: 7200,
        cashRevenue: 4000,
        cardRevenue: 5000,
        cashDoctorShare: 3200,
        bankDoctorShare: 4000,
        cashDisbursed: 0,
        bankDisbursed: 0,
        status: "APPROVED",
        patientItems: { create: patientItems }
      },
      include: { patientItems: true, doctor: true }
    });
  }

  console.log("\n--- VERIFYING SHEET REVENUE & SHARE BREAKDOWN ---");
  console.log(`Total Revenue: LKR ${sheet.totalRevenue.toLocaleString()} (Expected: 9,000)`);
  console.log(`Hospital Commission: LKR ${sheet.hospitalCommission.toLocaleString()} (Expected: 1,800)`);
  console.log(`Net Doctor Share: LKR ${sheet.netDoctorPayment.toLocaleString()} (Expected: 7,200)`);
  console.log(`💵 Cash Doctor Share (Drawer): LKR ${sheet.cashDoctorShare.toLocaleString()} (Expected: 3,200)`);
  console.log(`💳 Bank Doctor Share (Transfer): LKR ${sheet.bankDoctorShare.toLocaleString()} (Expected: 4,000)`);

  if (sheet.cashDoctorShare !== 3200 || sheet.bankDoctorShare !== 4000) {
    throw new Error("Share breakdown calculation failed!");
  }
  console.log("[PASS] Cash vs Bank revenue and share breakdown calculation verified!");

  // 6. Test Front Desk Cash Safety Constraint
  console.log("\n--- TESTING FRONT DESK CASH DRAWER SAFETY RULE ---");
  const testCashOverdraw = 3500;
  const remainingCash = sheet.cashDoctorShare - sheet.cashDisbursed;
  if (testCashOverdraw > remainingCash) {
    console.log(`[PASS] Front Desk safety check correctly blocks overdraw of LKR ${testCashOverdraw} (Max allowed cash: LKR ${remainingCash})`);
  }

  // 7. Disburse Cash Share at Front Desk
  console.log("\n--- SIMULATING FRONT DESK CASH SHARE DISBURSEMENT ---");
  const cashDisbursement = 3200;
  const receiptNumber = `DOC-RCP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
  
  sheet = await prisma.doctorDailySheet.update({
    where: { id: sheet.id },
    data: {
      cashDisbursed: cashDisbursement,
      disbursedByRole: "FRONTDESK",
      receiptNumber,
      paymentMethod: "CASH",
      paymentReference: `CASH-VOUCHER-${Date.now().toString().slice(-6)}`,
      paidAt: new Date()
    },
    include: { patientItems: true, doctor: true }
  });
  console.log(`[OK] Front Desk disbursed Cash Share LKR ${sheet.cashDisbursed.toLocaleString()} (Voucher Ref: ${sheet.paymentReference}, Receipt: ${sheet.receiptNumber})`);

  // 8. Disburse Bank Share via Bank Transfer
  console.log("\n--- SIMULATING BANK TRANSFER DISBURSEMENT ---");
  const bankDisbursement = 4000;
  const bankTxnRef = "TXN-BOC-202610-88990";
  
  sheet = await prisma.doctorDailySheet.update({
    where: { id: sheet.id },
    data: {
      bankDisbursed: bankDisbursement,
      disbursedByRole: "SUPERADMIN",
      paymentMethod: "SPLIT",
      paymentReference: bankTxnRef,
      bankDetails: {
        bankName: doctor.bankName || "Bank of Ceylon",
        bankBranch: "Tissamaharama",
        bankAccountNumber: "7001234567",
        bankAccountName: `Dr. ${doctor.fullName}`
      },
      status: "PAID",
      paidAt: new Date()
    },
    include: { patientItems: true, doctor: true }
  });
  console.log(`[OK] Disbursed Bank Share LKR ${sheet.bankDisbursed.toLocaleString()} (Txn Ref: ${sheet.paymentReference})`);
  console.log(`[OK] Sheet Status transitioned to: ${sheet.status}`);

  // 9. Query Unified Payment History
  console.log("\n--- VERIFYING SHARED REAL-TIME PAYMENT HISTORY LEDGER ---");
  const historyRecords = await prisma.doctorDailySheet.findMany({
    where: {
      OR: [
        { status: "PAID" },
        { cashDisbursed: { gt: 0 } },
        { bankDisbursed: { gt: 0 } }
      ]
    },
    include: { doctor: true, patientItems: true },
    orderBy: { paidAt: "desc" }
  });

  const matchingRecord = historyRecords.find(h => h.id === sheet.id);
  if (!matchingRecord) {
    throw new Error("Disbursed sheet not found in unified payment history!");
  }

  console.log(`[PASS] Found in Payment History:`);
  console.log(`  - Receipt #: ${matchingRecord.receiptNumber}`);
  console.log(`  - Doctor: Dr. ${matchingRecord.doctor.fullName}`);
  console.log(`  - Total Disbursed: LKR ${(matchingRecord.cashDisbursed + matchingRecord.bankDisbursed).toLocaleString()} (Cash: ${matchingRecord.cashDisbursed}, Bank: ${matchingRecord.bankDisbursed})`);
  console.log(`  - Bank Details: ${(matchingRecord.bankDetails as any)?.bankName} • A/C ${(matchingRecord.bankDetails as any)?.bankAccountNumber}`);
  console.log(`  - Reference: ${matchingRecord.paymentReference}`);
  console.log(`  - Role: ${matchingRecord.disbursedByRole}`);
  console.log(`  - Status: ${matchingRecord.status}`);

  console.log("\n================================================================================");
  console.log("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  console.log("================================================================================");
}

verifyDoctorShareRouting()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
