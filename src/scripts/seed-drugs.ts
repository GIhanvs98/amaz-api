import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Standard Clinical Categories dictionary covering all 121 items
 */
const CLINICAL_CATEGORY_MAP: Record<string, string> = {
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

  // Clinical mappings for items with blank/misplaced category
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
  packSize: number;
  reorderLevel: number; // Low stock alert threshold
  retailPrice: number;
  barcode: string | null;
  availableStock: number; // From Reorder Level* column as instructed
  expiryDate: Date | null;
}

/**
 * Returns the number of dose-units contained in one stock unit based on dosage form.
 */
export function getPackSizeForForm(form: string, strength?: string | null): number {
  const f = (form || "").trim().toLowerCase();
  if (["syrup", "suspension", "liquid"].includes(f)) {
    if (strength?.includes("30ml")) return 30;
    if (strength?.includes("50ml")) return 50;
    return 60; // default 60ml per bottle
  }
  if (["eye drop", "nasal drop"].includes(f)) return 10; // 10ml
  if (["cream", "gel", "ointment", "topical"].includes(f)) return 30; // 30g per tube
  if (["inhaler"].includes(f)) return 200; // 200 actuations
  return 1; // Tablet, Capsule, Strip - 1:1
}

/**
 * Calculate sensible low-stock alert threshold on the Medicine definition
 */
export function calculateReorderAlertThreshold(form: string, availableStock: number): number {
  const f = (form || "").trim().toLowerCase();
  const isLiquidOrTopical = ["syrup", "cream", "gel", "eye drop", "nasal drop", "topical"].includes(f);
  if (isLiquidOrTopical) {
    return Math.max(1, Math.min(2, Math.floor((availableStock || 4) * 0.3)));
  }
  if (availableStock >= 100) return 20;
  if (availableStock >= 30) return 10;
  if (availableStock > 0) return Math.max(1, Math.floor(availableStock * 0.2));
  return 10;
}

/**
 * Simple, robust RFC-compliant CSV line parser without external dependencies
 */
function parseCSV(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]!);
  const records: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]!);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] !== undefined ? values[idx] : "";
    });
    records.push(record);
  }

  return records;
}

/**
 * Normalizes all CSV rows into validated drug items
 */
export function normalizeDrugData(csvRecords: Array<Record<string, string>>): CleanedDrugItem[] {
  const seenBarcodes = new Set<string>();
  const cleaned: CleanedDrugItem[] = [];

  for (let i = 0; i < csvRecords.length; i++) {
    const r = csvRecords[i]!;
    const rawName = String(r["Drug Name (Brand)*"] || "").trim();
    if (!rawName) continue;

    const name = rawName.replace(/\s+/g, " ");

    let rawGen = String(r["Generic Name"] || "").trim();
    let rawCat = String(r["Category*"] || "").trim();

    // Check if category was placed in generic column
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

    // Strength
    const rawStrength = String(r["Unit/Strength*"] || "").trim();
    let strength: string | null = rawStrength || null;
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

    // Packaging Unit
    let unit = "Tablet";
    if (form === "Tablet") unit = "Tablet";
    else if (form === "Capsule") unit = "Capsule";
    else if (form === "Syrup" || form === "Suspension" || form === "Liquid") unit = "Bottle";
    else if (form === "Eye Drop" || form === "Nasal Drop") unit = "Bottle";
    else if (form === "Cream" || form === "Ointment" || form === "Gel" || form === "Topical") unit = "Tube";
    else if (form === "Strip") unit = "Strip";
    else if (form === "Injection") unit = "Vial";
    else unit = "Piece";

    const packSize = getPackSizeForForm(form, strength);

    // CRITICAL USER REQUIREMENT:
    // "Reorder Level column represent availiable stock"
    const parsedReorderColumn = parseInt(String(r["Reorder Level*"]), 10);
    const parsedOpeningColumn = parseInt(String(r["Opening Stock"]), 10);

    let availableStock = 0;
    if (!isNaN(parsedReorderColumn) && parsedReorderColumn > 0) {
      availableStock = parsedReorderColumn;
    } else if (!isNaN(parsedOpeningColumn) && parsedOpeningColumn > 0) {
      availableStock = parsedOpeningColumn;
    }

    // Medicine low-stock warning threshold
    const reorderLevel = calculateReorderAlertThreshold(form, availableStock);

    // Unit Price (Rs)
    const parsedPrice = parseFloat(String(r["Unit Price (Rs)"]));
    const retailPrice = isNaN(parsedPrice) || parsedPrice < 0 ? 0 : parsedPrice;

    // Barcode
    let barcode: string | null = String(r["Barcode (Optional)"] || "").trim() || null;
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        console.warn(`[WARN] Duplicate barcode "${barcode}" found at row ${i + 2}. Skipping barcode for uniqueness.`);
        barcode = null;
      } else {
        seenBarcodes.add(barcode);
      }
    }

    // Expiry date
    let expiryDate: Date | null = null;
    const rawExpiry = String(r["Opening Stock Expiry"] || "").trim();
    if (rawExpiry) {
      const parsedExp = new Date(rawExpiry);
      if (!isNaN(parsedExp.getTime())) {
        expiryDate = parsedExp;
      }
    }

    cleaned.push({
      index: cleaned.length + 1,
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
      availableStock,
      expiryDate
    });
  }

  return cleaned;
}

