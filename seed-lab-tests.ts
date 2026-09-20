import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.labTest.createMany({
    data: [
      { name: "Complete Blood Count (FBC)", code: "FBC01", price: 650, category: "Hematology", sampleType: "Blood" },
      { name: "Fasting Blood Sugar (FBS)", code: "FBS01", price: 350, category: "Biochemistry", sampleType: "Blood" },
      { name: "Lipid Profile", code: "LIP01", price: 1200, category: "Biochemistry", sampleType: "Blood" },
      { name: "Liver Function Test (LFT)", code: "LFT01", price: 1500, category: "Biochemistry", sampleType: "Blood" },
      { name: "Urine Full Report (UFR)", code: "UFR01", price: 400, category: "Clinical Pathology", sampleType: "Urine" },
      { name: "Dengue Antigen (NS1)", code: "DEN01", price: 1800, category: "Serology", sampleType: "Blood" }
    ],
    skipDuplicates: true
  });
  console.log("Lab tests seeded!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
