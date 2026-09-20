import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
prisma.user.findMany().then(u => {
    console.log("Users count:", u.length);
    console.log(u);
}).catch(console.error).finally(() => prisma.$disconnect());
