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
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const data = await financeService.getExpenses(page, limit);
      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error("Error fetching expenses:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getShifts(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const data = await financeService.getShifts(page, limit);
      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error("Error fetching shifts:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateExpense(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = await financeService.updateExpense(id as string, req.body);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error updating expense:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteExpense(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await financeService.deleteExpense(id as string);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting expense:", error);
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
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const data = await financeService.getPurchaseOrders(page, limit);
      res.json({ success: true, ...data });
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

  // --- Suppliers ---

  async createSupplier(req: Request, res: Response) {
    try {
      if (!req.body.name || req.body.name.trim() === "") {
        return res.status(400).json({ success: false, error: "Supplier name is required" });
      }
      const data = await financeService.createSupplier(req.body);
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      console.error("Error creating supplier:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getSuppliers(req: Request, res: Response) {
    try {
      const data = await financeService.getSuppliers();
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error fetching suppliers:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateSupplier(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (req.body.name !== undefined && req.body.name.trim() === "") {
        return res.status(400).json({ success: false, error: "Supplier name cannot be empty" });
      }
      const data = await financeService.updateSupplier(id as string, req.body);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error updating supplier:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteSupplier(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await financeService.deleteSupplier(id as string);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting supplier:", error);
      if (error.message.includes("Cannot delete")) {
        return res.status(400).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

export const financeController = new FinanceController();
