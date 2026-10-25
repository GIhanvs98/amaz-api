import { Request, Response } from "express";
import { NotificationService } from "../services/notification.service.js";
import { prisma } from "../lib/prisma.js";
import { randomUUID } from "crypto";
import { BookingService } from "../services/booking.service.js";
import { websocketService } from "../services/websocket.service.js";
import { SMSService } from "../services/sms.service.js";
import { generateMRN } from "../utils/mrn.util.js";
import { generateIdentityKey } from "../utils/identity.util.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";
import { sortDoctorsWithOpdFirst } from "../utils/doctor-utils.js";

export const openShift = async (req: Request, res: Response) => {
  try {
    const { startingFloat } = req.body;
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Close any existing open shifts for this user
    await prisma.cashRegisterShift.updateMany({
      where: { openedBy: user.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() }
    });

    const shift = await prisma.cashRegisterShift.create({
      data: {
        openedBy: user.id,
        openingFloat: Number(startingFloat) || 0,
        status: "OPEN"
      }
    });

    res.json({ success: true, data: shift });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};


async function getOpenShiftId(userId: string, tx?: any): Promise<string | undefined> {
  const p = tx || prisma;
  const shift = await p.cashRegisterShift.findFirst({
    where: { openedBy: userId, status: "OPEN" }
  });
  return shift?.id;
}

export const getCurrentShift = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Fetch user with Role to determine if this is a clinical Nurse
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { Role: true }
    });

    const roleName = dbUser?.Role?.name?.toLowerCase() || "";

    if (roleName === "nurse") {
      // Nurse shifts are strictly linked to daily biometric/attendance clock-in, not cash registers
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const attendance = await prisma.staffAttendance.findUnique({
        where: {
          userId_date: {
            userId: user.id,
            date: today
          }
        }
      });

      const isClockedIn = !!(attendance?.checkIn && !attendance?.checkOut);

      if (isClockedIn) {
        return res.json({
          success: true,
          data: {
            id: attendance!.id,
            isOpen: true,
            isAttendanceShift: true,
            startedAt: attendance!.checkIn,
            startingFloat: 0,
            cashierName: dbUser?.fullName || "Nurse",
            attendanceStatus: attendance!.status || "PRESENT"
          }
        });
      } else {
        return res.json({
          success: true,
          data: {
            id: null,
            isOpen: false,
            isAttendanceShift: true,
            startedAt: null,
            startingFloat: 0,
            cashierName: dbUser?.fullName || "Nurse",
            clockedOutAt: attendance?.checkOut || null
          }
        });
      }
    }

    // Standard cash register shift for cashier/receptionist
    const shift = await prisma.cashRegisterShift.findFirst({
      where: { openedBy: user.id, status: "OPEN" },
      include: {
        user: { select: { fullName: true } }
      }
    });

    if (!shift) {
      return res.json({ success: true, data: null });
    }

    res.json({ 
      success: true, 
      data: {
        id: shift.id,
        isOpen: true,
        isAttendanceShift: false,
        startedAt: shift.openedAt,
        startingFloat: shift.openingFloat,
        cashierName: shift.user?.fullName || "Unknown",
      } 
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPatients = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      const recentPatients = await prisma.patient.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' }
      });
      return res.json({ success: true, data: recentPatients });
    }
    
    const searchTerm = (q as string).trim();
    const patients = await prisma.patient.findMany({
      where: {
        isActive: true,
        OR: [
          { phone: { contains: searchTerm } },
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
          { patientId: { contains: searchTerm, mode: 'insensitive' } },
          { nic: { contains: searchTerm, mode: 'insensitive' } }
        ]
      },
      take: 20,
      orderBy: { createdAt: 'desc' }
    });
    
    res.json({ success: true, data: patients });
  } catch (error: any) {
    console.error("Error fetching patients:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getMetrics = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Registered Today
    const registeredToday = await prisma.patient.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } }
    });

    // 2. Current Queue Size (All appointments today)
    const currentQueueSize = await prisma.appointment.count({
      where: { appointmentDate: { gte: startOfDay, lte: endOfDay } }
    });

    // 3. Available Doctors (Marked as ARRIVED today)
    const availableDoctors = await prisma.doctorAttendance.count({
      where: { date: { gte: startOfDay, lte: endOfDay }, status: "ARRIVED" }
    });

    // 4. Pending Appointments
    const pendingAppointments = await prisma.appointment.count({
      where: { appointmentDate: { gte: startOfDay, lte: endOfDay }, status: "BOOKED" }
    });

    // 5. Next in queue (Top 5 Booked or In Progress)
    const upcomingTokens = await prisma.appointment.findMany({
      where: { 
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "IN_PROGRESS"] }
      },
      include: { Patient: true, User: true },
      orderBy: { tokenNumber: 'asc' },
      take: 5
    });

    const nextInQueue = upcomingTokens.map(apt => {
      let mappedStatus = apt.status;
      if (mappedStatus === "BOOKED") mappedStatus = "WAITING";
      if (mappedStatus === "IN_PROGRESS") mappedStatus = "IN_CONSULTATION";

      return {
        queueNo: apt.tokenNumber,
        patientName: apt.Patient?.fullName || "Unknown",
        doctor: apt.User?.fullName || "Unassigned",
        status: mappedStatus
      };
    });

    res.json({
      success: true,
      data: {
        registeredToday,
        currentQueueSize,
        availableDoctors,
        pendingAppointments,
        nextInQueue
      }
    });
  } catch (error: any) {
    console.error("Error fetching metrics:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getActiveDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await prisma.user.findMany({
      where: {
        Role: { name: { equals: 'Doctor', mode: 'insensitive' } },
        departmentId: { not: null }, // Only doctors actively assigned to a department
        isActive: true
      },
      select: {
        id: true,
        fullName: true,
        specialty: true,
        consultationFee: true,
        feeType: true,
        Department: {
          select: { name: true }
        }
      }
    });

    res.json({ success: true, data: sortDoctorsWithOpdFirst(doctors) });
  } catch (error: any) {
    console.error("Error fetching active doctors:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPatientById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const patient = await prisma.patient.findUnique({
      where: { id: id as string },
      include: {
        Appointment: {
          where: { status: { in: ['BOOKED', 'WAITING', 'CHECKED_IN', 'IN_PROGRESS', 'ARRIVED'] } },
          orderBy: { createdAt: "desc" },
          take: 1
        },
        Prescription: {
          include: { items: true },
          orderBy: { createdAt: "desc" }
        },
        LabRequests: {
          include: { items: { include: { LabTest: true } } },
          orderBy: { requestedAt: "desc" }
        }
      }
    });
    
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }
    
    // Extract actual history from DB
    const medicalHistory = patient.Prescription.map(p => ({
      id: p.id,
      date: p.createdAt,
      diagnosis: p.diagnosis || "Consultation",
      medications: p.items.map(i => i.drugName)
    }));

    const labResults = patient.LabRequests.map(l => ({
      id: l.id,
      date: l.requestedAt,
      status: l.status,
      tests: l.items.map(i => i.LabTest.name)
    }));
    
    // Map to the frontend expected format
    res.json({
      id: patient.id,
      name: patient.fullName,
      age: patient.ageFallback || 30,
      gender: patient.gender || "UNKNOWN",
      contact: patient.phone,
      bloodGroup: patient.bloodGroup || "O+",
      allergies: [], // Still mocked as no allergy model exists yet
      chronicConditions: [], // Still mocked as no chronic condition model exists yet
      medicalHistory: medicalHistory,
      labResults: labResults,
      activeVisitId: patient.Appointment[0]?.id || null,
      activeTokenNumber: patient.Appointment[0]?.tokenNumber ? (patient.Appointment[0]!.tokenNumber.includes('-') ? parseInt(patient.Appointment[0]!.tokenNumber.split('-')[1] || "0", 10) : patient.Appointment[0]!.tokenNumber) : null,
      activeVisitStartTime: patient.Appointment[0]?.updatedAt || null,
      bookingReference: patient.Appointment[0]?.bookingReference || null,
      masterBarcode: patient.Appointment[0]?.bookingReference || null
    });
  } catch (error: any) {
    console.error("Error fetching patient:", error);
    res.status(500).json({ error: error.message });
  }
};

