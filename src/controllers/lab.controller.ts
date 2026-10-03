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

  async updateTestInCatalog(req: Request, res: Response) {
    try {
      const test = await labService.updateTestInCatalog(req.params.testId as string, req.body);
      res.json(test);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteTestFromCatalog(req: Request, res: Response) {
    try {
      await labService.deleteTestFromCatalog(req.params.testId as string);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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

  async getBiomarkers(req: Request, res: Response) {
    try {
      const biomarkers = await labService.getBiomarkers(req.params.testId as string);
      res.json({ success: true, data: biomarkers });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateBiomarkers(req: Request, res: Response) {
    try {
      const biomarkers = await labService.updateBiomarkers(req.params.testId as string, req.body.biomarkers);
      res.json({ success: true, data: biomarkers });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getRequestByToken(req: Request, res: Response) {
    try {
      const appointment = await labService.getRequestByToken(req.params.token as string);
      res.json({ success: true, data: appointment });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async getReportByRef(req: Request, res: Response) {
    try {
      const report = await labService.getReportByRef(req.params.referenceNo as string);
      res.json({ success: true, data: report });
    } catch (error: any) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async publishReport(req: Request, res: Response) {
    try {
      const requestId = req.params.requestId as string;
      const { results, reportUrl, referenceNo, testProfile } = req.body;

      if (!results || !Array.isArray(results)) {
        return res.status(400).json({ error: 'Results array is required' });
      }

      const refNo = (referenceNo as string) || requestId.slice(0, 8).toUpperCase();

      const result = await labService.publishReport(
        requestId,
        results,
        (reportUrl as string) || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reports/${refNo}`,
        refNo,
        (testProfile as string) || 'Lab Report'
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}

export const labController = new LabController();
