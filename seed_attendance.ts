import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting attendance seeding...");

  // Find users with roles Nurse and LabTech
  const targetRoles = ["Nurse", "LabTech", "NURSE", "LAB_TECHNICIAN", "nurse", "labtech"];
  const users = await prisma.user.findMany({
    where: {
      Role: {
        name: {
          in: targetRoles
        }
      }
    }
  });

  if (users.length === 0) {
    console.log("No users found with target roles.");
    return;
  }

  console.log(`Found ${users.length} users to seed attendance for.`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let createdCount = 0;

  for (const user of users) {
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i); // Go back i days

      // Skip Sundays (0) to simulate typical work weeks (or maybe they work Sundays in a hospital, but let's give them 1 day off)
      if (date.getDay() === 0) {
        continue;
      }

      // Determine attendance state randomly
      const rand = Math.random();
      let status = "PRESENT";
      let checkIn: Date | null = new Date(date);
      let checkOut: Date | null = new Date(date);
      let notes: string | null = null;

      if (rand < 0.05) {
        // 5% chance of being absent
        status = "ABSENT";
        checkIn = null;
        checkOut = null;
        notes = "Sick leave / Personal emergency";
      } else if (rand < 0.15) {
        // 10% chance of being late
        status = "LATE";
        checkIn.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60)); // 8:xx to 9:xx
        checkOut.setHours(17, Math.floor(Math.random() * 60));
        notes = "Traffic / Delayed transport";
      } else {
        // 85% chance of being on time
        status = "PRESENT";
        checkIn.setHours(7, 30 + Math.floor(Math.random() * 30)); // 7:30 to 7:59
        checkOut.setHours(16, 30 + Math.floor(Math.random() * 90)); // 16:30 to 18:00
      }

      // Upsert to avoid constraint errors if running multiple times
      await prisma.staffAttendance.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date: date
          }
        },
        update: {
          checkIn,
          checkOut,
          status,
          notes
        },
        create: {
          userId: user.id,
          date,
          checkIn,
          checkOut,
          status,
          notes
        }
      });
      createdCount++;
    }
  }

  console.log(`Successfully seeded ${createdCount} attendance records.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
