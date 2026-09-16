import { Request, Response } from 'express';
import { pharmacyService } from '../services/pharmacy.service';
import { billingService } from '../services/billing.service';

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

  async addMedicine(req: Request, res: Response) {
    try {
      const { name, category, form, unit } = req.body;
      if (!name || !category || !form || !unit) {
        return res.status(400).json({ error: "Missing required fields: name, category, form, or unit." });
      }
      
      const medicine = await pharmacyService.addMedicine(req.body);
      res.status(201).json(medicine);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
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

  async sell(req: Request, res: Response) {
    try {
      const { items, paymentMethod } = req.body;
      
      const invoice = await billingService.addCharge({
        department: 'OTC',
        description: 'Over The Counter Sales',
        quantity: 1,
        unitPrice: 0 // We will increment via line items
      });

      let totalCost = 0;

      for (const item of items) {
        const result = await pharmacyService.dispenseMedicine(item.id, Number(item.qty));
        
        let itemCost = 0;
        result.batchesUsed.forEach((b: any) => {
          itemCost += b.quantityDispensed * b.unitPrice;
        });

        if (itemCost > 0) {
          totalCost += itemCost;
          await billingService.addCharge({
            invoiceId: invoice.id,
            department: 'PHARMACY',
            referenceId: item.id,
            description: item.name || 'OTC Medication',
            quantity: 1,
            unitPrice: itemCost
          });
        }
      }
      
      // Pay the invoice immediately since it's OTC POS
      const finalInvoice = await billingService.payInvoice(invoice.id, totalCost, paymentMethod);

      res.json({ success: true, invoice: finalInvoice });
    } catch (error: any) {
      console.error(error);
      res.status(400).json({ error: error.message });
    }
  }
}

export const pharmacyController = new PharmacyController();
