import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Employee Profile seeding...");

  // Find users without an EmployeeProfile
  const users = await prisma.user.findMany({
    where: {
      EmployeeProfile: null
    },
    include: {
      Role: true
    }
  });

  if (users.length === 0) {
    console.log("All users already have an EmployeeProfile. Nothing to do.");
    return;
  }

  console.log(`Found ${users.length} users missing an EmployeeProfile. Creating...`);

  let createdCount = 0;
  const today = new Date();
  
  // Set join date to 6 months ago for some realism
  const joinDate = new Date();
  joinDate.setMonth(today.getMonth() - 6);

  for (const user of users) {
    let baseSalary = 50000;
    
    // Customize base salary vaguely based on role for realism
    if (user.Role.name === 'Doctor') baseSalary = 150000;
    else if (user.Role.name === 'Superadmin' || user.Role.name === 'Admin') baseSalary = 100000;
    else if (user.Role.name === 'Nurse') baseSalary = 60000;
    else if (user.Role.name === 'LabTech') baseSalary = 75000;
    else if (user.Role.name === 'Receptionist') baseSalary = 45000;
    else if (user.Role.name === 'Pharmacist') baseSalary = 80000;
    
    await prisma.$transaction(async (tx) => {
      const profile = await tx.employeeProfile.create({
        data: {
          userId: user.id,
          employmentType: "FULL_TIME",
          salaryBasis: "MONTHLY",
          joiningDate: joinDate,
          paymentMethod: "BANK_TRANSFER",
          bankDetails: {
            bank: "BOC",
            branch: "City Branch",
            accountNo: `1000${Math.floor(Math.random() * 900000)}`
          },
          isActive: true
        }
      });

      await tx.compensationVersion.create({
        data: {
          employeeProfileId: profile.id,
          baseSalary: baseSalary,
          effectiveFrom: joinDate,
          isActive: true
        }
      });
    });
    
    createdCount++;
  }

  console.log(`Successfully created ${createdCount} Employee Profiles with Compensation Versions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
