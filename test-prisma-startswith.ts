import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const p = await prisma.prescription.findFirst({
      where: { id: { startsWith: "12345678" } }
    });
    console.log("Success:", p);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
main().finally(() => prisma.$disconnect());
