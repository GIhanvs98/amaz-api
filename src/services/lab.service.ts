import { billingService } from './billing.service.js';
import { prisma as sharedPrisma, withRetry } from '../lib/prisma.js';
import { NotificationService } from './notification.service.js';

// Use shared singleton to avoid multiple connection pools
const prisma = sharedPrisma;

export class LabService {
  /**
   * Fetch the catalog of available lab tests
   */
  async getCatalog() {
    return withRetry(() => prisma.labTest.findMany({
      where: { isActive: true },
      orderBy: { category: 'asc' }
    }));
  }

  /**
   * Add a new test to the catalog
   */
  async addTestToCatalog(data: {
    name: string;
    code: string;
    category: string;
    price: number;
    sampleType?: string;
  }) {
    return withRetry(() => prisma.labTest.create({ data }));
  }

  /**
   * Resolve patientId from phone/name, creating patient if needed
   */
  async resolvePatient(phone: string, name: string): Promise<string> {
    return withRetry(async () => {
      const patient = await prisma.patient.upsert({
        where: { phone },
        update: {},
        create: { phone, fullName: name }
      });
      return patient.id;
    });
  }

  /**
   * Create a new Lab Request (Order multiple tests)
   * This automatically charges the patient's billing invoice
   */
  async createRequest(data: {
    patientId: string;
    visitId?: string;
    testIds: string[];
    doctorId?: string;
    priority?: string;
  }) {
    return withRetry(async () => {
      // Verify tests exist to get prices
      const tests = await prisma.labTest.findMany({
        where: { id: { in: data.testIds } }
      });

      if (tests.length !== data.testIds.length) {
        throw new Error("One or more tests not found in catalog");
      }

      // 1. Create the lab request with items
      const request = await prisma.labRequest.create({
        data: {
          patientId: data.patientId,
          doctorId: data.doctorId,
          priority: data.priority || "ROUTINE",
          status: "PENDING",
          items: {
            create: tests.map(test => ({
              labTestId: test.id,
              price: test.price
            }))
          }
        },
        include: {
          items: true
        }
      });

      // 2. Add the charge to the centralized billing engine
      if (data.visitId || data.patientId) {
        // Create separate charges for each test
        for (const test of tests) {
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
      }

      return request;
    });
  }

  /**
   * Get pending lab requests for the technicians
   */
  async getPendingRequests() {
    return withRetry(() => prisma.labRequest.findMany({
      where: { status: "PENDING" },
      include: {
        items: {
          include: { LabTest: { include: { biomarkers: { orderBy: { orderIndex: 'asc' } } } } }
        },
        Patient: true,
        Visit: {
          include: { User: true }
        }
      },
      orderBy: { requestedAt: 'asc' }
    }));
  }

  /**
   * Submit biomarker results for a specific request
   */
  async submitResults(requestId: string, results: { biomarker: string; value: string; flag?: string; referenceRange?: string; isOutOfRange: boolean; notes?: string }[], reportUrl?: string) {
    return withRetry(() => prisma.$transaction(async (tx) => {
      // 1. Mark request as completed
      const request = await tx.labRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", reportUrl: reportUrl || null }
      });

      // 2. Delete old results if re-submitting
      await tx.labResult.deleteMany({ where: { requestId } });

      // 3. Insert all results with flag and referenceRange
      const createdResults = await Promise.all(
        results.map(res => tx.labResult.create({
          data: {
            requestId,
            biomarker: res.biomarker,
            value: res.value,
            flag: res.flag || 'N',
            referenceRange: res.referenceRange || '',
            isOutOfRange: res.isOutOfRange,
            notes: res.notes
          }
        }))
      );

      return { request, results: createdResults };
    }));
  }

  /**
   * Publish a completed lab report: save results, set COMPLETED, store reportUrl, and fire SMS to patient.
   */
  async publishReport(
    requestId: string,
    results: { biomarker: string; value: string; flag?: string; referenceRange?: string; isOutOfRange: boolean; notes?: string }[],
    reportUrl: string,
    referenceNo: string,
    testProfile: string
  ) {
    return withRetry(async () => {
      // 1. Mark request as completed and store report URL
      const labReq = await prisma.labRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED', reportUrl },
        include: { Patient: true }
      });

      // 2. Delete old results if re-publishing, then insert new
      await prisma.labResult.deleteMany({ where: { requestId } });
      await prisma.labResult.createMany({
        data: results.map(r => ({
          requestId,
          biomarker: r.biomarker,
          value: r.value,
          flag: r.flag || 'N',
          referenceRange: r.referenceRange || '',
          isOutOfRange: r.isOutOfRange,
          notes: r.notes
        }))
      });

      // 3. Fire SMS — non-blocking (fire and forget)
      const patient = labReq.Patient;
      if (patient?.phone) {
        NotificationService.sendTemplatedSMS(
          patient.id,
          patient.phone,
          'LAB_REPORT_READY',
          {
            patientName: patient.fullName,
            testProfile,
            referenceNo,
            reportLink: reportUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reports/${referenceNo}`
          }
        ).catch(console.error);
      }

      return { success: true, requestId, reportUrl };
    });
  }

  /**
   * Get all completed (published) lab requests
   */
  async getPublishedReports() {
    return withRetry(() => prisma.labRequest.findMany({
      where: { status: "COMPLETED" },
      include: {
        items: {
          include: { LabTest: { include: { biomarkers: { orderBy: { orderIndex: 'asc' } } } } }
        },
        results: true,
        Patient: true
      },
      orderBy: { requestedAt: 'desc' }
    }));
  }

  /**
   * Get lab tech dashboard metrics
   */
  async getMetrics() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingCount = await prisma.labRequest.count({
        where: { status: "PENDING" }
      });

      const publishedCount = await prisma.labRequest.count({
        where: { 
          status: "COMPLETED",
          requestedAt: { gte: today } 
        }
      });

      const criticalCount = await prisma.labResult.count({
        where: {
          isOutOfRange: true,
          request: {
            requestedAt: { gte: today }
          }
        }
      });

      const urgentPending = await prisma.labRequest.findMany({
        where: { status: "PENDING", priority: "URGENT" },
        include: { 
          items: { include: { LabTest: true } },
          Patient: true,
          Visit: { include: { User: true } }
        },
        orderBy: { requestedAt: 'asc' }
      });

      return {
        pendingRequests: pendingCount,
        inProgressTests: Math.floor(pendingCount * 0.3),
        publishedToday: publishedCount,
        criticalResults: criticalCount,
        urgentRequests: urgentPending.map(req => ({
          id: req.id,
          patientName: req.Patient?.fullName || `Patient ${req.patientId.slice(0, 4)}`,
          doctor: req.Visit?.User?.fullName || "Unknown Doctor",
          tests: req.items.map(i => i.LabTest?.name),
          priority: req.priority,
          requestedAt: req.requestedAt
        }))
      };
    });
  }

  /**
   * Get waiting lab queue tokens
   */
  async getQueueTokens() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return prisma.appointment.findMany({
        where: {
          department: { in: ["LAB", "MULTI"] },
          appointmentDate: { gte: today },
          status: { notIn: ["COMPLETED", "CANCELLED"] }
        },
        include: {
          Patient: true
        },
        orderBy: { createdAt: 'asc' }
      });
    });
  }

  /**
   * Get biomarkers for a specific test
   */
  async getBiomarkers(testId: string) {
    return withRetry(() => prisma.labTestBiomarker.findMany({
      where: { labTestId: testId },
      orderBy: { orderIndex: 'asc' }
    }));
  }

  /**
   * Update biomarkers for a specific test
   */
  async updateBiomarkers(testId: string, biomarkers: { name: string; category?: string; unit?: string; referenceRange?: string; orderIndex: number }[]) {
    return withRetry(() => prisma.$transaction(async (tx) => {
      // Delete existing
      await tx.labTestBiomarker.deleteMany({ where: { labTestId: testId } });
      
      // Create new
      if (biomarkers.length > 0) {
        await tx.labTestBiomarker.createMany({
          data: biomarkers.map(b => ({
            ...b,
            labTestId: testId
          }))
        });
      }
      
      return tx.labTestBiomarker.findMany({
        where: { labTestId: testId },
        orderBy: { orderIndex: 'asc' }
      });
    }));
  }

  /**
   * Resolve a token to its patient and pending lab requests
   */
  async getRequestByToken(tokenNumber: string) {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const appointment = await prisma.appointment.findFirst({
        where: {
          tokenNumber: tokenNumber,
          appointmentDate: { gte: today },
          status: { notIn: ["CANCELLED"] }
        },
        include: {
          Patient: true,
          LabRequests: {
            where: { status: "PENDING" },
            include: {
              items: {
                include: { LabTest: { include: { biomarkers: true } } }
              }
            }
          }
        }
      });

      if (!appointment) {
        throw new Error("Token not found or expired today");
      }
      
      return appointment;
    });
  }
  /**
   * Fetch a published report by its reference number (first 8 chars of requestId, uppercase)
   */
  async getReportByRef(referenceNo: string) {
    return withRetry(async () => {
      // referenceNo is first 8 chars of the UUID in uppercase
      const report = await prisma.labRequest.findFirst({
        where: {
          id: { startsWith: referenceNo.toLowerCase() },
          status: 'COMPLETED'
        },
        include: {
          Patient: true,
          results: { orderBy: { recordedAt: 'asc' } },
          items: {
            include: {
              LabTest: {
                include: { biomarkers: { orderBy: { orderIndex: 'asc' } } }
              }
            }
          },
          Visit: { include: { User: true } }
        }
      });

      if (!report) throw new Error('Report not found or not yet published');
      return report;
    });
  }
}

export const labService = new LabService();
