import { Request, Response } from 'express';
import { financeService } from '../services/finance.service';

class FinanceController {
  async getDashboardData(req: Request, res: Response) {
    try {
      const data = await financeService.getDashboardData();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export const financeController = new FinanceController();
