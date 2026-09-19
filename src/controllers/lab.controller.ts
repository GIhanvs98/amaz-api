import { Request, Response } from 'express';
import { labService } from '../services/lab.service.js';
import { S3Service } from '../services/s3.service.js';

export class LabController {
  async getUploadUrl(req: Request, res: Response) {
    try {
      const { filename, contentType } = req.query;
      
      if (!filename || !contentType) {
        return res.status(400).json({ error: "filename and contentType are required" });
      }

      const result = await S3Service.generateUploadUrl(
        filename as string, 
        contentType as string
      );
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
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
      const { patientPhone, patientName, patientId, testIds, doctorId, priority, visitId } = req.body;

      // Validate test selection
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ error: "At least one testId is required" });
      }

      // Resolve patientId: accept direct patientId or resolve from phone
      let resolvedPatientId = patientId;
      if (!resolvedPatientId) {
        if (!patientPhone || !patientName) {
          return res.status(400).json({ error: "Either patientId or patientPhone + patientName are required" });
        }
        resolvedPatientId = await labService.resolvePatient(patientPhone, patientName);
      }

      const request = await labService.createRequest({
        patientId: resolvedPatientId,
        visitId,
        testIds,
        doctorId,
        priority
      });
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

  async getQueueTokens(req: Request, res: Response) {
    try {
      const tokens = await labService.getQueueTokens();
      res.json({ success: true, data: tokens });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

export const labController = new LabController();
