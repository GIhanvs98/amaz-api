import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const doctors = await prisma.user.findMany({
    where: { Role: { name: "Doctor" }, isActive: true },
    select: {
      id: true,
      fullName: true,
      specialty: true,
      roomNumber: true,
      consultationFee: true,
      feeType: true,
      Role: true
    }
  });
  console.log('Doctors found:', doctors.length);
  console.log(JSON.stringify(doctors, null, 2));
}
run();
