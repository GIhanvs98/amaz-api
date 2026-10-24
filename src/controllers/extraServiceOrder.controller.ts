import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { billingService } from "../services/billing.service.js";
import { S3Service } from "../services/s3.service.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const extraServiceOrderController = {
  // Create single or batch extra service order(s)
  createOrders: async (req: Request, res: Response) => {
    try {
      const {
        orders,
        serviceId,
        patientId,
        doctorId,
        visitId,
        customPrice,
        notes,
        certificateType,
        certificateData
      } = req.body;

      const currentUserId = (req as any).user?.id;
      const assignedDoctorId = doctorId || currentUserId || null;

      // Normalize orders array: supports either batch array `{ orders: [...] }` or single order payload
      let itemsToCreate: any[] = [];
      if (Array.isArray(orders) && orders.length > 0) {
        itemsToCreate = orders;
      } else if (serviceId && patientId) {
        itemsToCreate = [{
          serviceId,
          patientId,
          doctorId: assignedDoctorId,
          visitId,
          customPrice,
          notes,
          certificateType,
          certificateData
        }];
      } else {
        return res.status(400).json({ error: "Missing required fields for extra service order" });
      }

      const createdOrders: any[] = [];

      for (const item of itemsToCreate) {
        const targetPatientId = item.patientId || patientId;
        const targetServiceId = item.serviceId;
        const targetVisitId = item.visitId || visitId || null;
        const targetDoctorId = item.doctorId || assignedDoctorId;

        let service = null;
        if (targetServiceId && !targetServiceId.startsWith("cert-")) {
          service = await prisma.extraService.findUnique({
            where: { id: targetServiceId }
          }).catch(() => null);
        }

        // If not found by ID (e.g. virtual certificate or custom procedure title), resolve or create fallback ExtraService
        if (!service) {
          const serviceTitle = item.certificateType 
            ? `Medical Certificate (${item.certificateType})`
            : (item.title || item.notes || "Clinical Extra Service");
            
          service = await prisma.extraService.findFirst({
            where: { title: { equals: serviceTitle, mode: "insensitive" } }
          });

          if (!service) {
            const defaultBarcode = `${Date.now()}`.slice(-10);
            service = await prisma.extraService.create({
              data: {
                title: serviceTitle,
                description: item.notes || "Standard clinical extra service / certificate",
                price: (item.customPrice !== undefined && item.customPrice !== null) ? Number(item.customPrice) : 650,
                barcode: defaultBarcode
              }
            }).catch(async () => {
              return await prisma.extraService.findFirst({ where: { isActive: true } });
            });
          }
        }

        if (!service) {
          continue;
        }

        const effectivePrice = (item.customPrice !== undefined && item.customPrice !== null && !isNaN(Number(item.customPrice)))
          ? Number(item.customPrice)
          : service.price;

        const orderNumber = `EXS-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

        const isCertificate = Boolean(item.certificateType || item.certificateData);
        const resolvedStatus = item.status 
          ? String(item.status).toUpperCase() 
          : (isCertificate ? "COMPLETED" : "PENDING");
        const isCompleted = resolvedStatus === "COMPLETED";

        let createdOrder: any = null;

        // Idempotency: If this is a medical certificate for the patient today, check for existing active order
        if (isCertificate && targetPatientId) {
          const { startOfDay, endOfDay } = getTimezoneBoundaries();
          const existingCertOrder = await prisma.extraServiceOrder.findFirst({
            where: {
              patientId: targetPatientId,
              status: { not: "CANCELLED" },
              OR: [
                ...(item.id ? [{ id: item.id }] : []),
                {
                  certificateType: item.certificateType || undefined,
                  createdAt: { gte: startOfDay, lte: endOfDay }
                }
              ]
            },
            include: {
              service: true,
              patient: {
                select: {
                  id: true,
                  patientId: true,
                  fullName: true,
                  phone: true,
                  gender: true,
                  ageFallback: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  fullName: true,
                  specialty: true
                }
              }
            }
          });

          if (existingCertOrder) {
            createdOrder = await prisma.extraServiceOrder.update({
              where: { id: existingCertOrder.id },
              data: {
                customPrice: (item.customPrice !== undefined && item.customPrice !== null) ? Number(item.customPrice) : existingCertOrder.customPrice,
                finalPrice: effectivePrice,
                certificateData: item.certificateData || existingCertOrder.certificateData,
                notes: item.notes || existingCertOrder.notes,
                doctorId: targetDoctorId || existingCertOrder.doctorId,
                visitId: targetVisitId || existingCertOrder.visitId,
                completedAt: isCompleted ? (existingCertOrder.completedAt || new Date()) : existingCertOrder.completedAt
              },
              include: {
                service: true,
                patient: {
                  select: {
                    id: true,
                    patientId: true,
                    fullName: true,
                    phone: true,
                    gender: true,
                    ageFallback: true
                  }
                },
                doctor: {
                  select: {
                    id: true,
                    fullName: true,
                    specialty: true
                  }
                }
              }
            });
          }
        }

        if (!createdOrder) {
          createdOrder = await prisma.extraServiceOrder.create({
            data: {
              orderNumber,
              serviceId: service.id,
              patientId: targetPatientId,
              doctorId: targetDoctorId,
              visitId: targetVisitId,
              customPrice: (item.customPrice !== undefined && item.customPrice !== null) ? Number(item.customPrice) : null,
              finalPrice: effectivePrice,
              status: resolvedStatus,
              completedAt: isCompleted ? new Date() : null,
              notes: item.notes || null,
              certificateType: item.certificateType || null,
              certificateData: item.certificateData || null,
              reportFiles: []
            },
            include: {
              service: true,
              patient: {
                select: {
                  id: true,
                  patientId: true,
                  fullName: true,
                  phone: true,
                  gender: true,
                  ageFallback: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  fullName: true,
                  specialty: true
                }
              }
            }
          });
        }

        // If visitId is available, immediately add or update billing charge in patient's draft invoice
        if (targetVisitId) {
          try {
            const certSuffix = item.certificateType && !service.title.includes(`(${item.certificateType})`)
              ? ` (${item.certificateType})`
              : "";
            await billingService.addCharge({
              visitId: targetVisitId,
              patientId: targetPatientId,
              department: "EXTRA_SERVICE",
              description: `${service.title}${certSuffix}`,
              quantity: 1,
              unitPrice: effectivePrice,
              referenceId: createdOrder.id
            });
          } catch (billErr) {
            console.warn("Failed to auto-add extra service charge to invoice:", billErr);
          }
        }

        createdOrders.push(createdOrder);
      }

      return res.status(201).json({
        success: true,
        orders: createdOrders,
        count: createdOrders.length
      });
    } catch (e: any) {
      console.error("Error creating extra service order:", e);
      return res.status(500).json({ error: e.message || "Failed to create extra service order" });
    }
  },

  // Get orders list with filters and search
  getOrders: async (req: Request, res: Response) => {
    try {
      const { status, patientId, search, startDate, endDate, page = "1", limit = "50" } = req.query;

      const where: any = {};

      if (status && status !== "ALL") {
        where.status = String(status).toUpperCase();
      }

      if (patientId) {
        where.patientId = String(patientId);
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(String(startDate));
        }
        if (endDate) {
          const end = new Date(String(endDate));
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      if (search) {
        const query = String(search).trim();
        where.OR = [
          { orderNumber: { contains: query, mode: "insensitive" } },
          { service: { title: { contains: query, mode: "insensitive" } } },
          { patient: { fullName: { contains: query, mode: "insensitive" } } },
          { patient: { phone: { contains: query } } },
          { patient: { patientId: { contains: query, mode: "insensitive" } } }
        ];
      }

      const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
      const skip = (Math.max(parseInt(String(page), 10) || 1, 1) - 1) * take;

      const [total, orders] = await Promise.all([
        prisma.extraServiceOrder.count({ where }),
        prisma.extraServiceOrder.findMany({
          where,
          include: {
            service: {
              include: {
                room: {
                  select: { id: true, roomNumber: true, department: true }
                }
              }
            },
            patient: {
              select: {
                id: true,
                patientId: true,
                fullName: true,
                phone: true,
                gender: true,
                dateOfBirth: true,
                ageFallback: true
              }
            },
            doctor: {
              select: {
                id: true,
                fullName: true,
                specialty: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take,
          skip
        })
      ]);

      return res.json({
        orders,
        pagination: {
          total,
          page: parseInt(String(page), 10) || 1,
          limit: take,
          totalPages: Math.ceil(total / take)
        }
      });
    } catch (e: any) {
      console.error("Error fetching extra service orders:", e);
      return res.status(500).json({ error: e.message || "Failed to fetch orders" });
    }
  },

  // Get order by ID
  getOrderById: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const order = await prisma.extraServiceOrder.findUnique({
        where: { id },
        include: {
          service: {
            include: {
              room: true
            }
          },
          patient: true,
          doctor: {
            select: {
              id: true,
              fullName: true,
              specialty: true,
              title: true
            }
          }
        }
      });

      if (!order) {
        return res.status(404).json({ error: "Extra service order not found" });
      }

      return res.json(order);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  },

  // Update order status
  updateOrderStatus: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { status, notes } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const normalizedStatus = String(status).toUpperCase();
      const isCompleted = normalizedStatus === "COMPLETED";

      const updated = await prisma.extraServiceOrder.update({
        where: { id },
        data: {
          status: normalizedStatus,
          ...(notes !== undefined ? { notes } : {}),
          ...(isCompleted ? { completedAt: new Date() } : {})
        },
        include: {
          service: true,
          patient: true,
          doctor: true
        }
      });

      return res.json(updated);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  },

  // Upload report file (supports ANY file type: PDF, JPEG, PNG, DOCX, DICOM, etc.)
  uploadReportFile: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const file = req.file;

      if (!file || !file.buffer) {
        return res.status(400).json({ error: "File is required" });
      }

      const order = await prisma.extraServiceOrder.findUnique({
        where: { id }
      });

      if (!order) {
        return res.status(404).json({ error: "Extra service order not found" });
      }

      const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileExt = path.extname(safeOriginalName).toLowerCase();
      const uniqueFilename = `${order.orderNumber}-${Date.now()}-${safeOriginalName}`;
      let finalFileUrl = "";

      // Try uploading to S3 if configured; fallback to local disk
      try {
        const s3Key = `extra-service-reports/${uniqueFilename}`;
        finalFileUrl = await S3Service.uploadBuffer(
          file.buffer,
          s3Key,
          file.mimetype || "application/octet-stream"
        );
      } catch (s3Err) {
        console.warn("S3 upload failed or not configured, falling back to local file storage:", s3Err);
        const uploadsDir = path.join(process.cwd(), "public", "uploads", "extra-services");
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filePath = path.join(uploadsDir, uniqueFilename);
        fs.writeFileSync(filePath, file.buffer);
        finalFileUrl = `/uploads/extra-services/${uniqueFilename}`;
      }

      const newReportFile = {
        id: crypto.randomUUID(),
        fileName: file.originalname,
        fileUrl: finalFileUrl,
        fileType: file.mimetype || fileExt || "application/octet-stream",
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: (req as any).user?.fullName || "Staff"
      };

      const existingFiles = Array.isArray(order.reportFiles) ? (order.reportFiles as any[]) : [];
      const updatedFiles = [...existingFiles, newReportFile];

      // Report upload automatically completes the procedure/order
      const newStatus = "COMPLETED";

      const updated = await prisma.extraServiceOrder.update({
        where: { id },
        data: {
          reportFiles: updatedFiles,
          status: newStatus,
          completedAt: order.completedAt || new Date()
        },
        include: {
          service: true,
          patient: true,
          doctor: true
        }
      });

      return res.status(201).json({
        success: true,
        file: newReportFile,
        order: updated
      });
    } catch (e: any) {
      console.error("Error uploading report file:", e);
      return res.status(500).json({ error: e.message || "Failed to upload file" });
    }
  },

  // Delete an uploaded report file
  deleteReportFile: async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const fileId = req.params.fileId as string;

      const order = await prisma.extraServiceOrder.findUnique({
        where: { id }
      });

      if (!order) {
        return res.status(404).json({ error: "Extra service order not found" });
      }

      const existingFiles = Array.isArray(order.reportFiles) ? (order.reportFiles as any[]) : [];
      const targetFile = existingFiles.find((f: any) => f.id === fileId);

      if (!targetFile) {
        return res.status(404).json({ error: "File not found" });
      }

      // If local file, attempt to delete from disk
      if (targetFile.fileUrl && targetFile.fileUrl.startsWith("/uploads/")) {
        const localRelPath = targetFile.fileUrl.replace(/^\//, "");
        const localAbsPath = path.join(process.cwd(), "public", localRelPath);
        if (fs.existsSync(localAbsPath)) {
          try {
            fs.unlinkSync(localAbsPath);
          } catch (err) {
            console.warn("Could not delete local file:", err);
          }
        }
      }

      const updatedFiles = existingFiles.filter((f: any) => f.id !== fileId);

      const updated = await prisma.extraServiceOrder.update({
        where: { id },
        data: {
          reportFiles: updatedFiles
        },
        include: {
          service: true,
          patient: true,
          doctor: true
        }
      });

      return res.json({
        success: true,
        order: updated
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || "Failed to delete file" });
    }
  }
};
