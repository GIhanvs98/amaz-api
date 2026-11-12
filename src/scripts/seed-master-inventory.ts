import { seedDrugs } from "./seed-drugs.js";

export async function seedMasterInventory(customPath?: string) {
  return seedDrugs(customPath);
}

if (process.argv[1]?.endsWith("seed-master-inventory.ts") || process.argv[1]?.endsWith("seed-master-inventory.js")) {
  seedMasterInventory()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
