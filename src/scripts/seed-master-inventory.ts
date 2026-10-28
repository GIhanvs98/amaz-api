import path from "path";
import fs from "fs";
import xlsxPkg from "xlsx";
import { PrismaClient } from "@prisma/client";

const xlsx = (xlsxPkg as any).readFile ? (xlsxPkg as any) : ((xlsxPkg as any).default || xlsxPkg);

// Determine database target
const isProductionFlag = process.argv.includes("--prod") || process.env.TARGET_ENV === "production";

let prisma: PrismaClient;
if (isProductionFlag && process.env.PROD_DATABASE_URL) {
  prisma = new PrismaClient({
    datasources: { db: { url: process.env.PROD_DATABASE_URL } }
  });
} else {
  // Use default Prisma instance configured in environment
  prisma = new PrismaClient();
}

/**
 * Standard Clinical Categories dictionary covering all 121 items
 */
const CLINICAL_CATEGORY_MAP: Record<string, string> = {
  // Direct category normalizations
  "analgesic": "Analgesics",
  "analgesics": "Analgesics",
  "antacids": "Antacids",
  "antibiotic": "Antibiotics",
  "antibiotics": "Antibiotics",
  "statins": "Statins",
  "antihistamin": "Antihistamines",
  "antihistamins": "Antihistamines",
  "antihistamine": "Antihistamines",
  "antihistamines": "Antihistamines",
  "steroid": "Steroids",
  "steroids": "Steroids",
  "diuretics": "Diuretics",
  "vitamins": "Vitamins & Minerals",
  "antiasthmatics": "Antiasthmatics",
  "antiemetics": "Antiemetics",
  "hormones": "Hormones",
  "oha": "Oral Hypoglycemic Agents (OHA)",
  "anticoagulants": "Anticoagulants",
  "antihypertensives": "Antihypertensives",
  "laxatives": "Laxatives",
  "antihelminthic": "Antihelminthic",
  "antifungal": "Antifungal",

  // Clinical mappings for template items with blank/misplaced category
  "calcium lactate": "Minerals & Supplements",
  "stematil": "Antiemetics",
  "amitriptyline": "Antidepressants / Neuropathic",
  "meloxicam": "Analgesics",
  "flunarazine": "Antimigraine / Neurological",
  "oxina nasal drop": "ENT Preparations",
  "oxina p nasal drop": "ENT Preparations",
  "tolnaftate topical": "Antifungal",
  "clobetasol cream": "Steroids",
  "lrvothyroxine / t4": "Thyroid / Hormones",
  "betahistine": "Antivertigo",
  "bromohexine": "Respiratory / Mucolytics",
  "cyproheptadine": "Antihistamines",
  "bisoprolol": "Antihypertensives",
  "fexofenadine": "Antihistamines",
  "tranexamic acid": "Hemostatics / Antifibrinolytics",
  "hyoscine": "Antispasmodics",
  "sitagliptin": "Oral Hypoglycemic Agents (OHA)",
  "tamsulosin": "Urological",
  "cbs strip": "Medical Consumables",
  "cephadex": "Antibiotics",
  "duracef": "Antibiotics",
  "cophyllin": "Antiasthmatics",
  "avam": "Respiratory / Antihistamines",
  "activkid": "Pediatric Supplements",
  "maxevel": "Antibiotics",
  "soframycin": "Antibiotics",
  "mupirocin cream": "Antibiotics",
  "metrogyl cream": "Antibiotics",
  "paracetamol": "Analgesics"
};

export interface CleanedDrugItem {
  index: number;
  rawName: string;
  name: string;
  genericName: string | null;
  category: string;
  itemType: "MEDICINE" | "CONSUMABLE";
  form: string;
  strength: string | null;
  unit: string;
  packSize: number; // Dose units per stock unit: Tablet=1, Syrup Bottle=60ml, Cream Tube=30g, Eye Drop=10ml
  reorderLevel: number;
  retailPrice: number;
  barcode: string | null;
  openingStock: number;
  expiryDate: Date | null;
}

/**
 * Returns the number of dose-units contained in one stock unit based on dosage form.
 * This is used to convert clinical prescriptions (ml, g) to stock units (bottles, tubes).
 */
