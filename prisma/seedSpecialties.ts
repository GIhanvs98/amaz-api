import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Doctor Specialties...');

  const doctors = await prisma.user.findMany({
    where: { Role: { name: 'DOCTOR' } }
  });

  const specialties = ['OPD', 'Physician', 'Cardiology', 'Pediatrics', 'Orthopedics'];

  for (let i = 0; i < doctors.length; i++) {
    const specialty = specialties[i % specialties.length];
    await prisma.user.update({
      where: { id: doctors[i].id },
      data: { specialty }
    });
    console.log(`Updated ${doctors[i].fullName} with specialty: ${specialty}`);
  }

  console.log('Done seeding specialties.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
