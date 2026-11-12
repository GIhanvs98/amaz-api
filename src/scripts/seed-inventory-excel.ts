import { seedDrugs } from "./seed-drugs.js";

export async function seedInventoryFromExcel(filePath?: string) {
  return seedDrugs(filePath);
}

if (process.argv[1]?.endsWith("seed-inventory-excel.ts") || process.argv[1]?.endsWith("seed-inventory-excel.js")) {
  seedInventoryFromExcel()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
