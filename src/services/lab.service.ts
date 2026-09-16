import { PrismaClient } from '@prisma/client';
import { billingService } from './billing.service';

const prisma = new PrismaClient();

export class LabService {
  /**
   * Fetch the catalog of available lab tests
   */
  async getCatalog() {
    return (prisma as any).labTestCatalog.findMany({
      orderBy: { category: 'asc' }
    });
  }

  /**
   * Add a new test to the catalog
   */
  async addTestToCatalog(data: {
    name: string;
    category: string;
    price: number;
    referenceRange?: string;
    unit?: string;
  }) {
    return (prisma as any).labTestCatalog.create({ data });
  }

  /**
   * Create a new Lab Request (Order a test)
   * This automatically charges the patient's billing invoice
   */
  async createRequest(data: {
    patientId: string;
    visitId?: string;
    testId: string;
    doctorId?: string;
    priority?: string;
  }) {
    // Verify test exists to get the price
    const test = await (prisma as any).labTestCatalog.findUnique({
      where: { id: data.testId }
    });

    if (!test) {
      throw new Error("Test not found in catalog");
    }

    // 1. Create the lab request
    const request = await (prisma as any).labRequest.create({
      data: {
        patientId: data.patientId,
        visitId: data.visitId,
        testId: data.testId,
        doctorId: data.doctorId,
        priority: data.priority || "ROUTINE",
        status: "PENDING"
      }
    });

    // 2. Add the charge to the centralized billing engine
    if (data.visitId || data.patientId) {
      await billingService.addCharge({
        visitId: data.visitId,
        patientId: data.patientId,
        department: 'LAB',
        referenceId: request.id,
        description: `Lab Test: ${test.name}`,
        quantity: 1,
        unitPrice: test.price
      });
    }

    return request;
  }

  /**
   * Get pending lab requests for the technicians
   */
  async getPendingRequests() {
    return (prisma as any).labRequest.findMany({
      where: { status: "PENDING" },
      include: {
        test: true
      },
      orderBy: { requestedAt: 'asc' }
    });
  }

  /**
   * Submit biomarker results for a specific request
   */
  async submitResults(requestId: string, results: { biomarker: string; value: string; isOutOfRange: boolean; notes?: string }[], reportUrl?: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Mark request as completed
      const request = await (tx as any).labRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", reportUrl: reportUrl || null }
      });

      // 2. Insert all results
      const createdResults = await Promise.all(
        results.map(res => (tx as any).labResult.create({
          data: {
            requestId: requestId,
            biomarker: res.biomarker,
            value: res.value,
            isOutOfRange: res.isOutOfRange,
            notes: res.notes
          }
        }))
      );

      return { request, results: createdResults };
    });
  }

  /**
   * Get all completed (published) lab requests
   */
  async getPublishedReports() {
    return (prisma as any).labRequest.findMany({
      where: { status: "COMPLETED" },
      include: {
        test: true,
        results: true
      },
      orderBy: { requestedAt: 'desc' }
    });
  }

  /**
   * Get lab tech dashboard metrics
   */
  async getMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingCount = await (prisma as any).labRequest.count({
      where: { status: "PENDING" }
    });

    const publishedCount = await (prisma as any).labRequest.count({
      where: { 
        status: "COMPLETED",
        // Ideally we'd have a 'completedAt' field, but requestedAt is close enough for demo if they just published it
        requestedAt: { gte: today } 
      }
    });

    const criticalCount = await (prisma as any).labResult.count({
      where: {
        isOutOfRange: true,
        request: {
          requestedAt: { gte: today }
        }
      }
    });

    const urgentPending = await (prisma as any).labRequest.findMany({
      where: { status: "PENDING", priority: "URGENT" },
      include: { test: true },
      orderBy: { requestedAt: 'asc' }
    });

    return {
      pendingRequests: pendingCount,
      inProgressTests: Math.floor(pendingCount * 0.3), // Mock "in progress"
      publishedToday: publishedCount,
      criticalResults: criticalCount,
      urgentRequests: urgentPending.map((req: any) => ({
        id: req.id,
        patientName: `Patient ${req.patientId.slice(0, 4)}`,
        doctor: req.doctorId || "Unknown",
        tests: [req.test.name],
        priority: req.priority,
        requestedAt: req.requestedAt
      }))
    };
  }
}

export const labService = new LabService();
