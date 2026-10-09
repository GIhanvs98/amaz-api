import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rooms = [
    { roomNumber: 'ROOM 01', department: 'CONSULTATION', status: 'AVAILABLE', description: 'General Consultation' },
    { roomNumber: 'ROOM 02', department: 'CONSULTATION', status: 'AVAILABLE', description: 'General Consultation' },
    { roomNumber: 'ROOM 03', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Pediatrics' },
    { roomNumber: 'ROOM 04', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Cardiology' },
    { roomNumber: 'ROOM 05', department: 'CONSULTATION', status: 'AVAILABLE', description: 'Orthopedics' },
    { roomNumber: 'ROOM 06', department: 'CONSULTATION', status: 'MAINTENANCE', description: 'Under repair' },
    { roomNumber: 'LAB-A', department: 'LAB', status: 'AVAILABLE', description: 'Main Laboratory' },
    { roomNumber: 'LAB-B', department: 'LAB', status: 'AVAILABLE', description: 'Specialized Testing' },
    { roomNumber: 'EXT-01', department: 'EXTRA_SERVICE', status: 'AVAILABLE', description: 'ECG / Ultrasound' },
    { roomNumber: 'EXT-02', department: 'EXTRA_SERVICE', status: 'AVAILABLE', description: 'X-Ray' }
  ];

  for (const r of rooms) {
    await prisma.room.upsert({
      where: { roomNumber: r.roomNumber },
      update: {},
      create: r
    });
  }

  console.log("Seeded 10 rooms successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
