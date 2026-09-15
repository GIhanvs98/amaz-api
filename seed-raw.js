const { Client } = require('pg');

const DATABASE_URL = "postgresql://neondb_owner:npg_qwtzHgAb60EN@ep-winter-darkness-b4pe3mq2-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL
  });

  await client.connect();

  console.log('Seeding Database with 10 Medicines using pg...');

  const medicinesData = [
    { id: 'uuid-1', barcode: '1000000000001', name: 'Paracetamol 500mg', genericName: 'Paracetamol', category: 'Analgesic', form: 'Tablet', unit: 'mg', reorderLevel: 500, price: 2.50, stock: 1200 },
    { id: 'uuid-2', barcode: '1000000000002', name: 'Amoxicillin 250mg', genericName: 'Amoxicillin', category: 'Antibiotic', form: 'Capsule', unit: 'mg', reorderLevel: 300, price: 15.00, stock: 800 },
    { id: 'uuid-3', barcode: '1000000000003', name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotic', form: 'Capsule', unit: 'mg', reorderLevel: 400, price: 25.00, stock: 1000 },
    { id: 'uuid-4', barcode: '1000000000004', name: 'Metformin 500mg', genericName: 'Metformin', category: 'Antidiabetic', form: 'Tablet', unit: 'mg', reorderLevel: 600, price: 5.00, stock: 2000 },
    { id: 'uuid-5', barcode: '1000000000005', name: 'Metformin 850mg', genericName: 'Metformin', category: 'Antidiabetic', form: 'Tablet', unit: 'mg', reorderLevel: 500, price: 8.50, stock: 1500 },
    { id: 'uuid-6', barcode: '1000000000006', name: 'Losartan 50mg', genericName: 'Losartan', category: 'Antihypertensive', form: 'Tablet', unit: 'mg', reorderLevel: 200, price: 12.00, stock: 500 },
    { id: 'uuid-7', barcode: '1000000000007', name: 'Amlodipine 5mg', genericName: 'Amlodipine', category: 'Antihypertensive', form: 'Tablet', unit: 'mg', reorderLevel: 400, price: 4.50, stock: 1500 },
    { id: 'uuid-8', barcode: '1000000000008', name: 'Atorvastatin 20mg', genericName: 'Atorvastatin', category: 'Lipid-lowering', form: 'Tablet', unit: 'mg', reorderLevel: 300, price: 18.00, stock: 600 },
    { id: 'uuid-9', barcode: '1000000000009', name: 'Omeprazole 20mg', genericName: 'Omeprazole', category: 'Proton Pump Inhibitor', form: 'Capsule', unit: 'mg', reorderLevel: 400, price: 6.00, stock: 800 },
    { id: 'uuid-10', barcode: '1000000000010', name: 'Cetirizine 10mg', genericName: 'Cetirizine', category: 'Antihistamine', form: 'Tablet', unit: 'mg', reorderLevel: 300, price: 3.50, stock: 1000 },
  ];

  for (const m of medicinesData) {
    try {
      await client.query(`
        INSERT INTO "Medicine" (id, barcode, name, "genericName", category, form, unit, "reorderLevel", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (barcode) DO NOTHING;
      `, [m.id, m.barcode, m.name, m.genericName, m.category, m.form, m.unit, m.reorderLevel]);

      // Stock Batch
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 2);
      
      const batchNo = 'BATCH-' + m.barcode;
      
      await client.query(`
        INSERT INTO "StockBatch" (id, "medicineId", "batchNumber", "expiryDate", "initialQuantity", "currentQuantity", "unitPrice", "updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW())
      `, [m.id, batchNo, expiry.toISOString(), m.stock, m.stock, m.price]);

      console.log(`Created Medicine: ${m.name}`);
    } catch (e) {
      console.error('Error inserting', m.name, e);
    }
  }

  console.log('Seeding Complete!');
  await client.end();
}

main().catch(console.error);
