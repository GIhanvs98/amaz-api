/**
 * Targeted prescription reseed script.
 * - Deletes ALL existing prescriptions and their items
 * - Seeds 5 PENDING prescriptions linked to existing patients, doctors, medicines
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});


const PRESCRIPTIONS_DATA = [
  {
    diagnosis: 'Upper Respiratory Tract Infection',
    clinicalNotes: 'Patient presents with sore throat and mild fever. Rest advised.',
    items: [
      { drugName: 'Amoxicillin 500mg', dosage: '1 tablet', frequency: 'Three times daily', duration: '7 days', instructions: 'Take after meals', index: 0 },
      { drugName: 'Paracetamol 500mg', dosage: '2 tablets', frequency: 'Every 6 hours (as needed)', duration: '5 days', instructions: 'Take when fever exceeds 38°C', index: 1 },
    ],
  },
  {
    diagnosis: 'Type 2 Diabetes Management',
    clinicalNotes: 'Blood sugar levels elevated. Lifestyle modifications discussed. Follow-up in 4 weeks.',
    items: [
      { drugName: 'Metformin 850mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', instructions: 'Take with meals to reduce GI side effects', index: 2 },
      { drugName: 'Atorvastatin 10mg', dosage: '1 tablet', frequency: 'Once daily (evening)', duration: '30 days', instructions: 'Take at night', index: 3 },
    ],
  },
  {
    diagnosis: 'Hypertension',
    clinicalNotes: 'BP 145/90 mmHg. Sodium restriction advised. Monitor BP weekly.',
    items: [
      { drugName: 'Amlodipine 5mg', dosage: '1 tablet', frequency: 'Once daily (morning)', duration: '30 days', instructions: 'Take at the same time each day', index: 4 },
      { drugName: 'Losartan 50mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', instructions: 'Can be taken with or without food', index: 0 },
    ],
  },
  {
    diagnosis: 'Acute Gastritis',
    clinicalNotes: 'Patient reports epigastric pain and nausea after meals. Spicy food and NSAIDs to be avoided.',
    items: [
      { drugName: 'Omeprazole 20mg', dosage: '1 capsule', frequency: 'Once daily (30 min before breakfast)', duration: '14 days', instructions: 'Swallow whole, do not crush', index: 1 },
      { drugName: 'Domperidone 10mg', dosage: '1 tablet', frequency: 'Three times daily', duration: '7 days', instructions: 'Take 30 minutes before meals', index: 2 },
    ],
  },
  {
    diagnosis: 'Vitamin D Deficiency & Iron Deficiency Anaemia',
    clinicalNotes: 'Serum ferritin low. Patient reports fatigue and weakness. Dietary counselling provided.',
    items: [
      { drugName: 'Ferrous Sulphate 200mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', instructions: 'Take on an empty stomach with orange juice to improve absorption', index: 3 },
      { drugName: 'Vitamin D3 1000IU', dosage: '1 tablet', frequency: 'Once daily', duration: '60 days', instructions: 'Take with a fatty meal', index: 4 },
    ],
  },
];

async function main() {
  console.log('🗑️  Deleting existing prescriptions...');

  // Delete items first (FK constraint)
  const deletedItems = await prisma.prescriptionItem.deleteMany({});
  console.log(`   Deleted ${deletedItems.count} prescription item(s).`);

  const deletedRx = await prisma.prescription.deleteMany({});
  console.log(`   Deleted ${deletedRx.count} prescription(s).`);

  // Fetch existing relational data
  console.log('\n📦 Loading existing patients, doctors, and medicines...');

  const patients = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 5 });
  const doctors = await prisma.user.findMany({
    where: { specialty: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  const medicines = await prisma.medicine.findMany({
    include: { stockBatches: { orderBy: { createdAt: 'asc' }, take: 1 } },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  if (patients.length === 0) throw new Error('No patients found. Run the full seed first.');
  if (doctors.length === 0) throw new Error('No doctors found. Run the full seed first.');
  if (medicines.length === 0) throw new Error('No medicines found. Run the full seed first.');

  console.log(`   Found ${patients.length} patient(s), ${doctors.length} doctor(s), ${medicines.length} medicine(s).`);

  console.log('\n💊 Seeding 5 PENDING prescriptions...');

  for (let i = 0; i < 5; i++) {
    const patient = patients[i % patients.length];
    const doctor = doctors[i % doctors.length];
    const template = PRESCRIPTIONS_DATA[i];

    // Build prescription items — link to real medicines where possible
    const itemsToCreate = template.items.map((item) => {
      const med = medicines[item.index % medicines.length];
      return {
        medicineId: med?.id ?? null,
        drugName: item.drugName,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions,
        dispenseQty: 1,
      };
    });

    const rx = await prisma.prescription.create({
      data: {
        patientId: patient.id,
        patientName: patient.fullName,
        visitId: `VISIT-RX-${Date.now()}-${i}`,
        doctorId: doctor.id,
        doctorName: doctor.fullName,
        diagnosis: template.diagnosis,
        clinicalNotes: template.clinicalNotes,
        status: 'PENDING',
        items: {
          create: itemsToCreate,
        },
      },
      include: { items: true },
    });

    console.log(`   ✅ [${i + 1}/5] ${rx.patientName} — ${template.diagnosis} (${rx.items.length} item(s))`);
  }

  console.log('\n🎉 Prescription reseed complete! 5 PENDING prescriptions ready in the Rx tab.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
