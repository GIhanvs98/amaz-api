import { PrismaClient } from "@prisma/client";
import { generateIdentityKey } from "../src/utils/identity.util.js";

const prisma = new PrismaClient();

async function backfill() {
  console.log("Starting backfill of patient identity keys...");

  const patients = await prisma.patient.findMany({
    select: { id: true, fullName: true, phone: true, identityKey: true }
  });

  console.log(`Found ${patients.length} patients in database.`);

  const usedKeys = new Set<string>();
  let updatedCount = 0;

  for (const patient of patients) {
    let key = generateIdentityKey(patient.fullName, patient.phone);
    if (!key) {
      key = `anon_${patient.id.slice(0, 8)}`;
    }

    // Handle any edge-case collisions among test data
    let finalKey = key;
    let counter = 1;
    while (usedKeys.has(finalKey)) {
      counter++;
      finalKey = `${key}_${counter}`;
    }
    usedKeys.add(finalKey);

    if (patient.identityKey !== finalKey) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: { identityKey: finalKey }
      });
      updatedCount++;
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} patients.`);
  await prisma.$disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
