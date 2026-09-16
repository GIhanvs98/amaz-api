import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const initialTests = [
  {
    name: 'Full Blood Count (FBC)',
    category: 'Hematology',
    price: 800,
    referenceRange: null, // Multiple biomarkers
  },
  {
    name: 'Fasting Blood Sugar (FBS)',
    category: 'Biochemistry',
    price: 450,
    referenceRange: '70-100',
    unit: 'mg/dL'
  },
  {
    name: 'Lipid Profile',
    category: 'Biochemistry',
    price: 1500,
    referenceRange: null, // Multiple biomarkers (Cholesterol, Triglycerides, etc.)
  },
  {
    name: 'Thyroid Stimulating Hormone (TSH)',
    category: 'Endocrinology',
    price: 1200,
    referenceRange: '0.4-4.0',
    unit: 'mIU/L'
  },
  {
    name: 'Urine Full Report (UFR)',
    category: 'Pathology',
    price: 350,
    referenceRange: null, // Multiple parameters
  }
];

async function main() {
  console.log('Seeding Lab Test Catalog...');
  for (const test of initialTests) {
    await prisma.labTestCatalog.create({
      data: test
    });
    console.log(`Added ${test.name}`);
  }
  console.log('Lab Catalog seeded successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
