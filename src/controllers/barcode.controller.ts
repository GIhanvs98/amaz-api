import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { calcDispenseQty } from "./prescription.controller.js";

export const barcodeController = {
  resolveBarcode: async (req: Request, res: Response) => {
    try {
      const rawCode = req.params.code as string;
      if (!rawCode) return res.status(400).json({ error: "Barcode is required" });
      const code = rawCode.trim();

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const isNumeric10 = /^\d{10}$/.test(code);
      const isShortToken = /^\d{1,3}$/.test(code);
      const isAlphanumericToken = /^[A-Za-z]{1,4}-\d{1,4}$/i.test(code);
      const isPatientId = code.startsWith("PT-") || code.startsWith("pt-");
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);

      // =========================================================================
      // 1. FAST PATH: Check Appointment / Master Visit Barcode
      // 10-digit barcodes, 1-3 digit tokens, and patient IDs are visits 99% of the time.
      // =========================================================================
      if (isNumeric10 || isShortToken || isAlphanumericToken || isPatientId || isUUID || code.length >= 8) {
        const appointmentOrConditions: any[] = [
          { bookingReference: code },
          { id: code }
        ];

        if (isShortToken) {
          appointmentOrConditions.push({
            tokenNumber: code.padStart(2, "0"),
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            status: { not: "CANCELLED" }
          });
        }

        if (isAlphanumericToken) {
          appointmentOrConditions.push({
            tokenNumber: { equals: code, mode: "insensitive" },
            status: { not: "CANCELLED" }
          });
        }

        if (isPatientId) {
          appointmentOrConditions.push({
            Patient: { patientId: { equals: code, mode: "insensitive" } },
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            status: { not: "CANCELLED" }
          });
        }

        if (code.length >= 8 && !isNumeric10 && !isUUID) {
          appointmentOrConditions.push({ id: { startsWith: code } });
        }

        let appointment: any = null;
        let allAppointments: any[] = [];

        // Single-pass optimization: If 10-digit visit barcode, fetch all siblings in 1 query
        if (isNumeric10) {
          allAppointments = await prisma.appointment.findMany({
            where: { bookingReference: code, status: { not: "CANCELLED" } },
            include: { Patient: true, room: true, User: { include: { room: true } } },
            orderBy: { createdAt: "asc" }
          });
          if (allAppointments.length > 0) {
            appointment = allAppointments.find(a => a.department === "CONSULTATION") || allAppointments[0];
          }
        }

        if (!appointment) {
          appointment = await prisma.appointment.findFirst({
            where: { OR: appointmentOrConditions },
            include: { Patient: true, room: true, User: { include: { room: true } } },
            orderBy: { createdAt: "desc" }
          });
        }

        // Fallback: Check if code is an Invoice ID referencing a visit
        if (!appointment && (isUUID || code.length >= 8)) {
          const invoice = await prisma.invoice.findFirst({
            where: {
              OR: [
                { id: code },
                ...(code.length >= 8 && !isUUID ? [{ id: { startsWith: code } }] : [])
              ]
            },
            select: { visitId: true }
          });

          if (invoice?.visitId) {
            appointment = await prisma.appointment.findUnique({
              where: { id: invoice.visitId },
              include: { Patient: true, User: { include: { room: true } } }
            });
          }
        }

        // Fallback: If 10-digit Unix timestamp from printed receipt
        if (!appointment && isNumeric10) {
          const ts = Number(code);
          if (ts >= 1700000000 && ts <= 1950000000) {
            const date = new Date(ts * 1000);
            const timeWindowStart = new Date(date.getTime() - 120000);
            const timeWindowEnd = new Date(date.getTime() + 120000);

            const invoiceByTime = await prisma.invoice.findFirst({
              where: { createdAt: { gte: timeWindowStart, lte: timeWindowEnd } },
              select: { visitId: true },
              orderBy: { createdAt: "desc" }
            });

            if (invoiceByTime?.visitId) {
              appointment = await prisma.appointment.findUnique({
                where: { id: invoiceByTime.visitId },
                include: { Patient: true, User: { include: { room: true } } }
              });
            }
          }
        }

        if (appointment) {
          // If allAppointments wasn't already populated by the 1-pass query, fetch siblings
          if (allAppointments.length === 0) {
            if (appointment.bookingReference) {
              allAppointments = await prisma.appointment.findMany({
                where: {
                  bookingReference: appointment.bookingReference,
                  status: { not: "CANCELLED" }
                },
                include: { Patient: true, room: true, User: { include: { room: true } } },
                orderBy: { createdAt: "asc" }
              });
            } else {
              const apptDate = new Date(appointment.appointmentDate);
              const apptStart = new Date(apptDate);
              apptStart.setHours(0, 0, 0, 0);
              const apptEnd = new Date(apptDate);
              apptEnd.setHours(23, 59, 59, 999);

              allAppointments = await prisma.appointment.findMany({
                where: {
                  patientId: appointment.patientId,
                  appointmentDate: { gte: apptStart, lte: apptEnd },
                  status: { not: "CANCELLED" }
                },
                include: { Patient: true, room: true, User: { include: { room: true } } },
                orderBy: { createdAt: "asc" }
              });
            }

            if (allAppointments.length === 0) {
              allAppointments = [appointment];
            }
          }

          const allApptIds = allAppointments.map(a => a.id);
          const allVisitIdentifiers = Array.from(
            new Set([
              ...allApptIds,
              ...allAppointments.map((a: any) => a.bookingReference).filter(Boolean),
              appointment.bookingReference,
              code
            ])
          ).filter(Boolean) as string[];

          // PARALLEL EXECUTION: Fetch Invoices, Prescriptions, LabRequests, ExtraServiceOrders, and Paid Status concurrently
          const [invoices, prescriptions, labRequests, extraServiceOrders, paidInvoice] = await Promise.all([
            prisma.invoice.findMany({
              where: {
                visitId: { in: allVisitIdentifiers },
                status: "DRAFT"
              },
              include: { lineItems: true }
            }),
            prisma.prescription.findMany({
              where: {
                OR: [
                  { visitId: { in: allVisitIdentifiers } },
                  {
                    patientId: appointment.patientId,
                    createdAt: { gte: startOfDay, lte: endOfDay }
                  }
                ]
              },
              include: {
                items: {
                  include: {
                    medicine: {
                      select: {
                        id: true,
                        name: true,
                        barcode: true,
                        retailPrice: true,
                        unit: true,
                        stockBatches: {
                          select: { unitPrice: true, currentQuantity: true },
                          take: 1
                        }
                      }
                    }
                  }
                }
              },
              orderBy: { createdAt: "desc" }
            }),
            prisma.labRequest.findMany({
              where: {
                OR: [
                  { visitId: { in: allVisitIdentifiers } },
                  {
                    patientId: appointment.patientId,
                    requestedAt: { gte: startOfDay, lte: endOfDay }
                  }
                ]
              },
              include: {
                items: {
                  include: {
                    LabTest: {
                      select: { id: true, name: true, code: true, price: true, category: true, roomId: true, room: { select: { roomNumber: true } } }
                    }
                  }
                },
                results: true
              },
              orderBy: { requestedAt: "desc" }
            }),
            prisma.extraServiceOrder.findMany({
              where: {
                OR: [
                  { visitId: { in: allVisitIdentifiers } },
                  {
                    patientId: appointment.patientId,
                    createdAt: { gte: startOfDay, lte: endOfDay }
                  }
                ]
              },
              include: {
                service: { include: { room: true } }
              },
              orderBy: { createdAt: "desc" }
            }),
            prisma.invoice.findFirst({
              where: {
                visitId: { in: allVisitIdentifiers },
                status: "PAID",
                lineItems: { some: { department: "CONSULTATION" } }
              }
            })
          ]);

          // In-memory non-destructive draft invoice coalescing (zero DB row locks / deletions on GET)
          let mergedInvoice: any = null;
          let rawLineItems = invoices.flatMap(inv => inv.lineItems || []);

          // Deduplicate already existing invoice line items by referenceId or id
          const uniqueLineItemMap = new Map<string, any>();
          for (const li of rawLineItems) {
            const key = li.referenceId ? `ref-${li.referenceId}` : (li.id ? `id-${li.id}` : `desc-${li.description}`);
            if (!uniqueLineItemMap.has(key)) {
              uniqueLineItemMap.set(key, li);
            }
          }
          let allLineItems = Array.from(uniqueLineItemMap.values());

          // Ensure any extraServiceOrders not yet in invoice line items are represented
          for (const order of extraServiceOrders) {
            const isCert = Boolean(order.certificateType || order.service?.title?.toLowerCase().includes("certificate"));
            const alreadyInInvoice = allLineItems.some(
              (li: any) =>
                li.referenceId === order.id ||
                (order.orderNumber && li.description?.includes(order.orderNumber)) ||
                (isCert && li.department === "EXTRA_SERVICE" && li.description?.toLowerCase().includes("certificate"))
            );
            if (!alreadyInInvoice && order.status !== "CANCELLED") {
              const orderPrice = order.finalPrice ?? order.service?.price ?? 0;
              const certSuffix = order.certificateType && !order.service?.title?.includes(`(${order.certificateType})`)
                ? ` (${order.certificateType})`
                : '';
              const synthItem: any = {
                id: `synth-${order.id}`,
                invoiceId: invoices[0]?.id || `draft-${appointment.bookingReference || appointment.id}`,
                department: "EXTRA_SERVICE",
                description: `${order.service?.title || 'Service'}${certSuffix}`,
                quantity: 1,
                unitPrice: orderPrice,
                total: orderPrice,
                referenceId: order.id,
                createdAt: order.createdAt || new Date()
              };
              allLineItems.push(synthItem);
            }
          }

          if (allLineItems.length > 0) {
            const calculatedTotal = allLineItems.reduce((sum: number, li: any) => sum + (li.total || 0), 0);
            const baseInvoice = invoices[0] || {
              id: `draft-${appointment.bookingReference || appointment.id}`,
              visitId: appointment.bookingReference || appointment.id,
              patientId: appointment.patientId,
              status: "DRAFT"
            };
            mergedInvoice = {
              ...baseInvoice,
              lineItems: allLineItems,
              subtotal: calculatedTotal,
              totalAmount: calculatedTotal
            };
          }

          const consultationPaid = !!paidInvoice;

          const extraServiceItems = (mergedInvoice?.lineItems || []).filter(
            (li: any) => li.department === "EXTRA_SERVICE" || li.department === "SERVICE" || li.department === "OTHER"
          );

          const consultAppt = allAppointments.find(a => a.department === "CONSULTATION") || appointment;
          const labAppts = allAppointments.filter(a => a.department === "LAB");
          const extraServiceAppts = allAppointments.filter(a => a.department === "EXTRA_SERVICE");

          const labTokensSummary = labAppts.map(a => ({
            tokenNumber: a.tokenNumber,
            roomId: a.roomId,
            roomNumber: a.room?.roomNumber || "LAB"
          }));

          const extraServiceTokensSummary = [
            ...extraServiceAppts.map(a => ({
              tokenNumber: a.tokenNumber,
              roomId: a.roomId,
              roomNumber: a.room?.roomNumber || "PROCEDURE"
            })),
            ...extraServiceOrders.filter(o => !extraServiceAppts.some(a => a.id === o.visitId)).map(o => ({
              tokenNumber: o.orderNumber,
              roomId: o.service?.roomId || null,
              roomNumber: o.service?.room?.roomNumber || "PROCEDURE"
            }))
          ];

          const masterBarcode = appointment.bookingReference || appointment.tokenNumber;

          return res.json({
            type: "APPOINTMENT",
            masterBarcode,
            data: {
              masterBarcode,
              patient: appointment.Patient,
              tokens: {
                consultation: consultAppt?.tokenNumber || null,
                lab: labAppts.map(a => a.tokenNumber).join(", ") || null,
                extraService: [
                  ...extraServiceAppts.map(a => a.tokenNumber),
                  ...extraServiceOrders.map(o => o.orderNumber)
                ].filter(Boolean).join(", ") || null,
                labList: labTokensSummary,
                extraServiceList: extraServiceTokensSummary
              },
              rooms: {
                consultation: consultAppt?.room?.roomNumber || consultAppt?.User?.room?.roomNumber || "01",
                lab: labAppts.map(a => a.room?.roomNumber).filter(Boolean).join(", ") || "LAB",
                extraService: extraServiceAppts.map(a => a.room?.roomNumber).filter(Boolean).join(", ") || "PROCEDURE"
              },
              appointment: consultAppt,
              allAppointments,
              invoice: mergedInvoice,
              prescriptions: prescriptions.map((p: any) => ({
                ...p,
                items: (p.items || []).map((i: any) => ({
                  ...i,
                  dispenseQty: calcDispenseQty(i)
                }))
              })),
              labRequests,
              extraServices: extraServiceItems,
              extraServiceOrders,
              consultationPaid
            }
          });
        }
      }

      // =========================================================================
      // 2. Check Prescription by ID (UUID or exact prefix)
      // =========================================================================
      if (isUUID || code.length === 36 || code.length === 10 || code.length === 8) {
        const prescription = isUUID || code.length === 36
          ? await prisma.prescription.findUnique({
              where: { id: code },
              include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
            })
          : await prisma.prescription.findFirst({
              where: { id: { startsWith: code } },
              include: { items: { include: { medicine: { include: { stockBatches: true } } } } }
            });

        if (prescription) {
          const doctor = await prisma.user.findUnique({
            where: { id: prescription.doctorId },
            select: { id: true, feeType: true, consultationFee: true, fullName: true }
          });

          let consultationPaid = false;
          if (prescription.visitId) {
            const paidInvoice = await prisma.invoice.findFirst({
              where: {
                visitId: prescription.visitId,
                status: "PAID",
                lineItems: { some: { department: "CONSULTATION" } }
              }
            });
            if (paidInvoice) consultationPaid = true;
          }

          return res.json({ 
            type: "PRESCRIPTION", 
            data: { 
              ...prescription, 
              items: (prescription.items || []).map((i: any) => ({
                ...i,
                dispenseQty: calcDispenseQty(i)
              })),
              doctor, 
              consultationPaid 
            } 
          });
        }
      }

      // =========================================================================
      // 3. Check Medicine by indexed barcode (or exact name fallback)
      // =========================================================================
      const medicine = await prisma.medicine.findFirst({
        where: {
          OR: [
            { barcode: code },
            { name: code }
          ]
        },
        include: { stockBatches: true }
      });
      if (medicine) {
        return res.json({ type: "MEDICINE", data: medicine });
      }

      // =========================================================================
      // 4. Check Extra Service by barcode (or exact title)
      // =========================================================================
      const extraService = await prisma.extraService.findFirst({
        where: {
          OR: [
            { barcode: code },
            { title: code }
          ]
        }
      });
      if (extraService) {
        return res.json({ type: "EXTRA_SERVICE", data: extraService });
      }

      // =========================================================================
      // 4b. Check Extra Service Order (by orderNumber, id, or visitId)
      // =========================================================================
      const isExtraOrderCode = code.startsWith("EXS-") || code.startsWith("exs-") || isUUID || code.length >= 8;
      if (isExtraOrderCode) {
        const extraOrder = await prisma.extraServiceOrder.findFirst({
          where: {
            OR: [
              { orderNumber: { equals: code, mode: "insensitive" } },
              { id: code },
              ...(code.length >= 8 && !isUUID ? [{ id: { startsWith: code } }] : [])
            ]
          },
          include: {
            service: { include: { room: true } },
            patient: true,
            doctor: true
          }
        });

        if (extraOrder) {
          return res.json({
            type: "EXTRA_SERVICE_ORDER",
            masterBarcode: extraOrder.visitId || extraOrder.orderNumber,
            data: extraOrder
          });
        }
      }

      // =========================================================================
      // 5. Check Lab Request (by UUID or prefix)
      // =========================================================================
      if (isUUID || code.length >= 8) {
        const labRequest = isUUID
          ? await prisma.labRequest.findUnique({
              where: { id: code },
              include: {
                Patient: true,
                items: { include: { LabTest: { include: { biomarkers: true } } } },
                results: true
              }
            })
          : await prisma.labRequest.findFirst({
              where: {
                OR: [
                  { id: code },
                  { id: { startsWith: code.toLowerCase() } }
                ]
              },
              include: {
                Patient: true,
                items: { include: { LabTest: { include: { biomarkers: true } } } },
                results: true
              }
            });

        if (labRequest) {
          return res.json({ type: "LAB_REQUEST", data: labRequest });
        }
      }

      return res.status(404).json({ error: "Barcode not recognized in any hospital subsystem." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
};
