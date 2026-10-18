import { prisma } from "../lib/prisma.js";

async function verifyJohnShare() {
  console.log("================================================================================");
  console.log("VERIFYING DR. JOHN DAVIS EARNINGS & DOCTOR SHARE");
  console.log("================================================================================");

  const doc = await prisma.user.findFirst({
    where: { fullName: { contains: "John", mode: "insensitive" } },
    include: { Role: true }
  });

  if (!doc) {
    throw new Error("Dr. John Davis not found in database");
  }

  console.log(`Doctor: ${doc.fullName} (${doc.id})`);
  console.log(`Specialty: ${doc.specialty}`);
  console.log(`Commission Rate: ${doc.commissionRate}%`);

  const sheets = await prisma.doctorDailySheet.findMany({
    where: { doctorId: doc.id },
    include: {
      patientItems: true
    },
    orderBy: { date: "desc" }
  });

  console.log(`\nFound ${sheets.length} daily sheet(s) for Dr. John:`);
  for (const s of sheets) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Sheet ID: ${s.id}`);
    console.log(`Date: ${s.date.toISOString().split("T")[0]}`);
    console.log(`Status: ${s.status}`);
    console.log(`Total Patients: ${s.totalPatients}`);
    console.log(`Gross Consultation Revenue: LKR ${s.totalRevenue.toLocaleString()}`);
    console.log(`Hospital Commission (${s.commissionRate}%): LKR ${s.hospitalCommission.toLocaleString()}`);
    console.log(`Doctor Net Share: LKR ${s.netDoctorPayment.toLocaleString()}`);
    console.log(`Patient Roster (${s.patientItems.length} records):`);
    for (const item of s.patientItems) {
      console.log(`  * Patient: ${item.patientName} (Token: ${item.tokenNumber})`);
      console.log(`    Consultation Fee: LKR ${item.consultationFee.toLocaleString()}`);
      console.log(`    Hospital Share: LKR ${item.hospitalShare.toLocaleString()}`);
      console.log(`    Doctor Share: LKR ${item.doctorShare.toLocaleString()}`);
    }
  }

  if (sheets.length === 0 || !sheets[0] || sheets[0].netDoctorPayment <= 0) {
    throw new Error("Dr. John's doctor share is not appearing properly!");
  }

  console.log("\n================================================================================");
  console.log("[PASS] DR. JOHN'S SHARE IS RECORDED & DISPLAYED PROPERLY (LKR " + sheets[0]!.netDoctorPayment.toLocaleString() + ")!");
  console.log("================================================================================");
}

verifyJohnShare().catch(console.error).finally(() => prisma.$disconnect());
