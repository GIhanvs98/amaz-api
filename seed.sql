-- 1. Insert 10 Medicines
INSERT INTO "Medicine" (id, barcode, name, "genericName", category, form, unit, "reorderLevel", "updatedAt") VALUES
('uuid-1', '1000000000001', 'Paracetamol 500mg', 'Paracetamol', 'Analgesic', 'Tablet', 'mg', 500, NOW()),
('uuid-2', '1000000000002', 'Amoxicillin 250mg', 'Amoxicillin', 'Antibiotic', 'Capsule', 'mg', 300, NOW()),
('uuid-3', '1000000000003', 'Amoxicillin 500mg', 'Amoxicillin', 'Antibiotic', 'Capsule', 'mg', 400, NOW()),
('uuid-4', '1000000000004', 'Metformin 500mg', 'Metformin', 'Antidiabetic', 'Tablet', 'mg', 600, NOW()),
('uuid-5', '1000000000005', 'Metformin 850mg', 'Metformin', 'Antidiabetic', 'Tablet', 'mg', 500, NOW()),
('uuid-6', '1000000000006', 'Losartan 50mg', 'Losartan', 'Antihypertensive', 'Tablet', 'mg', 200, NOW()),
('uuid-7', '1000000000007', 'Amlodipine 5mg', 'Amlodipine', 'Antihypertensive', 'Tablet', 'mg', 400, NOW()),
('uuid-8', '1000000000008', 'Atorvastatin 20mg', 'Atorvastatin', 'Lipid-lowering', 'Tablet', 'mg', 300, NOW()),
('uuid-9', '1000000000009', 'Omeprazole 20mg', 'Omeprazole', 'Proton Pump Inhibitor', 'Capsule', 'mg', 400, NOW()),
('uuid-10', '1000000000010', 'Cetirizine 10mg', 'Cetirizine', 'Antihistamine', 'Tablet', 'mg', 300, NOW())
ON CONFLICT (barcode) DO NOTHING;

-- 2. Wait, we need to lookup their generated UUIDs if they exist, or we just rely on the fixed uuids we inserted!
-- We used ON CONFLICT DO NOTHING, so if they existed, our uuid wouldn't map perfectly unless we select them.
-- Let's just create stock batches dynamically by joining with the Medicine table!

INSERT INTO "StockBatch" (id, "medicineId", "batchNumber", "expiryDate", "initialQuantity", "currentQuantity", "unitPrice", "updatedAt")
SELECT
    gen_random_uuid()::text,
    id as "medicineId",
    'BATCH-' || barcode,
    NOW() + INTERVAL '2 years',
    1000,
    1000,
    15.00,
    NOW()
FROM "Medicine"
WHERE barcode IN (
    '1000000000001', '1000000000002', '1000000000003', '1000000000004', '1000000000005',
    '1000000000006', '1000000000007', '1000000000008', '1000000000009', '1000000000010'
);
