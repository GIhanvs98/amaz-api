import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedInventory() {
  console.log("Seeding inventory items...");

  try {
    // 5 Medicines
    const medicines = [
      { name: "Paracetamol 500mg", genericName: "Paracetamol", category: "Analgesic", form: "Tablet", unit: "pills", reorderLevel: 500, itemType: "MEDICINE" },
      { name: "Amoxicillin 250mg", genericName: "Amoxicillin", category: "Antibiotic", form: "Capsule", unit: "pills", reorderLevel: 300, itemType: "MEDICINE" },
      { name: "Ibuprofen 400mg", genericName: "Ibuprofen", category: "NSAID", form: "Tablet", unit: "pills", reorderLevel: 400, itemType: "MEDICINE" },
      { name: "Cough Syrup", genericName: "Dextromethorphan", category: "Antitussive", form: "Syrup", unit: "bottles", reorderLevel: 50, itemType: "MEDICINE" },
      { name: "Loratadine 10mg", genericName: "Loratadine", category: "Antihistamine", form: "Tablet", unit: "pills", reorderLevel: 200, itemType: "MEDICINE" },
    ];

    // 5 Consumables/Equipment
    const nonMedicines = [
      { name: "Surgical Gloves", genericName: null, category: "PPE", form: null, unit: "boxes", reorderLevel: 100, itemType: "CONSUMABLE" },
      { name: "N95 Masks", genericName: null, category: "PPE", form: null, unit: "boxes", reorderLevel: 50, itemType: "CONSUMABLE" },
      { name: "Syringes 5ml", genericName: null, category: "Supplies", form: null, unit: "pcs", reorderLevel: 1000, itemType: "CONSUMABLE" },
      { name: "Bandages", genericName: null, category: "Supplies", form: null, unit: "rolls", reorderLevel: 200, itemType: "CONSUMABLE" },
      { name: "Blood Pressure Monitor", genericName: null, category: "Equipment", form: null, unit: "units", reorderLevel: 10, itemType: "EQUIPMENT" },
    ];

    const allItems = [...medicines, ...nonMedicines];

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      
      const createdItem = await prisma.medicine.create({
        data: {
          name: item.name,
          barcode: `AMZ-${Math.floor(10000000 + Math.random() * 90000000)}`,
          genericName: item.genericName,
          category: item.category,
          form: item.form,
          unit: item.unit,
          reorderLevel: item.reorderLevel,
          itemType: item.itemType as any
        }
      });

      // Add a stock batch
      await prisma.stockBatch.create({
        data: {
          medicineId: createdItem.id,
          batchNumber: `BATCH-${Date.now().toString().slice(-6)}-${i}`,
          expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // 1 year from now
          initialQuantity: item.reorderLevel * 2, // start with 2x reorder level
          currentQuantity: item.reorderLevel * 2,
          unitPrice: (Math.floor(Math.random() * 50) + 10) * 10 // Random price between 100 and 600
        }
      });
    }

    console.log("Successfully seeded 10 inventory items with stock!");
  } catch (error) {
    console.error("Error seeding inventory:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedInventory();
