import { PrismaClient } from '@prisma/client';
import { billingService } from './billing.service.js';
import { prisma as sharedPrisma } from '../lib/prisma.js';

// Use shared singleton to avoid multiple connection pools
const prisma = sharedPrisma;

export class LabService {
  /**
   * Fetch the catalog of available lab tests
   */
  async getCatalog() {
    return prisma.labTest.findMany({
      where: { isActive: true },
      orderBy: { category: 'asc' }
    });
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
    return prisma.labTest.create({ data });
  }

  /**
   * Resolve patientId from phone/name, creating patient if needed
   */
  async resolvePatient(phone: string, name: string): Promise<string> {
    const patient = await prisma.patient.upsert({
      where: { phone },
      update: {},
      create: { phone, fullName: name }
    });
    return patient.id;
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
  }

  /**
   * Get pending lab requests for the technicians
   */
  async getPendingRequests() {
    return prisma.labRequest.findMany({
      where: { status: "PENDING" },
      include: {
        items: {
          include: { LabTest: true }
        },
        Patient: true,
        Visit: {
          include: { User: true }
        }
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
      const request = await tx.labRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", reportUrl: reportUrl || null }
      });

      // 2. Insert all results
      const createdResults = await Promise.all(
        results.map(res => tx.labResult.create({
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
    return prisma.labRequest.findMany({
      where: { status: "COMPLETED" },
      include: {
        items: {
          include: { LabTest: true }
        },
        results: true,
        Patient: true
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
        Patient: true
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
        doctor: req.doctorId || "Unknown",
        tests: req.items.map(i => i.LabTest?.name),
        priority: req.priority,
        requestedAt: req.requestedAt
      }))
    };
  }

  /**
   * Get waiting lab queue tokens
   */
  async getQueueTokens() {
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
  }
}

export const labService = new LabService();
