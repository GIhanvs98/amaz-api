import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Connecting to database...");
  const users = await prisma.user.findMany({ take: 1 });
  console.log("Connected successfully! Found user:", users[0]?.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
