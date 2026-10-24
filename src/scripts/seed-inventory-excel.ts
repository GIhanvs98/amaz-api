import path from "path";
import * as xlsx from "xlsx";
import { prisma } from "../lib/prisma.js";

// Normalize categories into clean title case
const CATEGORY_MAP: Record<string, string> = {
  "analgesic": "Analgesic",
  "analgesics": "Analgesic",
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
  "vitamins": "Vitamins",
  "antiasthmatics": "Antiasthmatics",
  "antiemetics": "Antiemetics",
  "hormones": "Hormones",
  "oha": "Oral Hypoglycemic Agents (OHA)",
  "anticoagulants": "Anticoagulants",
  "antihypertensives": "Antihypertensives",
  "laxatives": "Laxatives",
  "antihelminthic": "Antihelminthic",
  "antifungal": "Antifungal"
};

export async function seedInventoryFromExcel(filePath?: string) {
  const excelPath = filePath || path.resolve(process.cwd(), "../Docs/medical_drug_input_template.xlsx");
  console.log(`Loading inventory Excel file from: ${excelPath}`);

  const wb = xlsx.readFile(excelPath);
  const sheetName = wb.SheetNames.includes("Medical Drugs") ? "Medical Drugs" : (wb.SheetNames[0] || "Sheet1");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found in Excel workbook.`);
  }
  const rows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  console.log(`Found ${rows.length} rows in sheet "${sheetName}".`);

  let createdMedicines = 0;
  let createdBatches = 0;
  const existingBarcodes = new Set<string>();

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rawName = String(row["Drug Name (Brand)*"] || "").trim();
    if (!rawName) continue;

    const rawGeneric = String(row["Generic Name"] || "").trim();
    let rawCategory = String(row["Category*"] || "").trim();
    let form = String(row["Form*"] || "").trim() || "Tablet";
    let unit = String(row["Unit/Strength*"] || "").trim() || "1 unit";

    // Handle cases where category was placed in Generic Name or missing
    if (!rawCategory && rawGeneric) {
      const lowerGen = rawGeneric.toLowerCase();
      if (CATEGORY_MAP[lowerGen]) {
        rawCategory = rawGeneric;
      }
    }

    const lowerCat = rawCategory.toLowerCase();
    const normalizedCategory = CATEGORY_MAP[lowerCat] || (rawCategory ? rawCategory.trim() : "General Medicine");

    // Reorder level
    const reorderLevel = parseInt(String(row["Reorder Level*"]), 10) || 50;

    // Unit Price (Rs)
    const retailPrice = parseFloat(String(row["Unit Price (Rs)"])) || 0;

    // Barcode
    let barcode: string | null = String(row["Barcode (Optional)"] || "").trim() || null;
    if (barcode) {
      if (existingBarcodes.has(barcode)) {
        console.warn(`Duplicate barcode "${barcode}" found at row ${idx + 2}. Clearing barcode for uniqueness.`);
        barcode = null;
      } else {
        existingBarcodes.add(barcode);
      }
    }

    // Opening stock & expiry
    const openingStock = parseInt(String(row["Opening Stock"]), 10) || 0;
    const rawExpiry = String(row["Opening Stock Expiry"] || "").trim();

    let expiryDate: Date | null = null;
    if (rawExpiry) {
      const parsed = new Date(rawExpiry);
      if (!isNaN(parsed.getTime())) {
        expiryDate = parsed;
      }
    }

    // Upsert medicine record
    const medicine = await prisma.medicine.create({
      data: {
        name: rawName,
        genericName: rawGeneric || null,
        category: normalizedCategory,
        itemType: "MEDICINE",
        form,
        unit,
        reorderLevel,
        retailPrice,
        barcode,
        isActive: true
      }
    });

    createdMedicines++;

    // If opening stock exists, create an initial stock batch
    if (openingStock > 0) {
      // If no expiry specified, default to 2 years from today
      const effectiveExpiry = expiryDate || new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);

      await prisma.stockBatch.create({
        data: {
          medicineId: medicine.id,
          batchNumber: `INIT-${String(createdMedicines).padStart(4, "0")}`,
          initialQuantity: openingStock,
          currentQuantity: openingStock,
          unitPrice: retailPrice,
          costPrice: retailPrice > 0 ? parseFloat((retailPrice * 0.8).toFixed(2)) : 0,
          expiryDate: effectiveExpiry
        }
      });

      createdBatches++;
    }
  }

  console.log(`=== INVENTORY SEEDING SUMMARY ===`);
  console.log(`Total Medicines Created: ${createdMedicines}`);
  console.log(`Initial Stock Batches Created: ${createdBatches}`);
  return { createdMedicines, createdBatches };
}

// If executed directly
if (process.argv[1]?.endsWith("seed-inventory-excel.ts") || process.argv[1]?.endsWith("seed-inventory-excel.js")) {
  const customPath = process.argv[2];
  seedInventoryFromExcel(customPath)
    .then(() => {
      console.log("Seeding completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seeding failed with error:", err);
      process.exit(1);
    });
}
