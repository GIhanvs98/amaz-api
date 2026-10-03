import { Request, Response } from 'express';
import { pharmacyService } from "../services/pharmacy.service.js";
import { billingService } from '../services/billing.service.js';
import { websocketService } from '../services/websocket.service.js';
import { prisma } from '../lib/prisma.js';

export class PharmacyController {
  async getMedicines(req: Request, res: Response) {
    try {
      const { barcode } = req.query;
      const medicines = await pharmacyService.getAllMedicines(barcode as string);
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
      const result = await pharmacyService.dispenseMedicine(medicineId, Number(quantity));
      
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
      
      const invoice = await billingService.addCharge({
        visitId,
        patientId,
        department: 'PHARMACY',
        description: prescriptionId ? 'Pharmacy Prescription Sales' : 'Over The Counter Sales',
        quantity: 1,
        unitPrice: 0 // Invoice creation hook
      });

      let totalCost = 0;
      const chargeItems: { referenceId?: string; description: string; quantity: number; unitPrice: number; medicineId?: string }[] = [];

      for (const item of items) {
        // We still need to call dispenseMedicine to deduct inventory correctly
        const result = await pharmacyService.dispenseMedicine(item.id, Number(item.qty));
        
        let itemCost = 0;
        let totalDispensed = 0;
        result.batchesUsed.forEach((b: any) => {
          itemCost += b.quantityDispensed * b.unitPrice;
          totalDispensed += b.quantityDispensed;
        });

        if (itemCost > 0) {
          totalCost += itemCost;
          chargeItems.push({
            referenceId: item.id,
            description: item.name || 'Pharmacy Medication',
            quantity: 1,
            unitPrice: itemCost,
            medicineId: item.id
          });
        }
      }
      
      // Insert line items individually since addChargesBulk does not exist
      if (chargeItems.length > 0) {
        for (const item of chargeItems) {
          await billingService.addCharge({
            invoiceId: invoice.id,
            department: 'PHARMACY',
            referenceId: item.referenceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice
          });
        }
      }

      // If tied to a prescription, update the prescription quantities and status
      if (prescriptionId) {
        const rx = await prisma.prescription.findUnique({
          where: { id: prescriptionId },
          include: { items: true }
        });
        if (rx) {
          for (const rxItem of rx.items) {
            const chargeItem = chargeItems.find(c => c.medicineId === rxItem.medicineId);
            if (chargeItem) {
               // We dispensed it. (The total quantity was passed in item.qty and deducted from batches)
               // The exact dispensed amount is tracked, we can just use the requested qty as the dispenseQty for now,
               // or lookup the original requested item in req.body.items.
               const requestedItem = items.find((i: any) => i.id === rxItem.medicineId);
               if (requestedItem) {
                 await prisma.prescriptionItem.update({
                   where: { id: rxItem.id },
                   data: { dispenseQty: Number(requestedItem.qty) }
                 });
               }
            }
          }
          await prisma.prescription.update({
            where: { id: prescriptionId },
            data: { status: "DISPENSED" }
          });
        }
      }

      // Pay the invoice immediately since it's OTC POS
      const finalInvoice = await billingService.payInvoice(invoice.id, totalCost, paymentMethod);

      // Announce payment success via WebSockets
      websocketService.broadcast('pos_payment_success', {
        invoiceId: finalInvoice.id,
        totalAmount: finalInvoice.totalAmount,
        paymentMethod
      });

      res.json({ success: true, invoice: finalInvoice });
    } catch (error: any) {
      console.error(error);
      res.status(400).json({ error: error.message });
    }
  }
}

export const pharmacyController = new PharmacyController();
