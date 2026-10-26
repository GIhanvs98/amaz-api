import { billingService } from './billing.service.js';
import { prisma as sharedPrisma, withRetry } from '../lib/prisma.js';
import { NotificationService } from './notification.service.js';
import { websocketService } from './websocket.service.js';
import { S3Service } from './s3.service.js';
import { getTimezoneBoundaries } from '../lib/dateUtils.js';

// Use shared singleton to avoid multiple connection pools
const prisma = sharedPrisma;

export class LabService {
  /**
   * Fetch the catalog of available lab tests
   */
  async getCatalog() {
    return withRetry(() => prisma.labTest.findMany({
      where: { isActive: true },
      include: {
        room: {
          select: { id: true, roomNumber: true, department: true }
        }
      },
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
    roomId?: string;
    roomNumber?: string;
    isOutsideTest?: boolean;
    hospitalCommission?: number;
    commissionType?: string;
    outsourceCost?: number;
    outsourcedCenter?: string;
  }) {
    let targetRoomId = data.roomId;
    if (!targetRoomId && data.roomNumber) {
      const room = await prisma.room.findFirst({ where: { roomNumber: data.roomNumber } });
      if (room) targetRoomId = room.id;
    }

    return withRetry(() => prisma.labTest.create({
      data: {
        name: data.name,
        code: data.code,
        category: data.category,
        price: data.price,
        sampleType: data.sampleType,
        roomId: targetRoomId || undefined,
        isOutsideTest: Boolean(data.isOutsideTest),
        hospitalCommission: data.hospitalCommission !== undefined ? parseFloat(String(data.hospitalCommission)) : 0,
        commissionType: data.commissionType || "FLAT",
        outsourceCost: data.outsourceCost !== undefined ? parseFloat(String(data.outsourceCost)) : 0,
        outsourcedCenter: data.outsourcedCenter || null
      },
      include: {
        room: {
          select: { id: true, roomNumber: true, department: true }
        }
      }
    }));
  }

  async updateTestInCatalog(id: string, data: {
    name?: string;
    code?: string;
    price?: number;
    category?: string;
    sampleType?: string;
    roomId?: string;
    roomNumber?: string;
    isOutsideTest?: boolean;
    hospitalCommission?: number;
    commissionType?: string;
    outsourceCost?: number;
    outsourcedCenter?: string;
    isActive?: boolean;
  }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.sampleType !== undefined) updateData.sampleType = data.sampleType;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.isOutsideTest !== undefined) updateData.isOutsideTest = Boolean(data.isOutsideTest);
    if (data.hospitalCommission !== undefined) updateData.hospitalCommission = parseFloat(String(data.hospitalCommission));
    if (data.commissionType !== undefined) updateData.commissionType = data.commissionType;
    if (data.outsourceCost !== undefined) updateData.outsourceCost = parseFloat(String(data.outsourceCost));
    if (data.outsourcedCenter !== undefined) updateData.outsourcedCenter = data.outsourcedCenter;

    if (data.roomId !== undefined) {
      updateData.roomId = data.roomId || null;
    } else if (data.roomNumber !== undefined) {
      if (data.roomNumber) {
        const room = await prisma.room.findFirst({ where: { roomNumber: data.roomNumber } });
        updateData.roomId = room ? room.id : null;
      } else {
        updateData.roomId = null;
      }
    }

    return withRetry(() => prisma.labTest.update({
      where: { id },
      data: updateData,
      include: {
        room: {
          select: { id: true, roomNumber: true, department: true }
        }
      }
    }));
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

      let effectiveDoctorId = data.doctorId;
      if (!effectiveDoctorId && data.visitId) {
        const apt = await prisma.appointment.findUnique({
          where: { id: data.visitId },
          select: { doctorId: true }
        });
        if (apt?.doctorId) effectiveDoctorId = apt.doctorId;
      }

      // 1. Create the lab request with items
      const request = await prisma.labRequest.create({
        data: {
          patientId: data.patientId,
          doctorId: effectiveDoctorId,
          visitId: data.visitId,
          priority: data.priority || "ROUTINE",
          status: "PENDING",
          items: {
            create: tests.map(test => {
              const basePrice = data.customPrices && data.customPrices[test.id] !== undefined 
                ? Number(data.customPrices[test.id]) 
                : test.price;
              
              const finalPrice = test.isOutsideTest && (test.hospitalCommission || 0) > 0 && !data.customPrices?.[test.id]
                ? basePrice + (test.hospitalCommission || 0)
                : basePrice;
              
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
            const basePrice = data.customPrices && data.customPrices[test.id] !== undefined
              ? Number(data.customPrices[test.id])
              : test.price;
            
            const finalPrice = test.isOutsideTest && (test.hospitalCommission || 0) > 0 && !data.customPrices?.[test.id]
              ? basePrice + (test.hospitalCommission || 0)
              : basePrice;

            return {
              department: 'LAB',
              referenceId: request.id,
              description: test.isOutsideTest
                ? `Lab Test (Outsourced - ${test.outsourcedCenter || 'Partner'}): ${test.name}`
                : `Lab Test: ${test.name}`,
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
  async getPendingRequests(doctorId?: string, type?: string) {
    const whereClause: any = {
      status: { in: ["PENDING", "SAVED", "IN_PROGRESS"] }
    };

    if (doctorId) {
      whereClause.OR = [
        { doctorId },
        { Visit: { doctorId } }
      ];
    }

    if (type === "OUTSIDE") {
      whereClause.items = {
        some: { LabTest: { isOutsideTest: true } }
      };
    } else if (type === "IN_HOUSE" || !type) {
      // Default for technicians' workbench: only in-house hospital tests
      whereClause.items = {
        some: { LabTest: { isOutsideTest: false } }
      };
    }

    return withRetry(() => prisma.labRequest.findMany({
      where: whereClause,
      include: {
        items: {
          include: { LabTest: { include: { biomarkers: { orderBy: { orderIndex: 'asc' } }, room: true } } }
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
        // 1. Atomic status update allowing updates from active states and re-publishing
        const updateResult = await tx.labRequest.updateMany({
          where: { id: requestId, status: { in: ['PENDING', 'SAVED', 'IN_PROGRESS', 'COMPLETED'] } },
          data: { status: 'COMPLETED', reportUrl }
        });

        if (updateResult.count === 0) {
          throw new Error("Lab request not found or cannot be published.");
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

      // 3. Broadcast real-time websocket event
      websocketService.broadcast("lab_report_published", {
        requestId,
        reportUrl,
        status: "COMPLETED",
        referenceNo
      });

      // 4. Fire SMS — non-blocking (fire and forget), outside transaction
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
            barcode: referenceNo,
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
  async getPublishedReports(doctorId?: string) {
    return withRetry(async () => {
      const reports = await prisma.labRequest.findMany({
        where: doctorId
          ? {
              status: "COMPLETED",
              OR: [
                { doctorId },
                { Visit: { doctorId } }
              ]
            }
          : { status: "COMPLETED" },
        include: {
          items: {
            include: { LabTest: { include: { biomarkers: { orderBy: { orderIndex: 'asc' } }, room: true } } }
          },
          results: true,
          Patient: true,
          Visit: {
            include: { User: true }
          }
        },
        orderBy: { requestedAt: 'desc' }
      });

      for (const report of reports) {
        if (report.reportUrl && S3Service.isS3Url(report.reportUrl)) {
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
  async getQueueTokens(roomId?: string) {
    return withRetry(async () => {
      const { startOfDay, endOfDay } = getTimezoneBoundaries();

      const whereClause: any = {
        department: { in: ["LAB", "MULTI"] },
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["WAITING", "BOOKED", "WAITING_FOR_LAB_TEST", "IN_PROGRESS"] }
      };

      if (roomId) {
        whereClause.OR = [
          { roomId: roomId },
          { room: { roomNumber: roomId } }
        ];
      }

      return prisma.appointment.findMany({
        where: whereClause,
        include: {
          Patient: true,
          room: true
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
  async updateBiomarkers(testId: string, biomarkers: { name: string; category?: string | null; unit?: string | null; referenceRange?: string | null; orderIndex?: number }[]) {
    return withRetry(() => prisma.$transaction(async (tx) => {
      // 1. Delete existing
      await tx.labTestBiomarker.deleteMany({ where: { labTestId: testId } });
      
      // 2. Filter valid rows with a non-empty name
      const validBiomarkers = (biomarkers || []).filter(b => b && typeof b.name === 'string' && b.name.trim() !== "");

      // 3. Create new clean rows (ensuring uniform column set without mismatched ids)
      if (validBiomarkers.length > 0) {
        await tx.labTestBiomarker.createMany({
          data: validBiomarkers.map((b, idx) => ({
            labTestId: testId,
            name: b.name.trim(),
            category: b.category && b.category !== 'NONE' && b.category.trim() !== '' ? b.category.trim() : null,
            unit: b.unit && b.unit.trim() !== '' ? b.unit.trim() : null,
            referenceRange: b.referenceRange && b.referenceRange.trim() !== '' ? b.referenceRange.trim() : null,
            orderIndex: typeof b.orderIndex === 'number' ? b.orderIndex : idx + 1
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
  async getRequestByToken(tokenOrBarcode: string) {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const code = (tokenOrBarcode || "").trim();

      if (!code) {
        throw new Error("Token or barcode is required");
      }

      // 1. Direct LabRequest ID check
      const directLabReq = await prisma.labRequest.findFirst({
        where: {
          OR: [
            { id: code },
            ...(code.length >= 8 ? [{ id: { startsWith: code.toLowerCase() } }] : [])
          ]
        },
        include: {
          Patient: true,
          items: {
            include: { LabTest: { include: { biomarkers: true, room: true } } }
          }
        }
      });

      if (directLabReq) {
        const appt = directLabReq.visitId ? await prisma.appointment.findUnique({
          where: { id: directLabReq.visitId },
          include: { Patient: true }
        }) : null;

        let allLabRequests = [directLabReq];
        let allAppointments: any[] = appt ? [appt] : [];

        if (appt?.bookingReference) {
          allAppointments = await prisma.appointment.findMany({
            where: { bookingReference: appt.bookingReference, status: { not: "CANCELLED" } },
            include: { Patient: true },
            orderBy: { createdAt: "asc" }
          });
          const apptIds = allAppointments.map(a => a.id);
          allLabRequests = await prisma.labRequest.findMany({
            where: {
              OR: [
                { visitId: { in: apptIds } },
                { patientId: directLabReq.patientId, requestedAt: { gte: today } }
              ]
            },
            include: {
              Patient: true,
              items: { include: { LabTest: { include: { biomarkers: true, room: true } } } }
            },
            orderBy: { requestedAt: "desc" }
          });
        }

        const labAppt = allAppointments.find(a => a.department === "LAB") || appt;
        const consultAppt = allAppointments.find(a => a.department === "CONSULTATION");

        return {
          ...(appt || {}),
          id: appt?.id || directLabReq.visitId || directLabReq.id,
          bookingReference: appt?.bookingReference || null,
          tokenNumber: labAppt?.tokenNumber || appt?.tokenNumber || "LAB",
          Patient: directLabReq.Patient,
          allAppointments,
          LabRequests: allLabRequests,
          tokens: {
            lab: labAppt?.tokenNumber || "LAB",
            consultation: consultAppt?.tokenNumber || null
          }
        };
      }

      // 2. Appointment lookup by UUID, booking reference, or tokenNumber
      const orConditions: any[] = [
        { id: code },
        { bookingReference: code }
      ];

      if (code.length >= 8) {
        orConditions.push({ id: { startsWith: code } });
      }

      if (/^\d{1,3}$/.test(code)) {
        orConditions.push({
          tokenNumber: code.padStart(2, "0"),
          appointmentDate: { gte: today }
        });
        orConditions.push({
          tokenNumber: code,
          appointmentDate: { gte: today }
        });
      }

      let appointment = await prisma.appointment.findFirst({
        where: {
          OR: orConditions,
          status: { notIn: ["CANCELLED"] }
        },
        include: {
          Patient: true,
          room: true
        },
        orderBy: { appointmentDate: "desc" }
      });

      // 3. Fallback: check Invoice ID -> visitId
      if (!appointment) {
        const invoice = await prisma.invoice.findFirst({
          where: {
            OR: [
              { id: code },
              ...(code.length >= 8 ? [{ id: { startsWith: code } }] : [])
            ]
          }
        });

        if (invoice && invoice.visitId) {
          appointment = await prisma.appointment.findUnique({
            where: { id: invoice.visitId },
            include: {
              Patient: true,
              room: true
            }
          });
        }
      }

      if (!appointment) {
        throw new Error("Token or barcode not found");
      }

      // Fetch all appointments connected to this visit
      let allAppointments: any[] = [];
      if (appointment.bookingReference) {
        allAppointments = await prisma.appointment.findMany({
          where: {
            bookingReference: appointment.bookingReference,
            status: { not: "CANCELLED" }
          },
          include: { Patient: true, room: true },
          orderBy: { createdAt: "asc" }
        });
      }

      if (allAppointments.length === 0) {
        allAppointments = [appointment];
      }

      const allApptIds = allAppointments.map(a => a.id);

      // Fetch all LabRequests across all visit appointments or created for this patient today
      const allLabRequests = await prisma.labRequest.findMany({
        where: {
          OR: [
            { visitId: { in: allApptIds } },
            {
              patientId: appointment.patientId,
              requestedAt: { gte: today }
            }
          ]
        },
        include: {
          Patient: true,
          items: {
            include: { LabTest: { include: { biomarkers: true } } }
          }
        },
        orderBy: { requestedAt: "desc" }
      });

      const labAppts = allAppointments.filter(a => a.department === "LAB");
      const consultAppt = allAppointments.find(a => a.department === "CONSULTATION");

      return {
        ...appointment,
        bookingReference: appointment.bookingReference,
        tokenNumber: labAppts.map(a => a.tokenNumber).join(", ") || appointment.tokenNumber,
        allAppointments,
        LabRequests: allLabRequests,
        tokens: {
          lab: labAppts.map(a => a.tokenNumber).join(", ") || appointment.tokenNumber,
          consultation: consultAppt?.tokenNumber || null
        }
      };
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
      if (report.reportUrl && S3Service.isS3Url(report.reportUrl)) {
        const presignedUrl = await S3Service.generateDownloadUrl(report.reportUrl);
        if (presignedUrl) report.reportUrl = presignedUrl;
      }
      return report;
    });
  }

  /**
   * Fetch daily outsource lab tests and expected reports with center filtering & profit calculations
   */
  async getOutsourceDailyReports(dateStr?: string, centerFilter?: string, searchStr?: string) {
    return withRetry(async () => {
      const targetDate = dateStr ? new Date(dateStr) : undefined;
      const { startOfDay, endOfDay } = getTimezoneBoundaries(targetDate);
      const cleanSearch = (searchStr || "").trim();

      // Base date condition (today / selected date)
      const dateCondition: any = {
        requestedAt: { gte: startOfDay, lte: endOfDay },
        items: {
          some: {
            LabTest: {
              isOutsideTest: true
            }
          }
        }
      };

      // Search condition across all dates by barcode / bookingReference / token / patient
      const searchCondition = cleanSearch ? {
        items: {
          some: {
            LabTest: {
              isOutsideTest: true
            }
          }
        },
        OR: [
          { Visit: { bookingReference: { contains: cleanSearch, mode: 'insensitive' as const } } },
          { Visit: { tokenNumber: { contains: cleanSearch, mode: 'insensitive' as const } } },
          { Patient: { fullName: { contains: cleanSearch, mode: 'insensitive' as const } } },
          { Patient: { phone: { contains: cleanSearch } } },
          { id: { contains: cleanSearch, mode: 'insensitive' as const } }
        ]
      } : null;

      const whereClause = searchCondition ? searchCondition : dateCondition;

      // Find all matching outsource lab requests
      const requests = await prisma.labRequest.findMany({
        where: whereClause,
        include: {
          Patient: true,
          Visit: {
            include: { User: true }
          },
          items: {
            include: {
              LabTest: true
            }
          }
        },
        orderBy: { requestedAt: "desc" }
      });

      let items: any[] = [];
      let totalExpected = 0;
      let reportsReceived = 0;
      let handedOver = 0;
      let totalProfit = 0;
      let totalCustomerRevenue = 0;
      let totalOutsourceCost = 0;
      let asiriCount = 0;
      let ruhunuCount = 0;

      for (const req of requests) {
        for (const it of req.items) {
          const lt = it.LabTest;
          if (!lt?.isOutsideTest) continue;

          const centerName = lt.outsourcedCenter || "Asiri Laboratories";

          // Center filter check
          if (centerFilter && centerFilter !== "ALL") {
            if (!centerName.toLowerCase().includes(centerFilter.toLowerCase())) {
              continue;
            }
          }

          // Count centers
          const cLower = centerName.toLowerCase();
          if (cLower.includes("asiri")) asiriCount++;
          else if (cLower.includes("ruhunu")) ruhunuCount++;

          // Pricing and profit calculations
          const actualCost = lt.outsourceCost !== null && lt.outsourceCost !== undefined
            ? lt.outsourceCost
            : (it.price || lt.price || 0) * 0.75; // fallback 75% cost if unset

          let hospitalMarkup = lt.hospitalCommission || 0;
          if (lt.commissionType === "PERCENTAGE" && hospitalMarkup > 0) {
            hospitalMarkup = (actualCost * hospitalMarkup) / 100;
          }

          const customerPrice = it.price || lt.price || (actualCost + hospitalMarkup);
          const profit = Math.max(0, customerPrice - actualCost);

          const currentStatus = req.outsourceStatus || (req.status === "COMPLETED" ? "REPORT_RECEIVED" : "SAMPLE_COLLECTED");

          totalExpected++;
          if (currentStatus === "REPORT_RECEIVED" || currentStatus === "HANDED_OVER") {
            reportsReceived++;
          }
          if (currentStatus === "HANDED_OVER") {
            handedOver++;
          }
          totalProfit += profit;
          totalCustomerRevenue += customerPrice;
          totalOutsourceCost += actualCost;

          items.push({
            id: it.id,
            requestId: req.id,
            tokenNumber: req.Visit?.tokenNumber || req.id.slice(0, 6).toUpperCase(),
            bookingReference: req.Visit?.bookingReference,
            requestedAt: req.requestedAt,
            patient: {
              id: req.Patient?.id,
              fullName: req.Patient?.fullName || "Patient",
              phone: req.Patient?.phone,
              age: req.Patient?.ageFallback,
              gender: req.Patient?.gender
            },
            doctorName: req.Visit?.User?.fullName || "OPD Doctor",
            testId: lt.id,
            testName: lt.name,
            testCode: lt.code,
            category: lt.category || "External Pathology",
            outsourcedCenter: centerName,
            outsourceCost: actualCost,
            commissionType: lt.commissionType || "FLAT",
            hospitalMarkup,
            customerPrice,
            profit,
            status: currentStatus,
            reportUrl: req.reportUrl,
            handedOverAt: req.handedOverAt,
            handedOverBy: req.handedOverBy
          });
        }
      }

      return {
        summary: {
          totalExpected,
          reportsReceived,
          handedOver,
          totalProfit,
          totalCustomerRevenue,
          totalOutsourceCost,
          asiriCount,
          ruhunuCount
        },
        items
      };
    });
  }

  /**
   * Update lifecycle status of an outsource lab test
   */
  async updateOutsourceStatus(
    requestId: string,
    outsourceStatus: "SAMPLE_COLLECTED" | "SENT_TO_LAB" | "REPORT_RECEIVED" | "HANDED_OVER",
    options?: {
      reportUrl?: string;
      handedOverBy?: string;
      withoutReport?: boolean;
    }
  ) {
    return withRetry(async () => {
      const updateData: any = {
        outsourceStatus
      };

      if (options?.reportUrl) {
        updateData.reportUrl = options.reportUrl;
      }

      if (outsourceStatus === "HANDED_OVER") {
        updateData.handedOverAt = new Date();
        updateData.handedOverBy = options?.handedOverBy || "Staff";
        updateData.status = "COMPLETED";
      } else if (outsourceStatus === "REPORT_RECEIVED") {
        // Can optionally mark status as SAVED or keep in progress
        updateData.status = "SAVED";
      }

      return prisma.labRequest.update({
        where: { id: requestId },
        data: updateData,
        include: {
          Patient: true,
          items: { include: { LabTest: true } }
        }
      });
    });
  }
}

export const labService = new LabService();
