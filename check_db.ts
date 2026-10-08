import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany();
  console.log("Roles:");
  console.table(roles);

  const departments = await prisma.department.findMany({ include: { _count: { select: { Users: true } } }});
  console.log("Departments:");
  console.table(departments);

  const users = await prisma.user.findMany({ select: { id: true, fullName: true, roleId: true, departmentId: true, Role: { select: { name: true } } }});
  console.log("Users:");
  console.table(users);
}

main().catch(console.error).finally(() => prisma.$disconnect());
