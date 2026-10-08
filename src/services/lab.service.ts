import { billingService } from './billing.service.js';
import { prisma as sharedPrisma, withRetry } from '../lib/prisma.js';
import { NotificationService } from './notification.service.js';
import { websocketService } from './websocket.service.js';
import { S3Service } from './s3.service.js';

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
    roomNumber?: string;
  }) {
    return withRetry(() => prisma.labTest.create({ data }));
  }

  async updateTestInCatalog(id: string, data: {
    name?: string;
    price?: number;
    category?: string;
    sampleType?: string;
    roomNumber?: string;
    isActive?: boolean;
  }) {
    return withRetry(() => prisma.labTest.update({ where: { id }, data }));
  }

  async deleteTestFromCatalog(id: string) {
    // Soft delete: mark as inactive
    return withRetry(() => prisma.labTest.update({ where: { id }, data: { isActive: false } }));
  }

  /**
   * Resolve patientId from phone/name, creating patient if needed
   */
  async resolvePatient(phone: string, name: string): Promise<string> {
    return withRetry(async () => {
      let patient = await prisma.patient.findFirst({
        where: { phone, fullName: name }
      });
      if (!patient) {
        patient = await prisma.patient.create({
          data: { phone, fullName: name }
        });
      }
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
    customPrices?: Record<string, number>;
    skipBilling?: boolean;
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
            create: tests.map(test => {
              const finalPrice = data.customPrices && data.customPrices[test.id] !== undefined 
                ? Number(data.customPrices[test.id]) 
                : test.price;
              
              if (finalPrice < 0) throw new Error("Price cannot be negative");
              return {
                labTestId: test.id,
                price: finalPrice
              };
            })
          }
        },
        include: {
          items: true
        }
      });

      // 2. Add all charges atomically using bulk billing
      if (!data.skipBilling && (data.visitId || data.patientId)) {
        await billingService.addChargesBulk({
          visitId: data.visitId,
          patientId: data.patientId,
          charges: tests.map(test => {
            const finalPrice = data.customPrices && data.customPrices[test.id] !== undefined
              ? Number(data.customPrices[test.id])
              : test.price;
            return {
              department: 'LAB',
              referenceId: request.id,
              description: `Lab Test: ${test.name}`,
              quantity: 1,
              unitPrice: finalPrice
            };
          })
        });
      }

      websocketService.broadcast("lab_request_created", request);
      return request;
    });
  }

  /**
   * Get pending lab requests for the technicians
   */
  async getPendingRequests() {
    return withRetry(() => prisma.labRequest.findMany({
      where: { status: { in: ["PENDING", "SAVED", "IN_PROGRESS"] } },
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
      // 1. Mark request as SAVED (has results but not finalized/published)
      const request = await tx.labRequest.update({
        where: { id: requestId },
        data: { status: "SAVED", reportUrl: reportUrl || null }
      });

      // 2. Delete old results if re-submitting
      await tx.labResult.deleteMany({ where: { requestId } });

      // 3. Fetch canonical biomarker definitions for server-side validation
      const labReq = await tx.labRequest.findUnique({
        where: { id: requestId },
        include: { items: { include: { LabTest: { include: { biomarkers: true } } } } }
      });

      const biomarkerMap = new Map<string, any>();
      labReq?.items.forEach(item => {
        item.LabTest.biomarkers.forEach((bm: any) => {
          biomarkerMap.set(bm.name.toLowerCase().trim(), bm);
        });
      });

      // Helper to compute flag server-side from reference range
      const computeFlag = (value: string, refRange: string): { flag: string; isOutOfRange: boolean } => {
        const numVal = parseFloat(value);
        if (isNaN(numVal) || !refRange) return { flag: 'N', isOutOfRange: false };
        const rangeMatch = refRange.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
        if (!rangeMatch) return { flag: 'N', isOutOfRange: false };
        const low = parseFloat(rangeMatch[1] as string);
        const high = parseFloat(rangeMatch[2] as string);
        if (numVal < low) return { flag: 'L', isOutOfRange: true };
        if (numVal > high) return { flag: 'H', isOutOfRange: true };
        return { flag: 'N', isOutOfRange: false };
      };

      // 4. Insert all results with server-validated flags
      const createdResults = await Promise.all(
        results.map(res => {
          const bm = biomarkerMap.get(res.biomarker.toLowerCase().trim());
          const canonicalRange = bm?.referenceRange || res.referenceRange || '';
          const { flag, isOutOfRange } = computeFlag(res.value, canonicalRange);
          return tx.labResult.create({
            data: {
              requestId,
              biomarker: res.biomarker,
              value: res.value,
              flag, // Server-validated, not from client
              referenceRange: canonicalRange,
              isOutOfRange, // Server-validated, not from client
              notes: res.notes
            }
          });
        })
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
      const labReqResult = await prisma.$transaction(async (tx) => {
        // 1. Atomic status update preventing lost updates from concurrent techs
        const updateResult = await tx.labRequest.updateMany({
          where: { id: requestId, status: { in: ['PENDING', 'SAVED'] } },
          data: { status: 'COMPLETED', reportUrl }
        });

        if (updateResult.count === 0) {
          throw new Error("Lab request has already been completed or is not pending. Cannot overwrite.");
        }

        const labReq = await tx.labRequest.findUnique({
          where: { id: requestId },
          include: { Patient: true }
        });

        if (!labReq) throw new Error("Lab request not found after update");

        // 2. Insert new results
        await tx.labResult.deleteMany({ where: { requestId } });
        await tx.labResult.createMany({
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

        return labReq;
      });

      // 3. Fire SMS — non-blocking (fire and forget), outside transaction
      const patient = labReqResult.Patient;
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
    return withRetry(async () => {
      const reports = await prisma.labRequest.findMany({
      where: { status: "COMPLETED" },
      include: {
        items: {
          include: { LabTest: { include: { biomarkers: { orderBy: { orderIndex: 'asc' } } } } }
        },
        results: true,
        Patient: true
      },
      orderBy: { requestedAt: 'desc' }
      });

      for (const report of reports) {
        if (report.reportUrl && report.reportUrl.includes('amazonaws.com')) {
          const presignedUrl = await S3Service.generateDownloadUrl(report.reportUrl);
          if (presignedUrl) report.reportUrl = presignedUrl;
        }
      }

      return reports;
    });
  }

  /**
   * Get lab tech dashboard metrics
   */
    async getMetrics() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Pending (currently waiting)
      const pendingCount = await prisma.labRequest.count({
        where: { status: "PENDING" }
      });
      const savedCount = await prisma.labRequest.count({
        where: { status: "SAVED" }
      });

      // Published today vs yesterday
      const publishedToday = await prisma.labRequest.count({
        where: { status: "COMPLETED", requestedAt: { gte: today } }
      });
      const publishedYesterday = await prisma.labRequest.count({
        where: { status: "COMPLETED", requestedAt: { gte: yesterday, lt: today } }
      });

      const requestsToday = await prisma.labRequest.count({
        where: { requestedAt: { gte: today } }
      });
      const requestsYesterday = await prisma.labRequest.count({
        where: { requestedAt: { gte: yesterday, lt: today } }
      });

      const criticalToday = await prisma.labResult.count({
        where: { isOutOfRange: true, request: { requestedAt: { gte: today } } }
      });
      const criticalYesterday = await prisma.labResult.count({
        where: { isOutOfRange: true, request: { requestedAt: { gte: yesterday, lt: today } } }
      });

      // Status Distribution
      const statusCounts = await prisma.labRequest.groupBy({
        by: ['status'],
        _count: { id: true },
        where: { requestedAt: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) } } // Last 30 days
      });
      
      const statusDistribution = statusCounts.map(s => ({
        name: s.status,
        value: s._count.id
      }));

      // Weekly tests (Last 7 days)
      const weeklyTests = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const nextD = new Date(d);
        nextD.setDate(d.getDate() + 1);
        
        const count = await prisma.labRequest.count({
          where: { requestedAt: { gte: d, lt: nextD } }
        });
        
        weeklyTests.push({
          date: d.toLocaleDateString('en-US', { weekday: 'short' }),
          count
        });
      }

      // Urgent Pending
      const urgentPending = await prisma.labRequest.findMany({
        where: { status: { in: ["PENDING", "SAVED"] }, priority: "URGENT" },
        include: { 
          items: { include: { LabTest: true } },
          Patient: true,
          Visit: { include: { User: true } }
        },
        orderBy: { requestedAt: 'asc' },
        take: 10
      });

      // Recent Published
      const recentPublished = await prisma.labRequest.findMany({
        where: { status: "COMPLETED" },
        include: { 
          items: { include: { LabTest: true } },
          Patient: true,
          Visit: { include: { User: true } }
        },
        orderBy: { requestedAt: 'desc' },
        take: 5
      });

      return {
        summary: {
          requestsToday,
          requestsYesterday,
          pendingRequests: pendingCount,
          inProgressTests: savedCount,
          publishedToday,
          publishedYesterday,
          criticalToday,
          criticalYesterday
        },
        charts: {
          weeklyTests,
          statusDistribution
        },
        tables: {
          urgentRequests: urgentPending.map(req => ({
            id: req.id,
            patientName: req.Patient?.fullName || `Patient ${req.patientId.slice(0, 4)}`,
            doctor: req.Visit?.User?.fullName || "Unknown Doctor",
            tests: req.items.map(i => i.LabTest?.name),
            priority: req.priority,
            status: req.status,
            requestedAt: req.requestedAt
          })),
          recentPublished: recentPublished.map(req => {
            // Note: Not making this fully async for metrics view, 
            // but if reportUrl is S3 we could transform it. We'll leave metrics raw for speed
            return {
              id: req.id,
              patientName: req.Patient?.fullName || `Patient ${req.patientId.slice(0, 4)}`,
              doctor: req.Visit?.User?.fullName || "Unknown Doctor",
              tests: req.items.map(i => i.LabTest?.name),
              reportUrl: req.reportUrl,
              requestedAt: req.requestedAt
            };
          })
        }
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
    }, {
      maxWait: 5000,
      timeout: 15000
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
      if (report.reportUrl && report.reportUrl.includes('amazonaws.com')) {
        const presignedUrl = await S3Service.generateDownloadUrl(report.reportUrl);
        if (presignedUrl) report.reportUrl = presignedUrl;
      }
      return report;
    });
  }
}

export const labService = new LabService();