/**
 * Execute DB Seeding
 */
export async function seedDrugs(customFilePath?: string) {
  const defaultPath = path.resolve(process.cwd(), "prisma/data/medical_drugs.csv");
  const filePath = customFilePath || defaultPath;

  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }

  console.log(`\n======================================================`);
  console.log(`[SEED] STARTING MEDICAL DRUG SEEDER`);
  console.log(`[SEED] Source File: ${filePath}`);
  console.log(`[SEED] Policy: 'Reorder Level' column represents available stock`);
  console.log(`======================================================\n`);

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const rawRecords = parseCSV(fileContent);
  const items = normalizeDrugData(rawRecords);

  console.log(`[STEP 1/4] Parsed ${items.length} validated drug records from CSV.`);

  // Check existing foreign keys
  console.log(`[STEP 2/4] Checking existing PrescriptionItem references to preserve clinical records...`);
  const existingRxItems = await prisma.prescriptionItem.findMany({
    where: { medicineId: { not: null } },
    select: { id: true, drugName: true, medicineId: true }
  });
  console.log(`[STEP 2/4] Found ${existingRxItems.length} prescription items linked to existing medicines.`);

  // Execute transaction
  console.log(`[STEP 3/4] Executing database transaction...`);
  const result = await prisma.$transaction(async (tx) => {
    // 1. Detach FKs
    if (existingRxItems.length > 0) {
      await tx.prescriptionItem.updateMany({
        where: { medicineId: { not: null } },
        data: { medicineId: null }
      });
      console.log(`  -> Detached medicineId from ${existingRxItems.length} prescription items.`);
    }

    // 2. Wipe old batches and PO items
    const deletedBatches = await tx.stockBatch.deleteMany({});
    const deletedPoItems = await tx.purchaseOrderItem.deleteMany({});
    const deletedMeds = await tx.medicine.deleteMany({});
    console.log(`  -> Cleared ${deletedMeds.count} old medicines, ${deletedBatches.count} batches, ${deletedPoItems.count} PO items.`);

    // 3. Insert new medicines & batches
    let createdMedsCount = 0;
    let createdBatchesCount = 0;
    let totalStockUnits = 0;
    const insertedMedicineMap = new Map<string, string>();

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

      // Create StockBatch from availableStock (from Reorder Level column)
      if (item.availableStock > 0) {
        const effectiveExpiry =
          item.expiryDate || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000); // 2 years default

        await tx.stockBatch.create({
          data: {
            medicineId: createdMed.id,
            batchNumber: `BATCH-INIT-${String(createdMedsCount).padStart(4, "0")}`,
            initialQuantity: item.availableStock,
            currentQuantity: item.availableStock,
            unitPrice: item.retailPrice,
            costPrice: item.retailPrice > 0 ? parseFloat((item.retailPrice * 0.8).toFixed(2)) : 0,
            expiryDate: effectiveExpiry
          }
        });
        createdBatchesCount++;
        totalStockUnits += item.availableStock;
      }
    }

    // 4. Relink prescription items
    let relinkedCount = 0;
    if (existingRxItems.length > 0) {
      for (const rx of existingRxItems) {
        const cleanDrugName = (rx.drugName || "").trim().toLowerCase();
        let targetId = insertedMedicineMap.get(cleanDrugName);

        if (!targetId) {
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
        }
      }
      console.log(`  -> Successfully relinked ${relinkedCount}/${existingRxItems.length} prescription items.`);
    }

    return { createdMedsCount, createdBatchesCount, totalStockUnits, relinkedCount };
  }, { timeout: 30000, maxWait: 10000 });

  console.log(`[STEP 4/4] Seeding completed successfully!`);
  console.log(`\n================== SUMMARY ==================`);
  console.log(`Total Medicines Created: ${result.createdMedsCount}`);
  console.log(`Total Stock Batches Created: ${result.createdBatchesCount}`);
  console.log(`Total Stock Units in Pharmacy: ${result.totalStockUnits.toLocaleString()}`);
  console.log(`Prescription Items Preserved: ${result.relinkedCount}`);
  console.log(`=============================================\n`);
}

// Auto-run if executed directly
if (process.argv[1]?.includes("seed-drugs") || process.argv[1]?.includes("seed-master-inventory")) {
  seedDrugs()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("[FATAL ERROR IN SEEDER]:", err);
      prisma.$disconnect().finally(() => process.exit(1));
    });
}
