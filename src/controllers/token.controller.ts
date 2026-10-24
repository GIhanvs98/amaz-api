import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { websocketService } from "../services/websocket.service.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";
import { recordCompletedConsultationInDailySheet } from "./fund-office.controller.js";

export const generateToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, doctorId, appointmentDate } = req.body;

    if (!patientId || !doctorId) {
      res.status(400).json({ error: "Please provide patientId and doctorId" });
      return;
    }

    const doctor = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { Role: true },
    });

    if (!doctor || doctor.Role?.name !== "Doctor") {
      res.status(400).json({ error: "Invalid doctor selected" });
      return;
    }

    // Determine target date and timezone boundaries
    const targetDate = appointmentDate ? new Date(appointmentDate) : new Date();
    const { startOfDay, endOfDay, dayOfWeek } = getTimezoneBoundaries(targetDate);

    // Check if the doctor has an active schedule for the target day
    const activeSessions = await prisma.doctorScheduleSession.findMany({
      where: {
        schedule: {
          doctorId: doctorId,
          validFrom: { lte: endOfDay },
          OR: [
            { validUntil: null },
            { validUntil: { gte: startOfDay } }
          ]
        },
        dayOfWeek: dayOfWeek,
        isActive: true,
      }
    });

    if (activeSessions.length === 0) {
      res.status(400).json({ error: "Doctor is not scheduled for this date" });
      return;
    }

    const session = activeSessions[0];
    if (!session) {
      res.status(400).json({ error: "Doctor session is not available" });
      return;
    }
    const maxWalkInCapacity = Math.floor(session.tokenCapacity * ((session.walkInPercentage || 100) / 100));

    // Wrap in a transaction with a row-level lock to prevent concurrent token generation race conditions
    const appointment = await prisma.$transaction(async (tx) => {
      // Lock the doctor's row for update to serialize concurrent token requests for the same doctor
      await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${doctorId} FOR UPDATE`;

      const tokensToday = await tx.appointment.count({
        where: {
          doctorId,
          appointmentDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      const existingTokens = await tx.appointment.findMany({
        where: {
          sessionId: session.id,
          appointmentDate: { gte: startOfDay, lte: endOfDay }
        },
        select: { id: true, tokenNumber: true, status: true }
      });

      const docPrefix = doctor.fullName.substring(0, 3).toUpperCase();
      const usedInts = new Set<number>();
      const existingByNum = new Map<number, any>();
      existingTokens.forEach(t => {
        const match = t.tokenNumber.match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          usedInts.add(num);
          existingByNum.set(num, t);
        }
      });

      let nextSeq = 1;
      while (usedInts.has(nextSeq)) {
        const row = existingByNum.get(nextSeq);
        if (row && (row.status === "CANCELLED" || row.status === "NO_SHOW")) {
          return tx.appointment.update({
            where: { id: row.id },
            data: {
              patientId,
              doctorId,
              status: "CHECKED_IN",
              calledAt: null,
              completedAt: null,
              cancelledAt: null,
              checkedInAt: new Date(),
              bookedAt: new Date()
            },
            include: {
              Patient: true,
              User: { select: { fullName: true } }
            }
          });
        }
        nextSeq++;
      }

      if (usedInts.size >= maxWalkInCapacity) {
        throw new Error("Doctor's walk-in capacity reached for this date");
      }

      const tokenNumber = `${docPrefix}-${nextSeq.toString().padStart(2, "0")}`;

      return tx.appointment.create({
        data: {
          tokenNumber,
          patientId,
          doctorId,
          sessionId: session.id,
          appointmentDate: startOfDay,
          status: "CHECKED_IN",
        },
        include: {
          Patient: true,
          User: {
            select: { fullName: true }
          }
        }
      });
    });

    // Map to frontend expected format
    res.status(201).json({
      ...appointment,
      patient: appointment.Patient,
      doctor: appointment.User
    });
  } catch (error: any) {
    console.error("Error generating token:", error);
    if (error.message === "Doctor's walk-in capacity reached for today") {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getDoctorTodaySessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, date } = req.query;

    if (!doctorId) {
      res.status(400).json({ error: "doctorId query parameter is required" });
      return;
    }

    const targetDate = date ? new Date(date as string) : new Date();
    const { startOfDay, endOfDay, dayOfWeek } = getTimezoneBoundaries(targetDate);

    // Fetch active schedule sessions for doctor for this dayOfWeek
    const sessions = await prisma.doctorScheduleSession.findMany({
      where: {
        schedule: {
          doctorId: doctorId as string,
          validFrom: { lte: endOfDay },
          OR: [
            { validUntil: null },
            { validUntil: { gte: startOfDay } }
          ]
        },
        dayOfWeek: dayOfWeek,
        isActive: true
      },
      include: {
        room: true
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    // Current Colombo time string HH:MM
    const colomboFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Colombo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const currentColomboTime = colomboFormatter.format(new Date());

    // Aggregate appointment counts for each session today
    const sessionsWithCounts = await Promise.all(
      sessions.map(async (sess) => {
        const counts = await prisma.appointment.groupBy({
          by: ['status'],
          where: {
            sessionId: sess.id,
            appointmentDate: { gte: startOfDay, lte: endOfDay }
          },
          _count: { id: true }
        });

        let booked = 0;
        let completed = 0;
        let cancelled = 0;

        counts.forEach(c => {
          if (c.status === 'COMPLETED' || c.status === 'PRESCRIPTION_ISSUED') {
            completed += c._count.id;
          } else if (c.status === 'CANCELLED' || c.status === 'NO_SHOW') {
            cancelled += c._count.id;
          } else {
            booked += c._count.id;
          }
        });

        const isCurrent = currentColomboTime >= sess.startTime && currentColomboTime <= sess.endTime;
        const isPast = currentColomboTime > sess.endTime;
        const isUpcoming = currentColomboTime < sess.startTime;

        return {
          id: sess.id,
          sessionName: sess.sessionName || `${sess.startTime} - ${sess.endTime}`,
          startTime: sess.startTime,
          endTime: sess.endTime,
          roomNumber: sess.room?.roomNumber || "N/A",
          roomName: sess.room?.description || sess.room?.roomNumber || "",
          tokenCapacity: sess.tokenCapacity,
          bookedCount: booked,
          completedCount: completed,
          cancelledCount: cancelled,
          totalAppointments: booked + completed,
          isCurrent,
          isPast,
          isUpcoming
        };
      })
    );

    res.status(200).json({
      success: true,
      currentColomboTime,
      sessions: sessionsWithCounts
    });
  } catch (error) {
    console.error("Error fetching doctor today sessions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getDoctorQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const { doctorId, sessionId } = req.query;

    if (!doctorId) {
      res.status(400).json({ error: "doctorId query parameter is required" });
      return;
    }

    const { startOfDay, endOfDay } = getTimezoneBoundaries();

    const whereClause: any = {
      doctorId: doctorId as string,
      appointmentDate: { gte: startOfDay, lte: endOfDay },
      status: { in: ['BOOKED', 'WAITING', 'WAITING_FOR_LAB_TEST', 'IN_PROGRESS'] }
    };

    if (sessionId && sessionId !== "ALL") {
      whereClause.sessionId = sessionId as string;
    }

    // Query tokens scheduled for today with session isolation
    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        Patient: true,
        Session: {
          include: {
            room: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Map to frontend expected format
    const mappedTokens = appointments.map(app => ({
      ...app,
      patient: app.Patient
    }));

    res.status(200).json(mappedTokens);
  } catch (error) {
    console.error("Error fetching doctor queue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateTokenStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId, doctorId, status } = req.body;

    if (!patientId || !doctorId || !status) {
      res.status(400).json({ error: "Please provide patientId, doctorId, and status" });
      return;
    }

    const ALLOWED_STATUSES = ['BOOKED', 'CHECKED_IN', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'WAITING_FOR_LAB_TEST'];
    if (!ALLOWED_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status '${status}'. Must be one of: ${ALLOWED_STATUSES.join(', ')}` });
      return;
    }

    const appointment = await prisma.appointment.findFirst({
      where: {
        patientId: patientId,
        doctorId: doctorId,
        status: { in: ['BOOKED', 'WAITING', 'WAITING_FOR_LAB_TEST', 'IN_PROGRESS'] }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!appointment) {
      res.status(404).json({ error: "No active token found for this patient and doctor." });
      return;
    }

    const isCompleted = status === "COMPLETED";
    const updateData: any = { status };
    if (isCompleted) {
      updateData.completedAt = new Date();
    }

    const updatedApp = await prisma.appointment.update({
      where: { id: appointment.id },
      data: updateData,
      include: {
        User: true,
        Patient: true
      }
    });

    if (isCompleted) {
      recordCompletedConsultationInDailySheet(appointment.id).catch((e) =>
        console.error("Error auto-recording daily sheet for appointment:", e)
      );
    }

    websocketService.broadcast("TOKEN_STATUS_UPDATED", updatedApp);

    res.status(200).json(updatedApp);
  } catch (error) {
    console.error("Error updating token status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPendingPrescriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startOfDay, endOfDay } = getTimezoneBoundaries();

    const appointments = await prisma.appointment.findMany({
      where: {
        status: "prescription_issued",
        appointmentDate: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      include: {
        Patient: true,
        User: {
          select: { fullName: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    const mappedTokens = appointments.map(app => ({
      ...app,
      patient: app.Patient,
      doctor: app.User
    }));

    res.status(200).json(mappedTokens);
  } catch (error) {
    console.error("Error fetching pending prescriptions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
