import { prisma, withRetry } from "../lib/prisma.js";

export class PharmacyService {
  async getAllMedicines(searchTerm?: string, page: number = 1, limit: number = 50) {
    const whereClause: any = { isActive: true };
    if (searchTerm) {
      whereClause.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { barcode: { contains: searchTerm, mode: 'insensitive' } },
        { category: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      withRetry(() => prisma.medicine.findMany({
        where: whereClause,
        include: {
          stockBatches: {
            where: { currentQuantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
        skip,
        take: limit
      })),
      withRetry(() => prisma.medicine.count({ where: whereClause }))
    ]);
    
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async addMedicine(data: { name: string; barcode?: string; genericName?: string; category: string; itemType?: string; form?: string; unit: string; reorderLevel?: number; baseStock?: number; basePrice?: number; expiryDate?: Date }) {
    const existingName = await prisma.medicine.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } }
    });
    if (existingName) {
      const err = new Error(`An item with the name "${data.name}" already exists in the inventory.`);
      (err as any).code = 'ALREADY_EXISTS';
      (err as any).itemId = existingName.id;
      throw err;
    }
    
    return withRetry(() => prisma.$transaction(async (tx) => {
      const medicine = await tx.medicine.create({
        data: {
          name: data.name,
          barcode: data.barcode,
          genericName: data.genericName,
          category: data.category,
          itemType: data.itemType || "MEDICINE",
          form: data.form,
          unit: data.unit,
          reorderLevel: data.reorderLevel,
        },
      });

      if (data.baseStock && data.baseStock > 0) {
        await tx.stockBatch.create({
          data: {
            medicineId: medicine.id,
            batchNumber: `INIT-${Date.now()}`,
            expiryDate: data.expiryDate || null,
            initialQuantity: data.baseStock,
            currentQuantity: data.baseStock,
            unitPrice: data.basePrice || 0,
          }
        });
      }

      return medicine;
    }));
  }

  // --- INVENTORY MANAGEMENT ---
  async addStockBatch(data: { medicineId: string; batchNumber: string; expiryDate?: Date; initialQuantity: number; unitPrice: number }) {
    return withRetry(() => prisma.stockBatch.create({
      data: {
        ...data,
        expiryDate: data.expiryDate || null,
        currentQuantity: data.initialQuantity,
      },
    }));
  }

  // --- DISPENSING ENGINE (FIFO LOGIC) ---
  async dispenseMedicine(medicineId: string, quantityToDispense: number) {
    return withRetry(() => prisma.$transaction(async (tx) => {
      // Lock all batches for this medicine to serialize concurrent dispensing
      await tx.$executeRaw`SELECT id FROM "StockBatch" WHERE "medicineId" = ${medicineId} FOR UPDATE`;

      // 1. Get all available unexpired stock batches for this medicine, ordered by expiry date (FIFO)
      const availableBatches = await tx.stockBatch.findMany({
        where: {
          medicineId,
          currentQuantity: { gt: 0 },
          OR: [
            { expiryDate: null },
            { expiryDate: { gt: new Date() } }
          ]
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
    }));
  }

  // --- ALERTS ---
  async getLowStockAlerts() {
    return withRetry(async () => {
      const medicines = await prisma.medicine.findMany({
        where: { isActive: true },
        include: {
          stockBatches: {
            where: { 
              currentQuantity: { gt: 0 },
              OR: [
                { expiryDate: null },
                { expiryDate: { gt: new Date() } }
              ]
            },
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
    });
  }

  async getExpiringSoonAlerts(daysThreshold: number = 30) {
    return withRetry(async () => {
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
    });
  }

  async getMetrics() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingPrescriptions = await prisma.prescription.count({
        where: { status: "PENDING" }
      });

      const fulfilledToday = await prisma.prescription.count({
        where: {
          status: "DISPENSED",
          updatedAt: { gte: today }
        }
      });

      const allMedicines = await prisma.medicine.findMany({
        where: { isActive: true },
        select: {
          reorderLevel: true,
          stockBatches: {
            select: { currentQuantity: true }
          }
        }
      });
      let lowStockItems = 0;
      allMedicines.forEach((med: any) => {
        const stock = med.stockBatches.reduce((sum: number, b: any) => sum + b.currentQuantity, 0);
        if (stock > 0 && stock <= med.reorderLevel) lowStockItems++;
      });

      const recentPrescriptionsRaw = await prisma.prescription.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { items: true }
      });

      const recentPrescriptions = recentPrescriptionsRaw.map((rx: any) => ({
        id: rx.id,
        patientName: rx.patientName || `Patient ${rx.patientId.slice(0, 4)}`,
        doctor: rx.doctorName || "Unknown Doctor",
        drugs: rx.items.map((i: any) => `${i.drugName} ${i.dosage || ''}`.trim()),
        status: rx.status,
        issuedAt: rx.createdAt
      }));

      const pharmacyLines = await prisma.invoiceLineItem.findMany({
        where: { department: "PHARMACY", createdAt: { gte: today } }
      });
      const totalRevenue = pharmacyLines.reduce((sum: number, item: any) => sum + item.total, 0);

      return {
        pendingPrescriptions,
        fulfilledToday,
        lowStockItems,
        totalRevenue,
        recentPrescriptions
      };
    });
  }

  async updateMedicine(id: string, data: { name?: string; genericName?: string; category?: string; form?: string; unit?: string; reorderLevel?: number; barcode?: string }) {
    if (data.name) {
      const existingName = await prisma.medicine.findFirst({
        where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: id } }
      });
      if (existingName) {
        const err = new Error(`An item with the name "${data.name}" already exists in the inventory.`);
        (err as any).code = 'ALREADY_EXISTS';
        (err as any).itemId = existingName.id;
        throw err;
      }
    }
    
    return withRetry(() => prisma.medicine.update({
      where: { id },
      data
    }));
  }

  async deleteMedicine(id: string) {
    // Check if medicine has active stock batches
    const batches = await prisma.stockBatch.findMany({
      where: { medicineId: id, currentQuantity: { gt: 0 } }
    });
    if (batches.length > 0) {
      throw new Error("Cannot delete medicine with active stock. Deplete or adjust stock first.");
    }
    // Soft delete
    return prisma.medicine.update({ where: { id }, data: { isActive: false } });
  }
}

export const pharmacyService = new PharmacyService();
