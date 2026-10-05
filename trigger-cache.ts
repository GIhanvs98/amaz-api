import { PrismaClient } from "@prisma/client";
import { clearCache } from "./src/middlewares/cache.middleware.js";

async function run() {
  await clearCache('*roles*');
  console.log("Cleared roles cache");
}
run();
