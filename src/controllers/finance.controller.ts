import { Request, Response } from 'express';
import { financeService } from "../services/finance.service.js";

class FinanceController {
  async getDashboardData(req: Request, res: Response) {
    try {
      const data = await financeService.getDashboardData();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSettlements(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      const data = await financeService.getDoctorSettlements(
        startDate as string | undefined, 
        endDate as string | undefined
      );
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error fetching doctor settlements:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async addExpense(req: Request, res: Response) {
    try {
      const data = await financeService.addExpense(req.body);
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error("Error adding expense:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getExpenses(req: Request, res: Response) {
    try {
      const data = await financeService.getExpenses();
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error fetching expenses:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createPurchaseOrder(req: Request, res: Response) {
    try {
      const data = await financeService.createPurchaseOrder(req.body);
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error("Error creating PO:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getPurchaseOrders(req: Request, res: Response) {
    try {
      const data = await financeService.getPurchaseOrders();
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error fetching POs:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updatePurchaseOrderStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const data = await financeService.updatePurchaseOrderStatus(id as string, status);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error updating PO status:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

export const financeController = new FinanceController();