export const generateToken = async (req: Request, res: Response) => {
  try {
    const { 
      patientId: requestedPatientId,
      isNewPatient,
      gender,
      patientName, 
      patientPhone, 
      ageFallback, 
      doctorId, 
      sessionId: requestedSessionId,
      doctorName, 
      testIds, 
      customLabPrices, 
      serviceIds, 
      customServicePrices, 
      doctorTokenNumber, 
      labTokenNumber, 
      serviceTokenNumber, 
      date, 
      bookingType 
    } = req.body;

    // Multi-tenant patient resolution
    let patient: any = null;

    // 1. Explicit patientId provided (e.g. receptionist clicked a specific family member)
    if (requestedPatientId) {
      patient = await prisma.patient.findUnique({ where: { id: requestedPatientId } });
    }

    // 2. Composite lookup if not explicitly flagged as new patient
    if (!patient && !isNewPatient && patientName && patientPhone) {
      const identityKey = generateIdentityKey(patientName, patientPhone);
      if (identityKey) {
        patient = await prisma.patient.findUnique({ where: { identityKey } });
      }
      if (!patient) {
        patient = await prisma.patient.findFirst({
          where: {
            phone: patientPhone,
            fullName: { equals: patientName, mode: "insensitive" }
          }
        });
      }
    }

    // 3. Create new distinct patient if still not resolved
    if (!patient) {
      const patientId = await generateMRN(prisma);
      const effectiveName = patientName || "Walk-in Patient";
      const effectivePhone = patientPhone || `WALKIN-${randomUUID()}`;
      let identityKey = generateIdentityKey(effectiveName, effectivePhone);

      // Handle rare key collision
      if (identityKey) {
        const existingKey = await prisma.patient.findUnique({ where: { identityKey } });
        if (existingKey) {
          identityKey = `${identityKey}_${Date.now().toString().slice(-4)}`;
        }
      }

      patient = await prisma.patient.create({
        data: {
          patientId,
          identityKey: identityKey || null,
          fullName: effectiveName,
          phone: effectivePhone,
          ageFallback: ageFallback ? parseInt(ageFallback.toString(), 10) : null,
          gender: gender || null
        }
      });
      
      if (patientPhone && !patientPhone.startsWith('WALKIN')) {
        SMSService.syncContact(patientPhone, patient.fullName).catch(console.error);
      }
    }

    const hasConsultation = !!doctorId;
    const hasLab = Array.isArray(testIds) && testIds.length > 0;
    const hasService = Array.isArray(serviceIds) && serviceIds.length > 0;

    // --- Billing Logic ---
    let doctorDetails = null;
    let doctorRoomNumber = null;
    if (doctorId) {
      doctorDetails = await prisma.user.findUnique({ where: { id: doctorId }, include: { room: true } });
      const targetDate = date ? new Date(date) : new Date();
      const { startOfDay, endOfDay, dayOfWeek } = getTimezoneBoundaries(targetDate);
      const todayAttendance = await prisma.doctorAttendance.findFirst({
        where: { doctorId: doctorId, date: { gte: startOfDay, lte: endOfDay } },
        include: { room: true }
      });

      let session = null;
      if (requestedSessionId) {
        session = await prisma.doctorScheduleSession.findUnique({
          where: { id: requestedSessionId },
          include: { room: true }
        });
      }
      if (!session) {
        session = await prisma.doctorScheduleSession.findFirst({
          where: {
            dayOfWeek: dayOfWeek,
            isActive: true,
            schedule: {
              doctorId: doctorId,
              validFrom: { lte: endOfDay },
              OR: [
                { validUntil: null },
                { validUntil: { gte: startOfDay } }
              ]
            }
          },
          include: { room: true }
        });
      }

      doctorRoomNumber = todayAttendance?.room?.roomNumber || session?.room?.roomNumber || doctorDetails?.room?.roomNumber || null;
    }
    
    let labTestsDetails: any[] = [];
    if (hasLab) {
      labTestsDetails = await prisma.labTest.findMany({
        where: { id: { in: testIds } },
        include: { room: true }
      });
    }

    let extraServicesDetails: any[] = [];
    if (hasService) {
      extraServicesDetails = await prisma.extraService.findMany({
        where: { id: { in: serviceIds } },
        include: { room: true }
      });
    }

    const isNonOPD = doctorDetails && doctorDetails.specialty && doctorDetails.specialty !== "General" && doctorDetails.specialty.toUpperCase() !== "OPD";
    const needsInvoice = isNonOPD || hasLab || hasService;

    let sharedRefNo = Math.floor(1000000000 + Math.random() * 9000000000).toString();

    // If it's a PHONE booking, check if this patient already has a BOOKED phone appointment today
    if (bookingType === "PHONE" && patient?.id) {
      const targetDate = date ? new Date(date) : new Date();
      const { startOfDay, endOfDay } = getTimezoneBoundaries(targetDate);

      const existingPhoneBooking = await prisma.appointment.findFirst({
        where: {
          patientId: patient.id,
          bookingType: "PHONE",
          status: "BOOKED",
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          bookingReference: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (existingPhoneBooking && existingPhoneBooking.bookingReference) {
        sharedRefNo = existingPhoneBooking.bookingReference;
      }
    }

    // Helper to robustly generate a single token with pg_advisory_xact_lock and atomic recycling
    const generateSpecificToken = async (
      dept: string,
      docId: string | null,
      roomId: string | null,
      prefix: string,
      requestedTokenNumber?: number
    ) => {
      const targetDate = date ? new Date(date) : new Date();
      const { startOfDay, endOfDay, dayOfWeek } = getTimezoneBoundaries(targetDate);

      let sessionId = null;
      if (dept === "CONSULTATION" && docId) {
        if (requestedSessionId) {
          sessionId = requestedSessionId;
        } else {
          const session = await prisma.doctorScheduleSession.findFirst({
            where: {
              dayOfWeek: dayOfWeek,
              isActive: true,
              schedule: {
                doctorId: docId,
                validFrom: { lte: endOfDay },
                OR: [
                  { validUntil: null },
                  { validUntil: { gte: startOfDay } }
                ]
              }
            }
          });
          if (session) {
            sessionId = session.id;
          }
        }
      }

      // Format tokenDisplay
      const formatTokenNumber = (num: number) => {
        const padded = num.toString().padStart(2, "0");
        return prefix ? `${prefix}-${padded}` : padded;
      };

      // Wrap allocation in an atomic interactive transaction with PostgreSQL advisory lock
      return await prisma.$transaction(async (tx) => {
        // Deterministic lock string hashed to int64 by PostgreSQL hashtext
        const lockString = sessionId
          ? `CONSULTATION_${sessionId}_${startOfDay.toISOString()}`
          : `${dept}_${roomId || 'DEFAULT'}_${startOfDay.toISOString()}`;

        // Acquire transaction-level advisory lock (released automatically on commit/rollback)
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, lockString);

        // Fetch all existing appointments for this session/date under lock
        const existingAppts = await tx.appointment.findMany({
          where: {
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            ...(sessionId ? { sessionId } : {
              department: dept,
              ...(roomId ? { roomId } : { doctorId: docId || null })
            })
          },
          select: { id: true, tokenNumber: true, status: true }
        });

        const existingByToken = new Map<string, any>();
        const usedInts = new Set<number>();
        existingAppts.forEach(a => {
          existingByToken.set(a.tokenNumber, a);
          const match = a.tokenNumber.match(/\d+/);
          if (match) {
            usedInts.add(parseInt(match[0], 10));
          }
        });

        // 1. If explicit token requested
        if (requestedTokenNumber) {
          const tokenDisplay = formatTokenNumber(requestedTokenNumber);
          const existingRow = existingByToken.get(tokenDisplay);

          if (existingRow) {
            const isInactive = existingRow.status === "CANCELLED" || existingRow.status === "NO_SHOW";
            if (!isInactive) {
              throw new Error(`Token ${requestedTokenNumber} for ${dept} is already booked.`);
            }

            // Atomic conditional update on inactive slot
            const updateCount = await tx.appointment.updateMany({
              where: {
                id: existingRow.id,
                status: { in: ["CANCELLED", "NO_SHOW"] }
              },
              data: {
                patientId: patient!.id,
                doctorId: docId || null,
                sessionId: sessionId,
                roomId: roomId || null,
                department: dept,
                status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
                bookingType: bookingType || "WALK_IN",
                bookingReference: sharedRefNo,
                calledAt: null,
                completedAt: null,
                cancelledAt: null,
                checkedInAt: null,
                bookedAt: new Date()
              }
            });

            if (updateCount.count === 0) {
              throw new Error(`Token ${requestedTokenNumber} was claimed by another operator.`);
            }

            return await tx.appointment.findUniqueOrThrow({ where: { id: existingRow.id } });
          }

          // Create new token
          try {
            return await tx.appointment.create({
              data: {
                tokenNumber: tokenDisplay,
                patientId: patient!.id,
                doctorId: docId || null,
                sessionId: sessionId,
                roomId: roomId || null,
                department: dept,
                status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
                bookingType: bookingType || "WALK_IN",
                appointmentDate: startOfDay,
                bookingReference: sharedRefNo
              }
            });
          } catch (err: any) {
            if (err.code === "P2002" || err.message?.includes("Unique constraint failed")) {
              throw new Error(`Token ${requestedTokenNumber} for ${dept} was just reserved by another booking.`);
            }
            throw err;
          }
        }

        // 2. Auto-assign next available token
        let nextTokenInt = 1;
        while (usedInts.has(nextTokenInt)) {
          const checkDisplay = formatTokenNumber(nextTokenInt);
          const row = existingByToken.get(checkDisplay);
          if (row && (row.status === "CANCELLED" || row.status === "NO_SHOW")) {
            // Found reusable slot - atomically claim it
            const updateCount = await tx.appointment.updateMany({
              where: {
                id: row.id,
                status: { in: ["CANCELLED", "NO_SHOW"] }
              },
              data: {
                patientId: patient!.id,
                doctorId: docId || null,
                sessionId: sessionId,
                roomId: roomId || null,
                department: dept,
                status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
                bookingType: bookingType || "WALK_IN",
                bookingReference: sharedRefNo,
                calledAt: null,
                completedAt: null,
                cancelledAt: null,
                checkedInAt: null,
                bookedAt: new Date()
              }
            });

            if (updateCount.count > 0) {
              return await tx.appointment.findUniqueOrThrow({ where: { id: row.id } });
            }
          }
          nextTokenInt++;
        }

        const finalDisplay = formatTokenNumber(nextTokenInt);
        return await tx.appointment.create({
          data: {
            tokenNumber: finalDisplay,
            patientId: patient!.id,
            doctorId: docId || null,
            sessionId: sessionId,
            roomId: roomId || null,
            department: dept,
            status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
            bookingType: bookingType || "WALK_IN",
            appointmentDate: startOfDay,
            bookingReference: sharedRefNo
          }
        });
      }, {
        timeout: 10000
      });
    };

    const tokensToGenerate: {
      dept: string;
      docId: string | null;
      roomId: string | null;
      prefix: string;
      name: string;
      roomNumber: string | null;
      requestedTokenNumber?: number;
      testIds?: string[];
      serviceIds?: string[];
    }[] = [];

    if (hasConsultation) {
      tokensToGenerate.push({
        dept: "CONSULTATION",
        docId: doctorId,
        roomId: doctorDetails?.roomId || null,
        prefix: "",
        name: doctorName || "General Physician",
        roomNumber: doctorRoomNumber,
        requestedTokenNumber: doctorTokenNumber
      });
    }

    if (hasLab) {
      const labRooms = await prisma.room.findMany({
        where: { department: "LAB", isActive: true },
        orderBy: { roomNumber: "asc" }
      });
      const defaultLabRoom = labRooms[0] || null;

      const labGroups = new Map<string, { roomId: string | null; roomNumber: string; testIds: string[] }>();
      for (const t of labTestsDetails) {
        const assignedRoom = t.room || labRooms.find(r => r.id === t.roomId) || defaultLabRoom;
        const rId = assignedRoom?.id || "default-lab";
        const rNum = assignedRoom?.roomNumber || "LAB-A";
        if (!labGroups.has(rId)) {
          labGroups.set(rId, { roomId: assignedRoom?.id || null, roomNumber: rNum, testIds: [] });
        }
        labGroups.get(rId)!.testIds.push(t.id);
      }

      for (const [_, grp] of labGroups.entries()) {
        const isLabA = grp.roomNumber.toUpperCase().includes("A");
        const isLabB = grp.roomNumber.toUpperCase().includes("B");
        const prefix = isLabA ? "LA" : isLabB ? "LB" : "LAB";

        tokensToGenerate.push({
          dept: "LAB",
          docId: null,
          roomId: grp.roomId,
          prefix: prefix,
          name: `Laboratory (${grp.roomNumber})`,
          roomNumber: grp.roomNumber,
          requestedTokenNumber: labGroups.size === 1 ? labTokenNumber : undefined,
          testIds: grp.testIds
        });
      }
    }

    if (hasService) {
      const serviceRooms = await prisma.room.findMany({
        where: { department: "EXTRA_SERVICE", isActive: true },
        orderBy: { roomNumber: "asc" }
      });
      const defaultServiceRoom = serviceRooms[0] || null;

      const serviceGroups = new Map<string, { roomId: string | null; roomNumber: string; serviceIds: string[] }>();
      for (const s of extraServicesDetails) {
        const assignedRoom = s.room || serviceRooms.find(r => r.id === s.roomId) || defaultServiceRoom;
        const rId = assignedRoom?.id || "default-es";
        const rNum = assignedRoom?.roomNumber || "EXT-01";
        if (!serviceGroups.has(rId)) {
          serviceGroups.set(rId, { roomId: assignedRoom?.id || null, roomNumber: rNum, serviceIds: [] });
        }
        serviceGroups.get(rId)!.serviceIds.push(s.id);
      }

      for (const [_, grp] of serviceGroups.entries()) {
        const isES1 = grp.roomNumber.includes("01") || grp.roomNumber.includes("1");
        const isES2 = grp.roomNumber.includes("02") || grp.roomNumber.includes("2");
        const prefix = isES1 ? "ES1" : isES2 ? "ES2" : "ES";

        tokensToGenerate.push({
          dept: "EXTRA_SERVICE",
          docId: null,
          roomId: grp.roomId,
          prefix: prefix,
          name: `Extra Services (${grp.roomNumber})`,
          roomNumber: grp.roomNumber,
          requestedTokenNumber: serviceGroups.size === 1 ? serviceTokenNumber : undefined,
          serviceIds: grp.serviceIds
        });
      }
    }

    if (tokensToGenerate.length === 0) {
      return res.status(400).json({ success: false, error: "No services selected to generate token." });
    }

    const generatedTokens = [];
    for (const t of tokensToGenerate) {
      const token = await generateSpecificToken(t.dept, t.docId, t.roomId, t.prefix, t.requestedTokenNumber);
      generatedTokens.push({
        id: token.id,
        refNo: token.bookingReference,
        tokenNumber: token.tokenNumber,
        department: token.department,
        status: token.status,
        doctorName: t.name,
        patientName: patient.fullName,
        appointmentDate: token.appointmentDate,
        roomId: t.roomId,
        roomNumber: t.roomNumber,
        testIds: t.testIds,
        serviceIds: t.serviceIds
      });
    }

    // --- Invoice Generation ---
    let invoiceData = null;
    if (needsInvoice) {
      const lineItems = [];
      let totalAmount = 0;

      if (isNonOPD && doctorDetails?.feeType === "UPFRONT") {
        const fee = doctorDetails.consultationFee || 2500;
        lineItems.push({
          department: "CONSULTATION",
          description: `Specialist Consultation (Upfront) - ${doctorName}`,
          quantity: 1,
          unitPrice: fee,
          total: fee
        });
        totalAmount = Math.round((totalAmount + fee) * 100) / 100;
      }



      if (hasService) {
        extraServicesDetails.forEach(svc => {
          const finalPrice = customServicePrices && customServicePrices[svc.id] !== undefined 
            ? Number(customServicePrices[svc.id]) 
            : svc.price;
          lineItems.push({
            department: "EXTRA_SERVICE",
            referenceId: svc.id,
            description: `Extra Service: ${svc.title}`,
            quantity: 1,
            unitPrice: finalPrice,
            total: finalPrice
          });
          totalAmount = Math.round((totalAmount + finalPrice) * 100) / 100;
        });
      }

      if (hasLab) {
        labTestsDetails.forEach(test => {
          const finalPrice = customLabPrices && customLabPrices[test.id] !== undefined 
            ? Number(customLabPrices[test.id]) 
            : test.price;
          lineItems.push({
            department: "LAB",
            referenceId: test.id,
            description: `Lab Test: ${test.name}`,
            quantity: 1,
            unitPrice: finalPrice,
            total: finalPrice
          });
          totalAmount = Math.round((totalAmount + finalPrice) * 100) / 100;
        });
      }

      const discount = req.body.discount;
      const discountAmount = Math.max(0, Math.min(totalAmount, Number(discount?.amount) || 0));
      const finalAmount = Math.max(0, Math.round((totalAmount - discountAmount) * 100) / 100);

      if (lineItems.length > 0 && totalAmount > 0) {
        const invoice = await prisma.invoice.create({
          data: {
            visitId: generatedTokens[0]?.id || "", // Associate invoice with the first primary token
            patientId: patient.id,
            status: bookingType === "PHONE" ? "DRAFT" : "PAID",
            subtotal: totalAmount,
            discountAmount: discountAmount,
            discountType: discount?.type || null,
            discountValue: discount?.value !== undefined ? Number(discount.value) : null,
            discountReason: discount?.reason || null,
            totalAmount: finalAmount,
            lineItems: { create: lineItems },
            ...(bookingType !== "PHONE" && {
              payments: {
                create: [{
                  amount: finalAmount,
                  method: req.body.paymentMethod || "CASH",
                  status: "COMPLETED", shiftId: await getOpenShiftId(((req as any).user)?.id)
                }]
              }
            })
          },
          include: { lineItems: true }
        });
        invoiceData = invoice;
      }
    }

    // --- Post Generation Hooks ---
    if (hasLab) {
      const { labService } = await import('../services/lab.service.js');
      const labTokens = generatedTokens.filter(t => t.department === "LAB");
      for (const lt of labTokens) {
        const testsForThisRoom = lt.testIds && lt.testIds.length > 0 ? lt.testIds : testIds;
        if (testsForThisRoom && testsForThisRoom.length > 0) {
          await labService.createRequest({
            patientId: patient.id,
            visitId: lt.id,
            testIds: testsForThisRoom,
            doctorId: doctorId || null,
            priority: "ROUTINE",
            customPrices: customLabPrices,
            skipBilling: true
          });
        }
      }
    }

    if (patientPhone && !patientPhone.startsWith('WALKIN')) {
      const masterBookingRef = generatedTokens[0]?.refNo || (typeof sharedRefNo !== 'undefined' ? sharedRefNo : 'N/A');
      const formattedApptDate = (date ? new Date(date) : new Date()).toLocaleDateString('en-GB');

      const { templateName, variables } = SMSService.buildVisitTokenNotification(
        patient.fullName,
        formattedApptDate,
        masterBookingRef,
        generatedTokens
      );

      await NotificationService.sendTemplatedSMS(
        patient.id,
        patientPhone,
        templateName,
        variables
      ).catch(console.error);
    }

    if (hasConsultation && typeof doctorId === 'string') {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const updatedAvailability = await BookingService.getAvailability(doctorId as string, todayStr as string);
        websocketService.emitToRoom(`doctor_${doctorId}_${todayStr}`, 'availability_updated', updatedAvailability);
      } catch (e) {}
    }

    if (websocketService.getIo()) {
      generatedTokens.forEach(t => {
        websocketService.getIo().emit("TOKEN_STATUS_UPDATED", { tokenId: t.id });
      });
    }

    res.status(201).json({
      success: true,
      data: {
        tokens: generatedTokens, // Send all tokens to POS
        invoice: invoiceData
      }
    });
  } catch (error: any) {
    console.error("Error generating token:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const markDoctorArrived = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roomId, startTime, endTime } = req.body;

    if (!roomId || roomId.trim() === "") {
      return res.status(400).json({ success: false, error: "Room is mandatory" });
    }

    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find if there's already an attendance record for today
    let attendance = await prisma.doctorAttendance.findFirst({
      where: {
        doctorId: id as string,
        date: { gte: today, lt: tomorrow }
      }
    });

    if (attendance) {
      attendance = await prisma.doctorAttendance.update({
        where: { id: attendance.id },
        data: {
          status: "ARRIVED",
          roomId: roomId || null,
          arrivedAt: attendance.arrivedAt || new Date(),
          expectedStartTime: startTime || attendance.expectedStartTime,
          expectedEndTime: endTime || attendance.expectedEndTime
        }
      });
    } else {
      attendance = await prisma.doctorAttendance.create({
        data: {
          doctorId: id as string,
          date: today,
          status: "ARRIVED",
          roomId: roomId || null,
          arrivedAt: new Date(),
          expectedStartTime: startTime || null,
          expectedEndTime: endTime || null
        }
      });
    }
    
    // Trigger SMS to waiting patients
    try {
      await NotificationService.triggerDoctorArrived(id as string, today);
    } catch (e) {
      console.error("Failed to send doctor arrived SMS notifications:", e);
    }
    
    res.json({ success: true, data: attendance });
  } catch (error: any) {
    console.error("Error marking doctor arrived:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const markDoctorOut = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { outTime } = req.body;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendance = await prisma.doctorAttendance.findFirst({
      where: {
        doctorId: id as string,
        date: { gte: today, lt: tomorrow }
      }
    });

    if (!attendance) {
      return res.status(404).json({ success: false, error: "No arrival record found for today" });
    }

    let leftAt = new Date();
    if (outTime) {
      // outTime is expected to be "HH:MM"
      const [hours, minutes] = outTime.split(':');
      leftAt = new Date();
      leftAt.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    }

    const updated = await prisma.doctorAttendance.update({
      where: { id: attendance.id },
      data: {
        status: "LEFT",
        leftAt
      }
    });
    
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("Error marking doctor out:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};



export const updateShiftPeriod = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { startTime, endTime } = req.body;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const attendance = await prisma.doctorAttendance.findFirst({
      where: {
        doctorId: id as string,
        date: { gte: today, lt: tomorrow }
      }
    });

    let updated;
    if (attendance) {
      updated = await prisma.doctorAttendance.update({
        where: { id: attendance.id },
        data: {
          expectedStartTime: startTime !== undefined ? startTime : attendance.expectedStartTime,
          expectedEndTime: endTime !== undefined ? endTime : attendance.expectedEndTime
        }
      });
    } else {
      updated = await prisma.doctorAttendance.create({
        data: {
          doctorId: id as string,
          date: today,
          status: "SCHEDULED",
          expectedStartTime: startTime || null,
          expectedEndTime: endTime || null
        }
      });
    }
    
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const checkoutAppointment = async (req: Request, res: Response) => {
  try {
    const { appointmentId, fee, isUpfront, discount } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ success: false, error: "appointmentId is required" });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { Patient: true, User: true }
    });

    if (!appointment) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    if (appointment.status === "CANCELLED") {
      return res.status(400).json({ success: false, error: "Cannot checkout a cancelled appointment" });
    }

    let allApptIds = [appointmentId];
    
    let allApptsForPatient: any[] = [];
    if (appointment.bookingReference) {
      allApptsForPatient = await prisma.appointment.findMany({
        where: { 
          bookingReference: appointment.bookingReference,
          status: { not: "CANCELLED" }
        }
      });
    } else {
      allApptsForPatient = [appointment];
    }

    if (allApptsForPatient.length > 0) {
      allApptIds = allApptsForPatient.map(a => a.id);
      if (!allApptIds.includes(appointmentId)) {
        allApptIds.push(appointmentId);
      }
    }

    let updatedAppointment = appointment;

    // Update appointment status appropriately (do not regress COMPLETED or IN_PROGRESS)
    for (const apptId of allApptIds) {
      const appt = allApptsForPatient.find(a => a.id === apptId) || appointment;
      if (appt.status === "BOOKED") {
        const newStatus = appt.department === "LAB" ? "WAITING_FOR_LAB_TEST" : "WAITING";
        const updated = await prisma.appointment.update({
          where: { id: apptId },
          data: { status: newStatus }
        });
        if (apptId === appointmentId) {
          updatedAppointment = updated as any;
        }
      }
    }

    const allVisitIdentifiers = Array.from(
      new Set([
        ...allApptIds,
        appointment.bookingReference,
        ...allApptsForPatient.map(a => a.bookingReference).filter(Boolean)
      ])
    ).filter(Boolean) as string[];

    let mergedInvoice: any = null;

    await prisma.$transaction(async (tx) => {
      let invoices = await tx.invoice.findMany({
        where: {
          visitId: { in: allVisitIdentifiers },
          status: "DRAFT"
        },
        include: { lineItems: true }
      });

      const shiftId = await getOpenShiftId(((req as any).user)?.id, tx);

      // Check if this appointment already has a linked payment record
      const existingApptPayment = await tx.payment.findUnique({
        where: { appointmentId: appointment.id }
      });
      let availableApptIdForPayment: string | null = existingApptPayment ? null : appointment.id;

      // Check if consultation fee was already paid
      const existingConsultPaid = await tx.invoice.findFirst({
        where: {
          visitId: { in: allVisitIdentifiers },
          status: "PAID",
          lineItems: { some: { department: "CONSULTATION" } }
        }
      });

      const hasConsultInDraftInvoices = invoices.some((inv: any) =>
        inv.lineItems?.some((li: any) => li.department === "CONSULTATION")
      );

      const numericFee = Number(fee) || 0;
      const willCreateConsultInvoice = !existingConsultPaid && !hasConsultInDraftInvoices && numericFee > 0;

      if (invoices.length > 0) {
        // Pay all existing DRAFT invoices
        for (const inv of invoices) {
          const isConsultationInv = inv.lineItems?.some((li: any) => li.department === "CONSULTATION");
          let linkApptId: string | null = null;

          if (isConsultationInv && availableApptIdForPayment) {
            linkApptId = availableApptIdForPayment;
            availableApptIdForPayment = null;
          } else if (!willCreateConsultInvoice && availableApptIdForPayment) {
            linkApptId = availableApptIdForPayment;
            availableApptIdForPayment = null;
          }

          const discountAmount = Math.max(0, Math.min(inv.subtotal, Number(discount?.amount) || 0));
          const finalInvAmount = discount && discountAmount > 0 
            ? Math.max(0, Math.round((inv.subtotal - discountAmount) * 100) / 100)
            : inv.totalAmount;

          const updatedInv = await tx.invoice.update({
            where: { id: inv.id },
            data: {
              status: "PAID",
              discountAmount,
              discountType: discount?.type || null,
              discountValue: discount?.value !== undefined ? Number(discount.value) : null,
              discountReason: discount?.reason || null,
              totalAmount: finalInvAmount,
              payments: {
                create: [{
                  amount: finalInvAmount,
                  method: req.body.paymentMethod || "CASH",
                  status: "COMPLETED", 
                  shiftId,
                  ...(linkApptId ? { appointmentId: linkApptId } : {})
                }]
              }
            },
            include: { lineItems: true }
          });
          if (!mergedInvoice) {
            mergedInvoice = { ...updatedInv, lineItems: [...updatedInv.lineItems] };
          } else {
            mergedInvoice.totalAmount += updatedInv.totalAmount;
            mergedInvoice.lineItems.push(...updatedInv.lineItems);
          }
        }
      }

      if (willCreateConsultInvoice) {
        const consultApptId = availableApptIdForPayment;
        availableApptIdForPayment = null;

        // Create a new paid invoice for consultation (upfront or post-pay)
        const consultInvoice = await tx.invoice.create({
          data: {
            visitId: appointment.id,
            patientId: appointment.patientId,
            subtotal: numericFee,
            totalAmount: numericFee,
            status: "PAID",
            payments: {
              create: [{
                amount: numericFee,
                method: req.body.paymentMethod || "CASH",
                status: "COMPLETED", 
                shiftId,
                ...(consultApptId ? { appointmentId: consultApptId } : {})
              }]
            },
            lineItems: {
              create: [
                {
                  description: `Consultation - Dr. ${appointment.User?.fullName || 'General'}`,
                  quantity: 1,
                  unitPrice: numericFee,
                  total: numericFee,
                  department: "CONSULTATION"
                }
              ]
            }
          },
          include: { lineItems: true }
        });

        if (!mergedInvoice) {
          mergedInvoice = consultInvoice;
        } else {
          mergedInvoice.totalAmount += consultInvoice.totalAmount;
          mergedInvoice.lineItems.push(...consultInvoice.lineItems);
        }
      }
    }, { timeout: 15000, maxWait: 5000 });

    if (websocketService.getIo()) {
      websocketService.getIo().emit("TOKEN_STATUS_UPDATED", { tokenId: appointmentId });
    }

    let allTokens = await prisma.appointment.findMany({
      where: { id: { in: allApptIds } },
      include: { Patient: true, User: { include: { room: true } } }
    });

    const targetDate = new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    allTokens = await Promise.all(allTokens.map(async (t) => {
      let roomNumber = t.User?.room?.roomNumber || null;
      if (t.doctorId) {
        const attendance = await prisma.doctorAttendance.findFirst({
          where: { doctorId: t.doctorId, date: { gte: startOfDay, lte: endOfDay } },
          include: { room: true }
        });
        if (attendance?.room?.roomNumber) {
          roomNumber = attendance.room.roomNumber;
        }
      }
      return { ...t, roomNumber };
    })) as any;

    res.json({
      success: true,
      data: {
        appointment: updatedAppointment,
        tokens: allTokens.length > 0 ? allTokens : [appointment],
        invoice: mergedInvoice,
        tokenNumber: appointment.tokenNumber,
        department: appointment.department,
        doctorName: appointment.User?.fullName,
        patientName: appointment.Patient?.fullName
      }
    });
  } catch (error: any) {
    console.error("Error checking out appointment:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPOSHistory = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string || "";
    
    let patientIds: string[] = [];
    if (search) {
      const patients = await prisma.patient.findMany({
        where: {
          OR: [
            { phone: { contains: search } },
            { fullName: { contains: search, mode: "insensitive" } }
          ]
        },
        select: { id: true }
      });
      patientIds = patients.map(p => p.id);
    }
    
    const isTimestamp = /^\d{10}$/.test(search) && Number(search) >= 1700000000 && Number(search) <= 1950000000;
    const timeCondition = isTimestamp ? {
      createdAt: {
        gte: new Date(Number(search) * 1000 - 120000),
        lte: new Date(Number(search) * 1000 + 120000)
      }
    } : null;

    const invoices = await prisma.invoice.findMany({
      where: search ? {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : []),
          ...(timeCondition ? [timeCondition] : [])
        ]
      } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        lineItems: true,
        payments: {
          where: { status: "COMPLETED" },
          select: { method: true, amount: true, appointmentId: true }
        }
      }
    });

    const appointments = await prisma.appointment.findMany({
      where: search ? {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          { bookingReference: { contains: search, mode: "insensitive" } },
          { tokenNumber: { contains: search, mode: "insensitive" } },
          ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : []),
          ...(timeCondition ? [{ appointmentDate: timeCondition.createdAt }] : [])
        ]
      } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        User: { include: { room: true } },
        Patient: true
      }
    });

    const allPatientIds = Array.from(new Set([
      ...invoices.map(i => i.patientId).filter(Boolean),
      ...appointments.map(a => a.patientId).filter(Boolean)
    ])) as string[];

    const patientsList = allPatientIds.length > 0 ? await prisma.patient.findMany({
      where: { id: { in: allPatientIds } }
    }) : [];
    const patientsMap = new Map<string, any>(patientsList.map(p => [p.id, p]));

    const apptById = new Map<string, any>();
    const apptByBookingRef = new Map<string, any>();
    appointments.forEach(apt => {
      apptById.set(apt.id, apt);
      if (apt.bookingReference) {
        apptByBookingRef.set(apt.bookingReference, apt);
      }
    });

    const linkedApptIds = new Set<string>();
    const unifiedItems: any[] = [];

    // Process all invoices and link matching tokens
    invoices.forEach(inv => {
      let matchedAppt = null;
      if (inv.visitId) {
        matchedAppt = apptById.get(inv.visitId) || apptByBookingRef.get(inv.visitId);
      }
      if (!matchedAppt && inv.payments) {
        for (const p of inv.payments) {
          if (p.appointmentId && apptById.has(p.appointmentId)) {
            matchedAppt = apptById.get(p.appointmentId);
            break;
          }
        }
      }

      const paymentMethod = inv.payments?.[0]?.method || "CASH";
      const patient = (inv.patientId ? patientsMap.get(inv.patientId) : null) || matchedAppt?.Patient || null;

      if (matchedAppt) {
        linkedApptIds.add(matchedAppt.id);
        unifiedItems.push({
          type: "VISIT",
          id: inv.id,
          createdAt: inv.createdAt,
          patientId: inv.patientId || matchedAppt.patientId,
          Patient: patient,
          tokenNumber: matchedAppt.tokenNumber,
          department: matchedAppt.department,
          doctorName: matchedAppt.User?.fullName,
          roomNumber: matchedAppt.User?.room?.roomNumber,
          bookingReference: matchedAppt.bookingReference,
          appointmentStatus: matchedAppt.status,
          appointmentId: matchedAppt.id,
          invoiceId: inv.id,
          totalAmount: inv.totalAmount,
          invoiceStatus: inv.status,
          paymentMethod,
          lineItems: inv.lineItems,
          token: {
            id: matchedAppt.id,
            refNo: matchedAppt.bookingReference,
            tokenNumber: matchedAppt.tokenNumber,
            department: matchedAppt.department,
            status: matchedAppt.status,
            doctorName: matchedAppt.User?.fullName,
            roomNumber: matchedAppt.User?.room?.roomNumber,
            patientName: patient?.fullName || "Walk-in Patient",
            appointmentDate: matchedAppt.createdAt
          },
          invoice: {
            receiptId: inv.id,
            date: inv.createdAt,
            total: inv.totalAmount,
            subtotal: inv.subtotal,
            status: inv.status,
            paymentMethod,
            items: (inv.lineItems || []).map((li: any) => ({
              name: li.description,
              qty: li.quantity,
              price: li.unitPrice,
              total: li.total
            }))
          }
        });
      } else {
        // Direct bill (e.g. Pharmacy OTC sale)
        unifiedItems.push({
          type: "INVOICE",
          id: inv.id,
          createdAt: inv.createdAt,
          patientId: inv.patientId,
          Patient: patient,
          tokenNumber: null,
          department: "PHARMACY",
          doctorName: null,
          roomNumber: null,
          bookingReference: null,
          appointmentStatus: null,
          appointmentId: null,
          invoiceId: inv.id,
          totalAmount: inv.totalAmount,
          invoiceStatus: inv.status,
          paymentMethod,
          lineItems: inv.lineItems,
          token: null,
          invoice: {
            receiptId: inv.id,
            date: inv.createdAt,
            total: inv.totalAmount,
            subtotal: inv.subtotal,
            status: inv.status,
            paymentMethod,
            items: (inv.lineItems || []).map((li: any) => ({
              name: li.description,
              qty: li.quantity,
              price: li.unitPrice,
              total: li.total
            }))
          }
        });
      }
    });

    // Add unlinked appointments (e.g. phone bookings, post-pay tokens without invoice yet)
    appointments.forEach(apt => {
      if (!linkedApptIds.has(apt.id)) {
        unifiedItems.push({
          type: "TOKEN",
          id: apt.id,
          createdAt: apt.createdAt,
          patientId: apt.patientId,
          Patient: apt.Patient,
          tokenNumber: apt.tokenNumber,
          department: apt.department,
          doctorName: apt.User?.fullName,
          roomNumber: apt.User?.room?.roomNumber,
          bookingReference: apt.bookingReference,
          appointmentStatus: apt.status,
          appointmentId: apt.id,
          invoiceId: null,
          totalAmount: null,
          invoiceStatus: null,
          paymentMethod: null,
          lineItems: [],
          token: {
            id: apt.id,
            refNo: apt.bookingReference,
            tokenNumber: apt.tokenNumber,
            department: apt.department,
            status: apt.status,
            doctorName: apt.User?.fullName,
            roomNumber: apt.User?.room?.roomNumber,
            patientName: apt.Patient?.fullName || "Walk-in Patient",
            appointmentDate: apt.createdAt
          },
          invoice: null
        });
      }
    });

    unifiedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ success: true, data: unifiedItems.slice(0, 100) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const closeShiftAndGetSummary = async (req: Request, res: Response) => {
  try {
    const { declaredCash } = req.body;
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    
    const shift = await prisma.cashRegisterShift.findFirst({
      where: { openedBy: user.id, status: "OPEN" },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            Role: { select: { name: true } }
          }
        }
      }
    });

    if (!shift) return res.status(400).json({ error: "No open shift found." });
    
    const [payments, refunds, doctorDisbursements, todayAgg] = await Promise.all([
      prisma.payment.findMany({
        where: { shiftId: shift.id, status: "COMPLETED" },
        include: {
          invoice: {
            include: {
              lineItems: true
            }
          },
          Appointment: {
            include: {
              User: {
                select: {
                  id: true,
                  fullName: true,
                  specialty: true,
                  consultationFee: true,
                  commissionRate: true,
                  commissionType: true
                }
              }
            }
          }
        }
      }),
      prisma.refund.findMany({
        where: { shiftId: shift.id, status: "COMPLETED" },
        include: { payment: true }
      }),
      prisma.doctorDailySheet.findMany({
        where: {
          disbursedById: user.id,
          updatedAt: { gte: shift.openedAt },
          cashDisbursed: { gt: 0 }
        },
        include: {
          doctor: {
            select: { id: true, fullName: true, specialty: true }
          }
        }
      }),
      (() => {
        const { startOfDay, endOfDay } = getTimezoneBoundaries();
        return prisma.payment.aggregate({
          where: {
            createdAt: { gte: startOfDay, lte: endOfDay },
            status: "COMPLETED"
          },
          _sum: { amount: true }
        });
      })()
    ]);

    // Resolve doctor details for any invoices linked via visitId
    const visitIds = payments
      .map(p => p.invoice?.visitId)
      .filter((id): id is string => Boolean(id));

    const visitAppointments = visitIds.length > 0
      ? await prisma.appointment.findMany({
          where: { id: { in: visitIds } },
          include: {
            User: {
              select: {
                id: true,
                fullName: true,
                specialty: true,
                consultationFee: true,
                commissionRate: true,
                commissionType: true
              }
            }
          }
        })
      : [];

    const visitMap = new Map<string, any>();
    visitAppointments.forEach(va => visitMap.set(va.id, va));

    // 1. Payment Method Breakdown
    let systemCashTotal = 0;
    let systemCardTotal = 0;
    let systemBankTotal = 0;
    let systemQrTotal = 0;

    payments.forEach(payment => {
      const amt = payment.amount || 0;
      const m = (payment.method || "CASH").toUpperCase();
      if (m === "CASH") {
        systemCashTotal += amt;
      } else if (m === "CARD") {
        systemCardTotal += amt;
      } else if (m === "BANK" || m === "TRANSFER") {
        systemBankTotal += amt;
      } else if (m === "QR") {
        systemQrTotal += amt;
      } else {
        systemCardTotal += amt;
      }
    });

    // 2. Department Breakdown
    let consultationSales = 0;
    let pharmacySales = 0;
    let labSales = 0;
    let extraServiceSales = 0;
    let otherSales = 0;

    const countedInvoices = new Set<string>();
    payments.forEach(p => {
      if (p.invoice && !countedInvoices.has(p.invoice.id)) {
        countedInvoices.add(p.invoice.id);
        (p.invoice.lineItems || []).forEach(li => {
          const tot = li.total || 0;
          const dept = (li.department || "").toUpperCase();
          if (dept === "CONSULTATION") {
            consultationSales += tot;
          } else if (dept === "PHARMACY") {
            pharmacySales += tot;
          } else if (dept === "LAB") {
            labSales += tot;
          } else if (dept === "EXTRA_SERVICE" || dept === "OTHER") {
            extraServiceSales += tot;
          } else {
            otherSales += tot;
          }
        });
      }
    });

    // 3. Refunds
    let cashRefundsTotal = 0;
    let nonCashRefundsTotal = 0;
    refunds.forEach(refund => {
      const rAmt = refund.amount || 0;
      if (refund.payment?.method === "CASH") {
        cashRefundsTotal += rAmt;
      } else {
        nonCashRefundsTotal += rAmt;
      }
    });

    // 4. Doctor Payments Breakdown
    const doctorMap = new Map<string, {
      doctorId: string;
      doctorName: string;
      specialty: string;
      patientCount: number;
      totalFee: number;
      commissionRate: number;
      commissionType?: string;
      hospitalCommission: number;
      netDoctorPayment: number;
    }>();

    payments.forEach(p => {
      const doc = p.Appointment?.User || (p.invoice?.visitId ? visitMap.get(p.invoice.visitId)?.User : null);
      const consultItems = p.invoice?.lineItems?.filter(li => li.department === "CONSULTATION") || [];
      const consultTotal = consultItems.reduce((acc, ci) => acc + (ci.total || 0), 0);

      if (doc) {
        const docId = doc.id;
        const current = doctorMap.get(docId) || {
          doctorId: docId,
          doctorName: doc.fullName.startsWith("Dr.") ? doc.fullName : `Dr. ${doc.fullName}`,
          specialty: doc.specialty || "General",
          patientCount: 0,
          totalFee: 0,
          commissionRate: doc.commissionRate ?? (doc.commissionType === "FLAT" ? 500 : 20),
          commissionType: doc.commissionType || "PERCENTAGE",
          hospitalCommission: 0,
          netDoctorPayment: 0
        };
        current.patientCount += 1;
        current.totalFee += (consultTotal > 0 ? consultTotal : (doc.consultationFee || p.amount));
        doctorMap.set(docId, current);
      } else if (consultItems.length > 0) {
        consultItems.forEach(ci => {
          const rawDocName = ci.description
            .replace(/^Specialist Consultation\s*(\(Upfront\))?\s*-\s*/i, "")
            .replace(/^Consultation\s*-\s*/i, "")
            .trim();
          const cleanName = rawDocName.startsWith("Dr.") ? rawDocName : `Dr. ${rawDocName || "Specialist"}`;
          const key = `named_${cleanName}`;
          const current = doctorMap.get(key) || {
            doctorId: key,
            doctorName: cleanName,
            specialty: "Consultation",
            patientCount: 0,
            totalFee: 0,
            commissionRate: 20,
            commissionType: "PERCENTAGE",
            hospitalCommission: 0,
            netDoctorPayment: 0
          };
          current.patientCount += ci.quantity || 1;
          current.totalFee += ci.total || 0;
          doctorMap.set(key, current);
        });
      }
    });

    const doctorPayments = Array.from(doctorMap.values()).map(d => {
      let hospComm = 0;
      if (d.commissionType === "FLAT") {
        hospComm = Math.min(d.totalFee, (d.commissionRate ?? 500) * d.patientCount);
      } else {
        hospComm = Math.round(d.totalFee * (d.commissionRate / 100) * 100) / 100;
      }
      const netDoc = Math.max(0, Math.round((d.totalFee - hospComm) * 100) / 100);
      return {
        ...d,
        hospitalCommission: hospComm,
        netDoctorPayment: netDoc
      };
    });

    const totalDoctorPayments = {
      totalDoctors: doctorPayments.length,
      totalConsultations: doctorPayments.reduce((sum, d) => sum + d.patientCount, 0),
      totalFee: doctorPayments.reduce((sum, d) => sum + d.totalFee, 0),
      hospitalCommission: doctorPayments.reduce((sum, d) => sum + d.hospitalCommission, 0),
      netDoctorPayment: doctorPayments.reduce((sum, d) => sum + d.netDoctorPayment, 0)
    };

    // 5. Doctor Cash Disbursements
    const totalDoctorCashDisbursed = doctorDisbursements.reduce((sum, d) => sum + (d.cashDisbursed || 0), 0);
    const doctorDisbursementsList = doctorDisbursements.map(d => ({
      id: d.id,
      doctorName: d.doctor?.fullName || "Doctor",
      specialty: d.doctor?.specialty || "",
      cashDisbursed: d.cashDisbursed,
      disbursedAt: d.updatedAt
    }));

    // 6. Cash Balance & Drawer Reconciliation
    const startingFloat = shift.openingFloat || 0;
    const totalSales = systemCashTotal + systemCardTotal + systemBankTotal + systemQrTotal;
    const netSales = totalSales - (cashRefundsTotal + nonCashRefundsTotal);
    const expectedCash = startingFloat + systemCashTotal - cashRefundsTotal - totalDoctorCashDisbursed;
    const actualCash = Number(declaredCash);
    const variance = actualCash - expectedCash;
    const varianceStatus = Math.abs(variance) < 0.01 ? "BALANCED" : variance > 0 ? "SURPLUS" : "SHORTAGE";

    // 7. Update Shift in Database
    const closedAt = new Date();
    await prisma.cashRegisterShift.update({
      where: { id: shift.id },
      data: {
        closedAt,
        status: "CLOSED",
        expectedCash,
        actualCash,
        variance
      }
    });

    const openedAt = shift.openedAt;
    const durationMs = closedAt.getTime() - new Date(openedAt).getTime();
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const durationFormatted = `${durationHours}h ${durationMins}m`;

    const summary = {
      // 1. Shift & Cashier Meta
      shiftId: shift.id,
      shiftRef: `SH-${shift.id.slice(0, 8).toUpperCase()}`,
      cashierId: user.id,
      cashierName: shift.user?.fullName || user.fullName || "Cashier",
      cashierRole: shift.user?.Role?.name || user.role || "Cashier",
      openedAt,
      closedAt,
      durationMinutes: Math.round(durationMs / 60000),
      durationFormatted,
      printedAt: closedAt.toISOString(),

      // 2. Day & Shift Sales Breakdown
      totalInvoices: payments.length,
      totalTransactions: payments.length,
      systemCashTotal,
      systemCardTotal,
      systemBankTotal,
      systemQrTotal,
      nonCashTotal: systemCardTotal + systemBankTotal + systemQrTotal,
      grossSales: totalSales,
      totalSales,
      cashRefundsTotal,
      totalRefunds: cashRefundsTotal + nonCashRefundsTotal,
      netSales,
      todayHospitalTotalSales: todayAgg._sum.amount || 0,
      departmentSales: {
        consultations: consultationSales,
        pharmacy: pharmacySales,
        lab: labSales,
        extraServices: extraServiceSales,
        other: otherSales
      },

      // 3. Cash Balance & Drawer Reconciliation
      startingFloat,
      cashCollected: systemCashTotal,
      cashRefunds: cashRefundsTotal,
      doctorCashDisbursed: totalDoctorCashDisbursed,
      expectedCash,
      actualCash,
      declaredCash: actualCash,
      variance,
      varianceStatus,

      // 4. Doctor Payments
      doctorPayments,
      totalDoctorPayments,
      doctorDisbursementsList
    };

    res.json({ success: true, data: summary });
  } catch (error: any) {
    console.error("closeShiftAndGetSummary error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
