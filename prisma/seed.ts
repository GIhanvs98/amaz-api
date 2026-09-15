import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Database with 10 Medicines...');

  // Hardcode fixed supplier so we can create purchase orders if needed later
  const supplier = await prisma.supplier.create({
    data: {
      name: 'Global Pharma Distributors',
      contactPerson: 'Sunil Perera',
      email: 'sales@globalpharma.lk',
      phone: '0112345678',
    },
  });

  const medicinesData = [
    {
      barcode: '1000000000001',
      name: 'Paracetamol 500mg',
      genericName: 'Paracetamol',
      category: 'Analgesic',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 500,
      price: 2.50,
      stock: 1200
    },
    {
      barcode: '1000000000002',
      name: 'Amoxicillin 250mg',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      form: 'Capsule',
      unit: 'mg',
      reorderLevel: 300,
      price: 15.00,
      stock: 800
    },
    {
      barcode: '1000000000003',
      name: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      category: 'Antibiotic',
      form: 'Capsule',
      unit: 'mg',
      reorderLevel: 400,
      price: 25.00,
      stock: 1000
    },
    {
      barcode: '1000000000004',
      name: 'Metformin 500mg',
      genericName: 'Metformin',
      category: 'Antidiabetic',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 600,
      price: 5.00,
      stock: 2000
    },
    {
      barcode: '1000000000005',
      name: 'Metformin 850mg',
      genericName: 'Metformin',
      category: 'Antidiabetic',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 500,
      price: 8.50,
      stock: 1500
    },
    {
      barcode: '1000000000006',
      name: 'Losartan 50mg',
      genericName: 'Losartan',
      category: 'Antihypertensive',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 200,
      price: 12.00,
      stock: 500
    },
    {
      barcode: '1000000000007',
      name: 'Amlodipine 5mg',
      genericName: 'Amlodipine',
      category: 'Antihypertensive',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 400,
      price: 4.50,
      stock: 1500
    },
    {
      barcode: '1000000000008',
      name: 'Atorvastatin 20mg',
      genericName: 'Atorvastatin',
      category: 'Lipid-lowering',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 300,
      price: 18.00,
      stock: 600
    },
    {
      barcode: '1000000000009',
      name: 'Omeprazole 20mg',
      genericName: 'Omeprazole',
      category: 'Proton Pump Inhibitor',
      form: 'Capsule',
      unit: 'mg',
      reorderLevel: 400,
      price: 6.00,
      stock: 800
    },
    {
      barcode: '1000000000010',
      name: 'Cetirizine 10mg',
      genericName: 'Cetirizine',
      category: 'Antihistamine',
      form: 'Tablet',
      unit: 'mg',
      reorderLevel: 300,
      price: 3.50,
      stock: 1000
    },
  ];

  for (const m of medicinesData) {
    const medicine = await prisma.medicine.upsert({
      where: { barcode: m.barcode },
      update: {},
      create: {
        barcode: m.barcode,
        name: m.name,
        genericName: m.genericName,
        category: m.category,
        form: m.form,
        unit: m.unit,
        reorderLevel: m.reorderLevel,
      },
    });

    // Create a stock batch that expires 2 years from now
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 2);

    await prisma.stockBatch.create({
      data: {
        medicineId: medicine.id,
        batchNumber: `BATCH-${m.barcode}-${Date.now().toString().slice(-4)}`,
        expiryDate: expiryDate,
        initialQuantity: m.stock,
        currentQuantity: m.stock,
        unitPrice: m.price,
      }
    });

    console.log(`Created Medicine: ${m.name} [${m.barcode}]`);
  }

  console.log('Seeding Complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
