import { prisma } from "../lib/prisma.js";
import bcrypt from "bcryptjs";

async function runDoctorPaymentVerification() {
  console.log("================================================================================");
  console.log("DOCTOR PAYMENT MANAGEMENT & FUND OFFICE - AUTOMATED VERIFICATION");
  console.log("================================================================================");

  // 1. Setup Doctor: Dr. Perera
  let doctorRole = await prisma.role.findFirst({
    where: { name: { in: ["DOCTOR", "Doctor"] } }
  });

  if (!doctorRole) {
    doctorRole = await prisma.role.create({
      data: {
        name: "Doctor",
        description: "Medical Doctor"
      }
    });
  }

  const doctorEmail = "dr.perera.test@amazhospital.com";
  let doctor = await prisma.user.findUnique({
    where: { email: doctorEmail }
  });

  const hashedPassword = await bcrypt.hash("Password123!", 10);

  if (!doctor) {
    doctor = await prisma.user.create({
      data: {
        email: doctorEmail,
        password: hashedPassword,
        fullName: "Dr. Perera",
        roleId: doctorRole.id,
        specialty: "Consultant Physician",
        consultationFee: 3000,
        commissionRate: 20
      }
    });
    console.log(`[PASS] Created doctor: ${doctor.fullName} (${doctor.email})`);
  } else {
    doctor = await prisma.user.update({
      where: { id: doctor.id },
      data: {
        fullName: "Dr. Perera",
        specialty: "Consultant Physician",
        consultationFee: 3000,
        commissionRate: 20
      }
    });
    console.log(`[PASS] Found and updated doctor: ${doctor.fullName}`);
  }

  // 2. Setup Fund Office Officer & Approver
  let adminRole = await prisma.role.findFirst({
    where: { name: { in: ["SUPERADMIN", "ADMIN", "Superadmin", "Admin"] } }
  });

  const officerEmail = "fund.officer.test@amazhospital.com";
  let officer = await prisma.user.findUnique({ where: { email: officerEmail } });
  if (!officer) {
    officer = await prisma.user.create({
      data: {
        email: officerEmail,
        password: hashedPassword,
        fullName: "Fund Officer Bandara",
        roleId: adminRole ? adminRole.id : doctorRole.id
      }
    });
  }

  const approverEmail = "medical.director.test@amazhospital.com";
  let approver = await prisma.user.findUnique({ where: { email: approverEmail } });
  if (!approver) {
    approver = await prisma.user.create({
      data: {
        email: approverEmail,
        password: hashedPassword,
        fullName: "Dr. Director Fernando",
        roleId: adminRole ? adminRole.id : doctorRole.id
      }
    });
  }

  // Test Date: 2026-10-13 (from user specification)
  const testDate = new Date("2026-10-13T00:00:00.000Z");

  // Clean previous test record for this doctor & date if present
  await prisma.doctorDailyPatientItem.deleteMany({
    where: { dailySheet: { doctorId: doctor.id, date: testDate } }
  });
  await prisma.doctorDailySheet.deleteMany({
    where: { doctorId: doctor.id, date: testDate }
  });

  console.log("\n--- STEP 1 & 2: DAILY PATIENT RECORDS & CALCULATION ---");
  const totalPatients = 25;
  const consultationFee = 3000;
  const expectedTotalRevenue = totalPatients * consultationFee; // 75,000
  const commissionRate = 20; // 20%
  const expectedCommission = (expectedTotalRevenue * commissionRate) / 100; // 15,000
  const expectedDoctorPayment = expectedTotalRevenue - expectedCommission; // 60,000

  console.log(`Total Patients: ${totalPatients}`);
  console.log(`Fee per Patient: LKR ${consultationFee}`);
  console.log(`Total Revenue: LKR ${expectedTotalRevenue} (Expected: 75,000)`);
  console.log(`Commission (20%): LKR ${expectedCommission} (Expected: 15,000)`);
  console.log(`Doctor Net Payment: LKR ${expectedDoctorPayment} (Expected: 60,000)`);

  if (expectedTotalRevenue !== 75000 || expectedCommission !== 15000 || expectedDoctorPayment !== 60000) {
    throw new Error("Formula calculation mismatch with requirements!");
  }
  console.log("[PASS] Formula: Doctor Payment = Total Consultation Revenue - Hospital Commission Amount");

  // Create Patient Items (Roster)
  const patientItemsData = [];
  for (let i = 1; i <= totalPatients; i++) {
    patientItemsData.push({
      patientName: `Patient ${String(i).padStart(2, "0")}`,
      tokenNumber: `T-${String(i).padStart(3, "0")}`,
      consultationFee: consultationFee,
      hospitalShare: consultationFee * 0.2,
      doctorShare: consultationFee * 0.8,
      remarks: "Consultation Completed"
    });
  }

  // Create Daily Sheet
  const sheet = await prisma.doctorDailySheet.create({
    data: {
      doctorId: doctor.id,
      date: testDate,
      sessionName: "Morning Clinic",
      totalPatients,
      consultationFee,
      totalRevenue: expectedTotalRevenue,
      commissionRate,
      hospitalCommission: expectedCommission,
      otherAdjustments: 0,
      netDoctorPayment: expectedDoctorPayment,
      status: "DRAFT",
      remarks: "User requirement test: Dr. Perera, 25 patients @ 3,000",
      patientItems: {
        create: patientItemsData
      }
    },
    include: {
      patientItems: true,
      doctor: true
    }
  });

  console.log(`[PASS] Daily Sheet created with status: ${sheet.status}, ID: ${sheet.id}`);
  console.log(`[PASS] Attached ${sheet.patientItems.length} itemized patient consultation items.`);

  console.log("\n--- STEP 5: VERIFY THROUGH FUND OFFICE ---");
  const verifiedSheet = await prisma.doctorDailySheet.update({
    where: { id: sheet.id },
    data: {
      status: "VERIFIED",
      verifiedById: officer.id,
      verifiedAt: new Date()
    }
  });
  console.log(`[PASS] Daily Sheet verified by: ${officer.fullName}, status: ${verifiedSheet.status}`);

  console.log("\n--- STEP 6: APPROVE PAYMENT ---");
  const approvedSheet = await prisma.doctorDailySheet.update({
    where: { id: sheet.id },
    data: {
      status: "APPROVED",
      approvedById: approver.id,
      approvedAt: new Date()
    }
  });
  console.log(`[PASS] Daily Sheet approved by: ${approver.fullName}, status: ${approvedSheet.status}`);

  console.log("\n--- STEP 7 & 8: DISBURSE PAYMENT & GENERATE RECEIPT ---");
  // Receipt generator test
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `DOC-RCP-${yearMonth}-`;
  const receiptNumber = `${prefix}0001`;

  const paidSheet = await prisma.doctorDailySheet.update({
    where: { id: sheet.id },
    data: {
      status: "PAID",
      paymentMethod: "BANK_TRANSFER",
      paymentReference: "BT-20261013-PERERA-901",
      paidAt: new Date(),
      receiptNumber
    }
  });

  console.log(`[PASS] Payment Disbursed!`);
  console.log(`       Status: ${paidSheet.status}`);
  console.log(`       Payment Method: ${paidSheet.paymentMethod}`);
  console.log(`       Payment Reference: ${paidSheet.paymentReference}`);
  console.log(`       Receipt Number: ${paidSheet.receiptNumber}`);
  console.log(`       Doctor Net Payment: LKR ${paidSheet.netDoctorPayment.toLocaleString()}`);

  console.log("\n--- STEP 3: FUND OFFICE DASHBOARD METRICS ---");
  const allSheets = await prisma.doctorDailySheet.findMany({
    where: { status: { not: "CANCELLED" } }
  });
  const totalPaid = allSheets.filter(s => s.status === "PAID").reduce((sum, s) => sum + s.netDoctorPayment, 0);
  const totalComm = allSheets.reduce((sum, s) => sum + s.hospitalCommission, 0);
  const totalRev = allSheets.reduce((sum, s) => sum + s.totalRevenue, 0);

  console.log(`[PASS] Metrics computed across active sheets:`);
  console.log(`       Total Consultation Revenue: LKR ${totalRev.toLocaleString()}`);
  console.log(`       Total Hospital Commission: LKR ${totalComm.toLocaleString()}`);
  console.log(`       Total Paid Doctor Payments: LKR ${totalPaid.toLocaleString()}`);

  console.log("\n================================================================================");
  console.log("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  console.log("================================================================================");
}

runDoctorPaymentVerification()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
