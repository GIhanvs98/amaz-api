import { prisma } from '../lib/prisma';

export class PharmacyService {
  // --- MEDICINE CATALOG ---
  async getAllMedicines(barcode?: string) {
    const whereClause = barcode ? { barcode } : {};
    return prisma.medicine.findMany({
      where: whereClause,
      include: {
        stockBatches: {
          where: { currentQuantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
      },
    });
  }

  async addMedicine(data: { name: string; genericName?: string; category: string; form: string; unit: string; reorderLevel?: number }) {
    return prisma.medicine.create({
      data,
    });
  }

  // --- INVENTORY MANAGEMENT ---
  async addStockBatch(data: { medicineId: string; batchNumber: string; expiryDate: Date; initialQuantity: number; unitPrice: number }) {
    return prisma.stockBatch.create({
      data: {
        ...data,
        currentQuantity: data.initialQuantity,
      },
    });
  }

  // --- DISPENSING ENGINE (FIFO LOGIC) ---
  async dispenseMedicine(medicineId: string, quantityToDispense: number) {
    return prisma.$transaction(async (tx) => {
      // 1. Get all available unexpired stock batches for this medicine, ordered by expiry date (FIFO)
      const availableBatches = await tx.stockBatch.findMany({
        where: {
          medicineId,
          currentQuantity: { gt: 0 },
          expiryDate: { gt: new Date() }, // Don't dispense expired meds
        },
        orderBy: {
          expiryDate: 'asc', // Oldest expiry first
        },
      });

      // 2. Check if we have enough total stock
      const totalAvailable = availableBatches.reduce((sum, b) => sum + b.currentQuantity, 0);
      if (totalAvailable < quantityToDispense) {
        throw new Error(`Insufficient stock. Requested: ${quantityToDispense}, Available: ${totalAvailable}`);
      }

      let remainingToDispense = quantityToDispense;
      const batchesUsed = [];

      // 3. Loop through batches and deduct stock
      for (const batch of availableBatches) {
        if (remainingToDispense <= 0) break;

        const quantityFromThisBatch = Math.min(batch.currentQuantity, remainingToDispense);
        
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { currentQuantity: batch.currentQuantity - quantityFromThisBatch },
        });

        batchesUsed.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantityDispensed: quantityFromThisBatch,
          unitPrice: batch.unitPrice,
        });

        remainingToDispense -= quantityFromThisBatch;
      }

      return {
        success: true,
        message: `Successfully dispensed ${quantityToDispense} units.`,
        batchesUsed,
      };
    });
  }

  // --- ALERTS ---
  async getLowStockAlerts() {
    const medicines = await prisma.medicine.findMany({
      include: {
        stockBatches: {
          where: { currentQuantity: { gt: 0 }, expiryDate: { gt: new Date() } },
        },
      },
    });

    return medicines
      .map(med => ({
        id: med.id,
        name: med.name,
        totalStock: med.stockBatches.reduce((sum, b) => sum + b.currentQuantity, 0),
        reorderLevel: med.reorderLevel,
      }))
      .filter(med => med.totalStock <= med.reorderLevel);
  }

  async getExpiringSoonAlerts(daysThreshold: number = 30) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    return prisma.stockBatch.findMany({
      where: {
        currentQuantity: { gt: 0 },
        expiryDate: {
          lte: thresholdDate,
          gt: new Date(),
        },
      },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
    });
  }
}

export const pharmacyService = new PharmacyService();
