import { Request, Response } from 'express';
import { pharmacyService } from "../services/pharmacy.service.js";
import { billingService } from '../services/billing.service.js';
import { websocketService } from '../services/websocket.service.js';
import { prisma } from '../lib/prisma.js';

export class PharmacyController {
  async getMedicines(req: Request, res: Response) {
    try {
      const { barcode, page, limit } = req.query;
      const medicines = await pharmacyService.getAllMedicines(
        barcode as string,
        Number(page) || 1,
        Number(limit) || 50
      );
      res.json(medicines);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getMetrics(req: Request, res: Response) {
    try {
      const metrics = await pharmacyService.getMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async addMedicine(req: Request, res: Response) {
    try {
      const { name, barcode, genericName, category, itemType, form, unit, reorderLevel, baseStock, basePrice } = req.body;
      
      if (!name || !category || !unit) {
        return res.status(400).json({ error: "Missing required fields: name, category, or unit." });
      }
      
      if (barcode && !/^[a-zA-Z0-9-]{6,15}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be between 6 and 15 alphanumeric characters." });
      }
      
      const isMedical = !itemType || itemType === "MEDICINE";
      if (isMedical && !form) {
        return res.status(400).json({ error: "Medical items require a form (e.g., Tablet)." });
      }

      const medicine = await pharmacyService.addMedicine({
        name,
        barcode,
        genericName: isMedical ? genericName : null,
        category,
        itemType,
        form: isMedical ? form : null,
        unit,
        reorderLevel: reorderLevel ? Number(reorderLevel) : undefined,
        baseStock: baseStock ? Number(baseStock) : undefined,
        basePrice: basePrice ? Number(basePrice) : undefined
      });
      res.status(201).json(medicine);
    } catch (error: any) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: "Barcode must be unique" });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  async addStockBatch(req: Request, res: Response) {
    try {
      const { expiryDate, initialQuantity, unitPrice, medicineId, batchNumber, ...rest } = req.body;
      
      if (!medicineId || !batchNumber || !expiryDate || initialQuantity === undefined || unitPrice === undefined) {
        return res.status(400).json({ error: "Missing required stock batch fields." });
      }
      
      if (Number(initialQuantity) <= 0 || Number(unitPrice) < 0) {
        return res.status(400).json({ error: "Quantity must be > 0 and price must be >= 0." });
      }

      const batch = await pharmacyService.addStockBatch({
        ...rest,
        medicineId,
        batchNumber,
        initialQuantity: Number(initialQuantity),
        unitPrice: Number(unitPrice),
        expiryDate: new Date(expiryDate),
      });
      res.status(201).json(batch);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async dispense(req: Request, res: Response) {
    try {
      const { medicineId, quantity, visitId, patientId, description } = req.body;
      
      if (!medicineId || quantity === undefined) {
        return res.status(400).json({ error: "Missing medicineId or quantity" });
      }
      
      const qty = Number(quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "Quantity must be a positive number" });
      }

      const result = await pharmacyService.dispenseMedicine(medicineId, qty);
      
      // Calculate total price and add charge if visitId or patientId is provided
      if (visitId || patientId) {
        let totalCost = 0;
        result.batchesUsed.forEach((b: any) => {
          totalCost += b.quantityDispensed * b.unitPrice;
        });

        if (totalCost > 0) {
          await billingService.addCharge({
            visitId,
            patientId,
            department: 'PHARMACY',
            referenceId: medicineId,
            description: description || 'Pharmacy Medication',
            quantity: 1, // We aggregate the cost into 1 line item
            unitPrice: totalCost
          });
        }
      }

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getAlerts(req: Request, res: Response) {
    try {
      const lowStock = await pharmacyService.getLowStockAlerts();
      const expiringSoon = await pharmacyService.getExpiringSoonAlerts();
      res.json({ lowStock, expiringSoon });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateMedicine(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, genericName, category, form, unit, reorderLevel, barcode } = req.body;

      if (barcode && !/^[a-zA-Z0-9-]{6,15}$/.test(barcode)) {
        return res.status(400).json({ error: "Barcode must be between 6 and 15 alphanumeric characters." });
      }

      const medicine = await pharmacyService.updateMedicine(id as string, { name, genericName, category, form, unit, reorderLevel: reorderLevel ? Number(reorderLevel) : undefined, barcode });
      res.json(medicine);
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: "Barcode must be unique" });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async deleteMedicine(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await pharmacyService.deleteMedicine(id as string);
      res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('Cannot delete')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async sell(req: Request, res: Response) {
    try {
      const { items, paymentMethod, prescriptionId, visitId, patientId } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: 'No items provided' });
      }

      // Execute the entire sale atomically in a single transaction
      const result = await prisma.$transaction(async (tx) => {
        // 1. Validate and dispense all items, collecting charges
        const charges: { referenceId?: string; description: string; quantity: number; unitPrice: number; medicineId: string }[] = [];

        for (const item of items) {
          const qty = Number(item.qty);

          // Get available FIFO batches for this medicine
          const availableBatches = await tx.stockBatch.findMany({
            where: {
              medicineId: item.id,
              currentQuantity: { gt: 0 },
              expiryDate: { gt: new Date() },
            },
            orderBy: { expiryDate: 'asc' },
          });

          const totalAvailable = availableBatches.reduce((sum: number, b: any) => sum + b.currentQuantity, 0);
          if (totalAvailable < qty) {
            throw new Error(`Insufficient stock for "${item.name}". Requested: ${qty}, Available: ${totalAvailable}`);
          }

          let remaining = qty;
          let itemCost = 0;

          for (const batch of availableBatches) {
            if (remaining <= 0) break;
            const fromBatch = Math.min(batch.currentQuantity, remaining);
            itemCost += fromBatch * batch.unitPrice;
            remaining -= fromBatch;

            await tx.stockBatch.update({
              where: { id: batch.id },
              data: { currentQuantity: batch.currentQuantity - fromBatch },
            });
          }

          charges.push({
            referenceId: item.id,
            description: item.name || 'Pharmacy Medication',
            quantity: 1,
            unitPrice: itemCost,
            medicineId: item.id,
          });
        }

        const totalCost = charges.reduce((sum, c) => sum + c.unitPrice, 0);

        // 2. Create invoice + add all line items atomically (using bulk method)
        const invoice = await billingService.addChargesBulk({
          visitId,
          patientId,
          charges: charges.map(c => ({
            department: 'PHARMACY',
            referenceId: c.referenceId,
            description: c.description,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
          })),
        }, tx);

        if (!invoice) throw new Error('Failed to create pharmacy invoice');

        // 3. Update prescription status if dispensed from a prescription
        if (prescriptionId) {
          const rx = await tx.prescription.findUnique({
            where: { id: prescriptionId },
            include: { items: true },
          });
          if (rx) {
            for (const rxItem of rx.items) {
              const soldItem = items.find((i: any) => i.id === rxItem.medicineId);
              if (soldItem) {
                await tx.prescriptionItem.update({
                  where: { id: rxItem.id },
                  data: { dispenseQty: Number(soldItem.qty) },
                });
              }
            }
            await tx.prescription.update({
              where: { id: prescriptionId },
              data: { status: 'DISPENSED' },
            });
          }
        }

        // 4. Pay the invoice immediately (POS = instant payment)
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: totalCost,
            method: paymentMethod,
            status: 'COMPLETED',
          },
        });

        const finalInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID' },
          include: { lineItems: true, payments: true },
        });

        return { invoice: finalInvoice, totalCost };
      });

      // Announce payment success via WebSockets (outside the tx — non-critical)
      websocketService.broadcast('pos_payment_success', {
        invoiceId: result.invoice.id,
        totalAmount: result.invoice.totalAmount,
        paymentMethod,
      });

      res.json({ success: true, invoice: result.invoice });
    } catch (error: any) {
      console.error(error);
      res.status(400).json({ error: error.message });
    }
  }
}

export const pharmacyController = new PharmacyController();