export function getPackSizeForForm(form: string): number {
  const f = (form || "").trim().toLowerCase();
  if (["syrup", "suspension", "liquid"].includes(f)) return 60;   // 60ml per bottle
  if (["eye drop", "nasal drop"].includes(f)) return 10;           // 10ml per bottle
  if (["cream", "gel", "ointment", "topical"].includes(f)) return 30; // 30g per tube
  if (["inhaler"].includes(f)) return 200;                         // 200 actuations
  return 1; // Tablet, Capsule, Strip, Injection, Vial — 1:1
}

/**
 * Parse and normalize all 121 rows from Excel / Docs
 */
export function loadAndNormalizeInventory(customPath?: string): CleanedDrugItem[] {
  const possiblePaths = [
    customPath,
    path.resolve(process.cwd(), "../Docs/medical_drug_input_template.xlsx"),
    path.resolve(process.cwd(), "Docs/medical_drug_input_template.xlsx"),
    path.resolve(process.cwd(), "../../Docs/medical_drug_input_template.xlsx"),
    "/var/www/amaz-hospital/Docs/medical_drug_input_template.xlsx"
  ].filter(Boolean) as string[];

  let excelPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      excelPath = p;
      break;
    }
  }

  if (!excelPath) {
    throw new Error(`Could not find medical_drug_input_template.xlsx in paths: ${possiblePaths.join(", ")}`);
  }

  console.log(`[SEED] Loading master inventory from: ${excelPath}`);
  const wb = xlsx.readFile(excelPath);
  const sheetName = wb.SheetNames.includes("Medical Drugs") ? "Medical Drugs" : (wb.SheetNames[0] || "Sheet1");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet ${sheetName} not found in workbook.`);

  const rawRows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  console.log(`[SEED] Read ${rawRows.length} raw rows from "${sheetName}".`);

  const cleanedItems: CleanedDrugItem[] = [];
  const seenBarcodes = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const rawName = String(r["Drug Name (Brand)*"] || "").trim();
    if (!rawName) continue;

    // Cleaned Name
    const name = rawName.replace(/\s+/g, " ");

    // Generic Name & Category mapping
    let rawGen = String(r["Generic Name"] || "").trim();
    let rawCat = String(r["Category*"] || "").trim();

    // Check if category was accidentally entered into generic column
    if (!rawCat && rawGen) {
      const lowerGen = rawGen.toLowerCase();
      if (CLINICAL_CATEGORY_MAP[lowerGen]) {
        rawCat = rawGen;
        rawGen = "";
      }
    }

    const lowerCat = rawCat.toLowerCase();
    const lowerName = name.toLowerCase();

    let category = CLINICAL_CATEGORY_MAP[lowerCat];
    if (!category && rawGen) {
      category = CLINICAL_CATEGORY_MAP[rawGen.toLowerCase()];
    }
    if (!category) {
      for (const [key, mapped] of Object.entries(CLINICAL_CATEGORY_MAP)) {
        if (lowerName.includes(key)) {
          category = mapped;
          break;
        }
      }
    }
    if (!category) {
      category = rawCat || "General Medicine";
    }

    // Determine itemType
    const itemType: "MEDICINE" | "CONSUMABLE" =
      lowerName.includes("strip") || lowerName.includes("cbs strip") ? "CONSUMABLE" : "MEDICINE";

    // Form
    let form = String(r["Form*"] || "").trim();
    if (!form) {
      if (itemType === "CONSUMABLE") form = "Strip";
      else if (lowerName.includes("cream")) form = "Cream";
      else if (lowerName.includes("drop")) form = "Eye Drop";
      else if (lowerName.includes("gel")) form = "Gel";
      else if (lowerName.includes("syrup")) form = "Syrup";
      else if (lowerName.includes("topical")) form = "Topical";
      else form = "Tablet";
    }

    // Dosage Strength & Stock/Packaging Unit separation
    const rawUnitStrength = String(r["Unit/Strength*"] || "").trim();
    let strength: string | null = rawUnitStrength || null;
    if (
      !strength ||
      strength.toLowerCase().includes("unit") ||
      strength.toLowerCase().includes("bottle") ||
      strength.toLowerCase().includes("tube") ||
      strength.toLowerCase().includes("strip")
    ) {
      const match = rawName.match(/(\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|iu|%))/i);
      strength = match && match[1] ? match[1].trim() : null;
    }

    // Packaging / Stock Unit (Atomic unit on pharmacy shelves)
    let unit = "Tablet";
    if (form === "Tablet") unit = "Tablet";
    else if (form === "Capsule") unit = "Capsule";
    else if (form === "Syrup" || form === "Suspension" || form === "Liquid") unit = "Bottle";
    else if (form === "Eye Drop" || form === "Nasal Drop") unit = "Bottle";
    else if (form === "Cream" || form === "Ointment" || form === "Gel" || form === "Topical") unit = "Tube";
    else if (form === "Strip") unit = "Strip";
    else if (form === "Injection") unit = "Vial";
    else unit = "Piece";

    // Pack size: dose units per stock unit (1 for tablets, 60ml for syrups, 30g for creams, etc.)
    const packSize = getPackSizeForForm(form);

    // Reorder Level
    const parsedReorder = parseInt(String(r["Reorder Level*"]), 10);
    const reorderLevel = isNaN(parsedReorder) || parsedReorder < 0 ? 50 : parsedReorder;

    // Unit Price (Rs)
    const parsedPrice = parseFloat(String(r["Unit Price (Rs)"]));
    const retailPrice = isNaN(parsedPrice) || parsedPrice < 0 ? 0 : parsedPrice;

    // Barcode
    let barcode: string | null = String(r["Barcode (Optional)"] || "").trim() || null;
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        console.warn(`[WARN] Duplicate barcode "${barcode}" found at row ${i + 2}. Clearing for uniqueness.`);
        barcode = null;
      } else {
        seenBarcodes.add(barcode);
      }
    }

    // Opening Stock & Expiry
    const parsedStock = parseInt(String(r["Opening Stock"]), 10);
    const openingStock = isNaN(parsedStock) || parsedStock < 0 ? 0 : parsedStock;

    let expiryDate: Date | null = null;
    const rawExpiry = String(r["Opening Stock Expiry"] || "").trim();
    if (rawExpiry) {
      const parsedExp = new Date(rawExpiry);
      if (!isNaN(parsedExp.getTime())) {
        expiryDate = parsedExp;
      }
    }

    cleanedItems.push({
      index: cleanedItems.length + 1,
      rawName,
      name,
      genericName: rawGen || null,
      category,
      itemType,
      form,
      strength,
      unit,
      packSize,
      reorderLevel,
      retailPrice,
      barcode,
      openingStock,
      expiryDate
    });
  }

  return cleanedItems;
}

/**
 * Execute Transactional Seeding and Foreign-Key Relinking
 */
export async function seedMasterInventory(customPath?: string) {
  const items = loadAndNormalizeInventory(customPath);
  console.log(`\n======================================================`);
  console.log(`[SEED] STARTING MASTER INVENTORY SEEDING`);
  console.log(`[SEED] Target Database: ${isProductionFlag ? "PRODUCTION" : "LOCAL / CURRENT"}`);
  console.log(`[SEED] Total Validated Drug Records: ${items.length}`);
  console.log(`======================================================\n`);

  if (items.length !== 121) {
    console.warn(`[WARN] Expected 121 drugs from template, found: ${items.length}`);
  }

  // 1. Check existing foreign key references to preserve prescription history
  console.log(`[STEP 1/5] Checking existing PrescriptionItem references...`);
  const existingRxItems = await prisma.prescriptionItem.findMany({
    where: { medicineId: { not: null } },
    select: { id: true, drugName: true, medicineId: true }
  });
  console.log(`[STEP 1/5] Found ${existingRxItems.length} prescription items linked to existing medicines.`);

  // 2. Perform Atomic Database Update inside $transaction
  console.log(`[STEP 2/5] Executing atomic database transaction (clearing & re-seeding)...`);
  const result = await prisma.$transaction(async (tx) => {
    // A. Temporarily unlink prescription items so FK constraints don't block medicine deletion
    if (existingRxItems.length > 0) {
      await tx.prescriptionItem.updateMany({
        where: { medicineId: { not: null } },
        data: { medicineId: null }
      });
      console.log(`  -> Detached medicineId from ${existingRxItems.length} prescription items.`);
    }

    // B. Wipe old StockBatches and PurchaseOrderItems
    const deletedBatches = await tx.stockBatch.deleteMany({});
    const deletedPoItems = await tx.purchaseOrderItem.deleteMany({});
    console.log(`  -> Cleared ${deletedBatches.count} old StockBatches and ${deletedPoItems.count} PurchaseOrderItems.`);

    // C. Wipe old Medicines
    const deletedMeds = await tx.medicine.deleteMany({});
    console.log(`  -> Cleared ${deletedMeds.count} old Medicine records.`);

    // D. Insert all 121 clean medicine records
    console.log(`[STEP 3/5] Inserting ${items.length} master medicines and stock batches...`);
    let createdMedsCount = 0;
    let createdBatchesCount = 0;
    const insertedMedicineMap = new Map<string, string>(); // key: cleanName.toLowerCase() -> medicine.id

    for (const item of items) {
      const createdMed = await tx.medicine.create({
        data: {
          name: item.name,
          genericName: item.genericName,
          category: item.category,
          itemType: item.itemType,
          form: item.form,
          strength: item.strength,
          unit: item.unit,
          packSize: item.packSize,
          reorderLevel: item.reorderLevel,
          retailPrice: item.retailPrice,
          barcode: item.barcode,
          isActive: true
        }
      });

      createdMedsCount++;
      const lookupKey = `${item.name.toLowerCase()}||${item.form.toLowerCase()}||${(item.strength || "").toLowerCase()}`;
      insertedMedicineMap.set(lookupKey, createdMed.id);
      insertedMedicineMap.set(item.name.toLowerCase(), createdMed.id);

      // Create opening stock batch if stock > 0
      if (item.openingStock > 0) {
        const effectiveExpiry =
          item.expiryDate || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);

        await tx.stockBatch.create({
          data: {
            medicineId: createdMed.id,
            batchNumber: `INIT-${String(createdMedsCount).padStart(4, "0")}`,
            initialQuantity: item.openingStock,
            currentQuantity: item.openingStock,
            unitPrice: item.retailPrice,
            costPrice: item.retailPrice > 0 ? parseFloat((item.retailPrice * 0.8).toFixed(2)) : 0,
            expiryDate: effectiveExpiry
          }
        });
        createdBatchesCount++;
      }
    }

    // E. Relink PrescriptionItems back to the new Medicine IDs
    let relinkedCount = 0;
    if (existingRxItems.length > 0) {
      console.log(`[STEP 4/5] Relinking ${existingRxItems.length} prescription items to newly seeded medicine IDs...`);
      for (const rx of existingRxItems) {
        const cleanDrugName = (rx.drugName || "").trim().toLowerCase();
        let targetId = insertedMedicineMap.get(cleanDrugName);

        if (!targetId) {
          // Fallback prefix match (e.g. "Amoxicillin 125mg" -> matches "Amoxicillin")
          for (const [key, id] of insertedMedicineMap.entries()) {
            if (cleanDrugName.includes(key) || key.includes(cleanDrugName)) {
              targetId = id;
              break;
            }
          }
        }

        if (targetId) {
          await tx.prescriptionItem.update({
            where: { id: rx.id },
            data: { medicineId: targetId }
          });
          relinkedCount++;
        } else {
          console.warn(`  [NOTICE] Could not find direct match for Rx item "${rx.drugName}". Leaving medicineId as null.`);
        }
      }
      console.log(`  -> Successfully relinked ${relinkedCount}/${existingRxItems.length} prescription items.`);
    }

    return { createdMedsCount, createdBatchesCount, relinkedCount };
  }, {
    timeout: 30000,
    maxWait: 10000
  });

  console.log(`\n======================================================`);
  console.log(`[SEED COMPLETED] Database updated successfully.`);
  console.log(`Medicines Inserted: ${result.createdMedsCount}`);
  console.log(`Stock Batches Inserted: ${result.createdBatchesCount}`);
  console.log(`Prescription Items Relinked: ${result.relinkedCount}`);
  console.log(`======================================================\n`);

  // 3. Double-check everything one by one
  await verifySeededInventoryOneByOne(items);
}

/**
 * Double-check all seeded items one by one in the database
 */
export async function verifySeededInventoryOneByOne(expectedItems?: CleanedDrugItem[]) {
  console.log(`\n======================================================`);
  console.log(`[AUDIT] STARTING ONE-BY-ONE VERIFICATION PASS`);
  console.log(`======================================================\n`);

  const items = expectedItems || loadAndNormalizeInventory();

  // Query all medicines from database
  const dbMedicines = await prisma.medicine.findMany({
    include: {
      stockBatches: true
    },
    orderBy: { createdAt: "asc" }
  });

  console.log(`[AUDIT] Found ${dbMedicines.length} medicines in the target database.`);
  if (dbMedicines.length !== items.length) {
    throw new Error(`[AUDIT FAILED] Count mismatch! Expected ${items.length} items, found ${dbMedicines.length} in DB.`);
  }

  let totalAudited = 0;
  let totalPassed = 0;
  const failures: string[] = [];

  for (const expected of items) {
    totalAudited++;
    const found = dbMedicines.find(m =>
      m.name.trim().toLowerCase() === expected.name.trim().toLowerCase() &&
      (m.form || "").trim().toLowerCase() === (expected.form || "").trim().toLowerCase() &&
      ((m.strength || "").trim().toLowerCase() === (expected.strength || "").trim().toLowerCase() || items.filter(x => x.name.toLowerCase() === expected.name.toLowerCase()).length === 1)
    );

    if (!found) {
      failures.push(`Item #${expected.index} [${expected.name}] not found in database!`);
      continue;
    }

    // Verify key fields
    const errors: string[] = [];
    if (found.category !== expected.category) {
      errors.push(`Category mismatch: DB='${found.category}' vs Expected='${expected.category}'`);
    }
    if ((found.strength || null) !== expected.strength) {
      errors.push(`Strength mismatch: DB='${found.strength}' vs Expected='${expected.strength}'`);
    }
    if (found.unit !== expected.unit) {
      errors.push(`Stock Unit mismatch: DB='${found.unit}' vs Expected='${expected.unit}'`);
    }
    if (Math.abs(found.retailPrice - expected.retailPrice) > 0.01) {
      errors.push(`Price mismatch: DB=${found.retailPrice} vs Expected=${expected.retailPrice}`);
    }
    if (found.reorderLevel !== expected.reorderLevel) {
      errors.push(`Reorder mismatch: DB=${found.reorderLevel} vs Expected=${expected.reorderLevel}`);
    }
    if (expected.barcode && found.barcode !== expected.barcode) {
      errors.push(`Barcode mismatch: DB='${found.barcode}' vs Expected='${expected.barcode}'`);
    }
    if (expected.openingStock > 0) {
      const totalStock = found.stockBatches.reduce((acc, b) => acc + b.currentQuantity, 0);
      if (totalStock !== expected.openingStock) {
        errors.push(`Opening stock mismatch: DB=${totalStock} vs Expected=${expected.openingStock}`);
      }
    }

    if (errors.length > 0) {
      failures.push(`Item #${expected.index} [${expected.name}] verification failed:\n    - ${errors.join("\n    - ")}`);
    } else {
      totalPassed++;
      const strengthBadge = found.strength ? `[${found.strength}]` : "[N/A]";
      console.log(`  [OK ${String(totalPassed).padStart(3, " ")}/${items.length}] Verified: #${expected.index} ${found.name.padEnd(25, " ")} | ${found.category.padEnd(25, " ")} | ${(found.form || "").padEnd(10, " ")} | ${strengthBadge.padEnd(12, " ")} | Unit: ${found.unit.padEnd(8, " ")} | Rs. ${found.retailPrice.toFixed(2).padStart(8, " ")}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[AUDIT SUMMARY] Total Checked: ${totalAudited} | Passed: ${totalPassed} | Failures: ${failures.length}`);
  console.log(`======================================================\n`);

  if (failures.length > 0) {
    console.error(`[AUDIT FAILED] Discrepancies detected in ${failures.length} items:\n`);
    failures.forEach(f => console.error(f));
    throw new Error(`Inventory verification failed with ${failures.length} discrepancies.`);
  }

  console.log(`[AUDIT PASSED] 100% of all ${totalPassed} items verified with zero discrepancies.`);
}

// Direct CLI Execution
if (process.argv[1]?.endsWith("seed-master-inventory.ts") || process.argv[1]?.endsWith("seed-master-inventory.js")) {
  const customPath = process.argv.find(arg => arg.endsWith(".xlsx"));
  seedMasterInventory(customPath)
    .then(async () => {
      console.log("[EXIT] Master inventory seed and verification finished successfully.");
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[FATAL] Seeding failed with error:", err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
