const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching Doctor role...');
  const doctorRole = await prisma.role.findFirst({ where: { name: 'Doctor' } });
  
  if (!doctorRole) {
    console.error("Doctor role not found in the database!");
    process.exit(1);
  }

  const doctorsToSeed = [
    { email: 'sarah.connor@amaz.com', fullName: 'Dr. Sarah Connor', specialty: 'Neurology', roomNumber: 'Room 101' },
    { email: 'alan.grant@amaz.com', fullName: 'Dr. Alan Grant', specialty: 'Orthopedics', roomNumber: 'Room 102' },
    { email: 'ellie.sattler@amaz.com', fullName: 'Dr. Ellie Sattler', specialty: 'Pediatrics', roomNumber: 'Room 103' },
    { email: 'ian.malcolm@amaz.com', fullName: 'Dr. Ian Malcolm', specialty: 'Cardiology', roomNumber: 'Room 104' },
    { email: 'john.hammond@amaz.com', fullName: 'Dr. John Hammond', specialty: 'General Surgery', roomNumber: 'Room 105' },
    { email: 'lex.murphy@amaz.com', fullName: 'Dr. Lex Murphy', specialty: 'Dermatology', roomNumber: 'Room 106' },
    { email: 'tim.murphy@amaz.com', fullName: 'Dr. Tim Murphy', specialty: 'Psychiatry', roomNumber: 'Room 107' },
    { email: 'ray.arnold@amaz.com', fullName: 'Dr. Ray Arnold', specialty: 'Ophthalmology', roomNumber: 'Room 108' }
  ];

  console.log(`Preparing to seed ${doctorsToSeed.length} doctors...`);
  
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('password123', salt);

  let count = 0;
  for (const doc of doctorsToSeed) {
    await prisma.user.upsert({
      where: { email: doc.email },
      update: {
        fullName: doc.fullName,
        specialty: doc.specialty,
        roomNumber: doc.roomNumber
      },
      create: {
        email: doc.email,
        fullName: doc.fullName,
        password,
        roleId: doctorRole.id,
        specialty: doc.specialty,
        roomNumber: doc.roomNumber
      }
    });
    console.log(`Seeded: ${doc.fullName}`);
    count++;
  }

  console.log(`\nSuccessfully seeded ${count} doctors!`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
