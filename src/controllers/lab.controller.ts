import { Request, Response } from 'express';
import { labService } from '../services/lab.service';

export class LabController {
  async getCatalog(req: Request, res: Response) {
    try {
      const catalog = await labService.getCatalog();
      res.json(catalog);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async addTestToCatalog(req: Request, res: Response) {
    try {
      const test = await labService.addTestToCatalog(req.body);
      res.status(201).json(test);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async createRequest(req: Request, res: Response) {
    try {
      const request = await labService.createRequest(req.body);
      res.status(201).json(request);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getPendingRequests(req: Request, res: Response) {
    try {
      const requests = await labService.getPendingRequests();
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getPublishedReports(req: Request, res: Response) {
    try {
      const reports = await labService.getPublishedReports();
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getMetrics(req: Request, res: Response) {
    try {
      const metrics = await labService.getMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async submitResults(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const { results, reportUrl } = req.body;
      
      if (!results || !Array.isArray(results)) {
        return res.status(400).json({ error: "Results array is required" });
      }

      const submission = await labService.submitResults(requestId as string, results, reportUrl as string | undefined);
      res.json(submission);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}

export const labController = new LabController();
