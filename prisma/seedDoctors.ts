import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding 3 Doctors...');

  // Ensure DOCTOR role exists
  let doctorRole = await prisma.role.findUnique({ where: { name: 'DOCTOR' } });
  if (!doctorRole) {
    doctorRole = await prisma.role.create({
      data: { id: 'role-doctor', name: 'DOCTOR', description: 'Doctor Role', updatedAt: new Date() }
    });
  }

  const doctors = [
    { fullName: 'Dr. John Doe', email: 'johndoe@amazhospital.com' },
    { fullName: 'Dr. Jane Smith', email: 'janesmith@amazhospital.com' },
    { fullName: 'Dr. Robert Brown', email: 'robertbrown@amazhospital.com' },
  ];

  for (const d of doctors) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: {
        fullName: d.fullName,
        email: d.email,
        password: 'hashedpassword123', // dummy
        roleId: doctorRole.id,
      },
    });

    // Check if DoctorSchedule exists
    let schedule = await prisma.doctorSchedule.findFirst({ where: { doctorId: user.id } });
    if (!schedule) {
      schedule = await prisma.doctorSchedule.create({
        data: {
          doctorId: user.id,
          validFrom: new Date(),
        }
      });
      // create schedule session
      await prisma.doctorScheduleSession.create({
        data: {
          scheduleId: schedule.id,
          dayOfWeek: new Date().getDay(),
          sessionName: 'Morning Shift',
          startTime: '08:00',
          endTime: '13:00',
          tokenCapacity: 40,
        }
      });
    }

    console.log(`Created doctor: ${d.fullName}`);
  }

  console.log('Doctors seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
