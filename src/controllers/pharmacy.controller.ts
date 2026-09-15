import { Request, Response } from 'express';
import { pharmacyService } from '../services/pharmacy.service';

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
      const medicine = await pharmacyService.addMedicine(req.body);
      res.status(201).json(medicine);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async addStockBatch(req: Request, res: Response) {
    try {
      const { expiryDate, ...rest } = req.body;
      const batch = await pharmacyService.addStockBatch({
        ...rest,
        expiryDate: new Date(expiryDate),
      });
      res.status(201).json(batch);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async dispense(req: Request, res: Response) {
    try {
      const { medicineId, quantity } = req.body;
      const result = await pharmacyService.dispenseMedicine(medicineId, Number(quantity));
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
}

export const pharmacyController = new PharmacyController();
