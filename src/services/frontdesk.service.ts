import { prisma } from '../lib/prisma.js';
import { websocketService } from './websocket.service.js';
import { NotificationService } from './notification.service.js';
import { billingService } from './billing.service.js';
import { generateMRN } from '../utils/mrn.util.js';
import { generateIdentityKey } from '../utils/identity.util.js';
import { getTimezoneBoundaries } from '../lib/dateUtils.js';
import { sortDoctorsWithOpdFirst } from '../utils/doctor-utils.js';

export class FrontdeskService {
  // 1. Get Doctor Status & Sessions for a given date
  async getDoctorsStatus(dateString: string) {
    // If dateString contains a T (ISO string), split it to get the local date part,
    // otherwise just use it directly. This avoids UTC timezone shift bugs.
    const localDateStr = dateString.includes('T') ? dateString.split('T')[0] : dateString;
    
    // Parse it as a local date by appending T00:00:00
    const targetDate = new Date(`${localDateStr}T00:00:00`);
    const { startOfDay, endOfDay, dayOfWeek } = getTimezoneBoundaries(targetDate);

    // Find all doctors
    const doctors = await prisma.user.findMany({
      where: { Role: { name: 'Doctor' }, isActive: true },
      select: { id: true, fullName: true, specialty: true, title: true, room: true }
    });

    // Find today's attendance records
    const attendance = await prisma.doctorAttendance.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay }
      },
      include: { room: true }
    });

    // Find today's schedules (sessions matching dayOfWeek, or active overrides)
    // For simplicity, we just look up schedules and matching sessions
    const schedules = await prisma.doctorSchedule.findMany({
      where: {
        validFrom: { lte: endOfDay },
        OR: [{ validUntil: null }, { validUntil: { gte: startOfDay } }]
      },
      include: {
        sessions: {
          where: { dayOfWeek, isActive: true },
          include: { room: true }
        }
      }
    });

    // Find ongoing or recently completed tokens
    const ongoingTokens = await prisma.appointment.findMany({
      where: {
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ['IN_PROGRESS', 'COMPLETED'] }
      },
      select: { doctorId: true, tokenNumber: true, status: true, sessionId: true },
      orderBy: { updatedAt: 'desc' }
    });

    const mapped = doctors.map((doc: any) => {
      const docAttendance = attendance.find((a: any) => a.doctorId === doc.id);
      const docSchedule = schedules.find((s: any) => s.doctorId === doc.id);
      
      const docTokens = ongoingTokens.filter((t: any) => t.doctorId === doc.id);
      const currentToken = docTokens.find((t: any) => t.status === 'IN_PROGRESS') || docTokens[0];
      
      return {
        ...doc,
        roomId: docAttendance?.roomId || doc.roomId || null,
        roomNumber: docAttendance?.room?.roomNumber || doc.room?.roomNumber || null,
        attendance: docAttendance || null,
        sessions: docSchedule?.sessions || [],
        currentSessionId: currentToken?.sessionId || null,
        currentlyServing: currentToken ? (currentToken.tokenNumber.includes('-') ? parseInt(currentToken.tokenNumber.split('-')[1] || "0", 10) : currentToken.tokenNumber) : null
      };
    });

    return sortDoctorsWithOpdFirst(mapped);
  }

  // 2. Update Doctor Attendance
  async updateDoctorAttendance(doctorId: string, status: string, roomId: string | null, userId: string, forceExit: boolean = false, dateString?: string, startTime?: string, endTime?: string) {
    const targetDate = dateString ? new Date(`${dateString.includes('T') ? dateString.split('T')[0] : dateString}T00:00:00`) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const dayOfWeek = startOfDay.getDay();

    let attendance = await prisma.doctorAttendance.findFirst({
      where: { doctorId, date: { gte: startOfDay, lte: endOfDay } }
    });

    // Auto-resolve roomId if not explicitly provided
    let effectiveRoomId = roomId;
    if (!effectiveRoomId) {
      const activeSchedule = await prisma.doctorSchedule.findFirst({
        where: {
          doctorId,
          validFrom: { lte: endOfDay },
          OR: [{ validUntil: null }, { validUntil: { gte: startOfDay } }],
          sessions: {
            some: { dayOfWeek, isActive: true, roomId: { not: null } }
          }
        },
        include: {
          sessions: {
            where: { dayOfWeek, isActive: true, roomId: { not: null } }
          }
        }
      });
      if (activeSchedule?.sessions?.[0]?.roomId) {
        effectiveRoomId = activeSchedule.sessions[0].roomId;
      } else {
        const docUser = await prisma.user.findUnique({
          where: { id: doctorId },
          select: { roomId: true }
        });
        if (docUser?.roomId) {
          effectiveRoomId = docUser.roomId;
        }
      }
    }

    if (status === 'COMPLETED' || status === 'LEFT') {
      const pendingApts = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] }
        },
        include: { Patient: true, User: true }
      });
      
      if (pendingApts.length > 0) {
        if (!forceExit) {
          throw new Error(`Cannot mark out. There are ${pendingApts.length} patients still waiting or in consultation.`);
        } else {
          // Update stranded tokens to CANCELLED
          await prisma.appointment.updateMany({
            where: {
              doctorId,
              appointmentDate: { gte: startOfDay, lte: endOfDay },
              status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] }
            },
            data: { status: 'CANCELLED' }
          });

          // Handle automated refunds for prepaid appointments and send SMS
          const aptIds = pendingApts.map(apt => apt.id);
          const invoices = await prisma.invoice.findMany({
            where: { visitId: { in: aptIds }, status: 'PAID' },
            include: { payments: true }
          });
          const invoiceMap = new Map(invoices.map(inv => [inv.visitId, inv]));

          for (const apt of pendingApts) {
            const invoice = invoiceMap.get(apt.id);
            
            if (invoice) {
              for (const p of invoice.payments) {
                if (p.status === "COMPLETED") {
                  try {
                    await billingService.processRefund(p.id, p.amount, `Doctor left early`);
                  } catch (err) {
                    console.error(`Failed to process refund for payment ${p.id}:`, err);
                  }
                }
              }
            }

            if (apt.Patient?.phone) {
              NotificationService.sendTemplatedSMS(
                apt.patientId,
                apt.Patient.phone,
                'SESSION_CANCELLED',
                {
                  patientName: apt.Patient.fullName,
                  doctorName: apt.User?.fullName || 'Doctor',
                  date: targetDate.toLocaleDateString(),
                  reason: 'Doctor had to leave early due to an emergency.',
                  hospitalName: "AMAZ Hospital"
                }
              ).catch(console.error);
            }
          }
        }
      }
    }

    if (attendance) {
      attendance = await prisma.doctorAttendance.update({
        where: { id: attendance.id },
        data: { 
          status, 
          roomId: effectiveRoomId || attendance.roomId,
          arrivedAt: status === 'ARRIVED' && !attendance.arrivedAt ? new Date() : attendance.arrivedAt,
          leftAt: status === 'COMPLETED' ? new Date() : attendance.leftAt,
          expectedStartTime: startTime || attendance.expectedStartTime,
          expectedEndTime: endTime || attendance.expectedEndTime
        }
      });
    } else {
      attendance = await prisma.doctorAttendance.create({
        data: {
          doctorId,
          status,
          roomId: effectiveRoomId,
          date: targetDate,
          arrivedAt: status === 'ARRIVED' ? new Date() : null,
          expectedStartTime: startTime || null,
          expectedEndTime: endTime || null
        }
      });
    }


    if (status === 'ARRIVED') {
      try {
        await NotificationService.triggerDoctorArrived(doctorId, new Date());
      } catch (err) {
        console.error("Failed to send doctor arrived SMS notifications:", err);
      }
    }

    // Log Activity
    await prisma.activityLog.create({
      data: {
        entityType: 'DoctorAttendance',
        entityId: attendance.id,
        action: `MARKED_${status}`,
        description: `Doctor attendance updated to ${status}`,
        userId
      }
    });

    // Notify clients via WebSocket
    websocketService.broadcast('DOCTOR_ATTENDANCE_UPDATED', attendance);
    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'DOCTOR_ATTENDANCE_UPDATED', attendance });

    return attendance;
  }

  // 2b. Get Monthly Calendar Aggregation
  async getDoctorCalendar(doctorId: string, month: string) {
    // month format: YYYY-MM
    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const nextMonth = new Date(startDate);
    nextMonth.setMonth(startDate.getMonth() + 1);

    const schedules = await prisma.doctorSchedule.findMany({
      where: {
        doctorId,
        validFrom: { lt: nextMonth },
        OR: [{ validUntil: null }, { validUntil: { gte: startDate } }]
      },
      include: {
        sessions: { where: { isActive: true }, include: { room: true } },
        exceptions: {
          where: { exceptionDate: { gte: startDate, lt: nextMonth } }
        },
        leaves: {
          where: {
            OR: [
              { startDate: { gte: startDate, lt: nextMonth } },
              { endDate: { gte: startDate, lt: nextMonth } },
              { startDate: { lt: startDate }, endDate: { gte: nextMonth } }
            ]
          }
        }
      }
    });

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: { gte: startDate, lt: nextMonth },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      },
      select: { appointmentDate: true, sessionId: true, status: true }
    });

    // Instead of doing day-by-day mapping in the backend, we return the raw sessions/exceptions/appointments
    // so the frontend can quickly loop days of month
    return { schedules, bookedAppointments: appointments };
  }

  // 3. Get Token Matrix for a Session
  async getSessionTokens(sessionId: string, dateString: string) {
    const targetDate = new Date(dateString);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const session = await prisma.doctorScheduleSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) throw new Error('Session not found');

    const appointments = await prisma.appointment.findMany({
      where: {
        sessionId,
        appointmentDate: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        Patient: true
      }
    });

    // Create a matrix of size `tokenCapacity`
    const tokens = [];
    for (let i = 1; i <= session.tokenCapacity; i++) {
      const tokenStr = i.toString().padStart(2, "0");
      const apt = appointments.find((a: any) => a.tokenNumber === tokenStr);
      tokens.push({
        tokenNumber: tokenStr,
        status: apt ? apt.status : 'AVAILABLE',
        appointment: apt || null
      });
    }

    return tokens;
  }

  // 4. Update Token / Appointment Status
  async updateAppointmentStatus(appointmentId: string, status: string, userId: string) {
    const apt = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: { Patient: true, User: true }
    });

    // Log Activity
    await prisma.activityLog.create({
      data: {
        entityType: 'Appointment',
        entityId: appointmentId,
        action: `STATUS_CHANGED_TO_${status}`,
        description: `Token #${apt.tokenNumber} marked as ${status}`,
        userId
      }
    });

    // Notify clients via WebSocket
    websocketService.broadcast('TOKEN_STATUS_UPDATED', { sessionId: apt.sessionId, appointment: apt });

    return apt;
  }

  // 4.1 Cancel Appointment
  async cancelAppointment(appointmentId: string, reason: string, notes?: string, userId?: string) {
    const apt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        Patient: true,
        User: true,
        Payment: true
      }
    });

    if (!apt) throw new Error("Appointment not found");

    const effectiveReason = reason ? `${reason}${notes ? ` - ${notes}` : ''}` : (notes || "Cancelled by Front Desk");

    const updatedApt = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: effectiveReason
      },
      include: { Patient: true, User: true }
    });

    // Check if there was an invoice / payment for this appointment / visit
    let wasPaid = false;
    let invoiceId: string | null = null;
    let paidAmount = 0;

    const inv = await prisma.invoice.findFirst({
      where: {
        OR: [
          { visitId: appointmentId },
          ...(apt.bookingReference ? [{ visitId: apt.bookingReference }] : [])
        ],
        status: "PAID"
      },
      include: { payments: true }
    });

    if (inv) {
      wasPaid = true;
      invoiceId = inv.id;
      paidAmount = inv.totalAmount;
    } else if (apt.Payment && apt.Payment.status === "COMPLETED") {
      wasPaid = true;
      invoiceId = apt.Payment.invoiceId;
      paidAmount = apt.Payment.amount;
    }

    if (userId) {
      try {
        await prisma.activityLog.create({
          data: {
            entityType: 'Appointment',
            entityId: appointmentId,
            action: 'APPOINTMENT_CANCELLED',
            description: `Token #${apt.tokenNumber} cancelled: ${effectiveReason}`,
            userId
          }
        });
      } catch (logErr) {
        console.warn("Could not log activity for cancelAppointment:", logErr);
      }
    }

    // Notify clients via WebSocket
    websocketService.broadcast('TOKEN_STATUS_UPDATED', { sessionId: apt.sessionId, appointment: updatedApt });
    websocketService.broadcast('APPOINTMENT_CANCELLED', { appointmentId, tokenNumber: apt.tokenNumber });

    return {
      success: true,
      appointment: updatedApt,
      wasPaid,
      invoiceId,
      paidAmount
    };
  }

  // 5. Walk-in Registration
  async createWalkIn(doctorId: string, sessionId: string, patientData: any, userId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const { startOfDay, endOfDay } = getTimezoneBoundaries(targetDate);

    // Fetch session to check walk-in capacity
    const session = await prisma.doctorScheduleSession.findUnique({
      where: { id: sessionId }
    });
    if (!session) throw new Error('Session not found');

    const totalBookedCount = await prisma.appointment.count({
      where: {
        sessionId,
        appointmentDate: startOfDay,
        status: { notIn: ["CANCELLED", "NO_SHOW"] }
      }
    });

    if (totalBookedCount >= session.tokenCapacity) {
      throw new Error("Walk-in slots are fully booked for this session");
    }

    // Create or find patient (multi-tenant safe)
    const effectiveName = patientData.fullName || `${patientData.firstName || ''} ${patientData.lastName || ''}`.trim() || 'Walk-in Patient';
    const identityKey = generateIdentityKey(effectiveName, patientData.phone);
    let patient = patientData.id
      ? await prisma.patient.findUnique({ where: { id: patientData.id } })
      : (identityKey ? await prisma.patient.findUnique({ where: { identityKey } }) : null);

    if (!patient && patientData.phone) {
      patient = await prisma.patient.findFirst({
        where: {
          phone: patientData.phone,
          fullName: { equals: effectiveName, mode: 'insensitive' }
        }
      });
    }

    if (!patient) {
      const patientId = await generateMRN(prisma);
      patient = await prisma.patient.create({
        data: {
          patientId,
          identityKey: identityKey || null,
          fullName: effectiveName,
          phone: patientData.phone,
          dateOfBirth: patientData.dateOfBirth ? new Date(patientData.dateOfBirth) : new Date(),
          gender: patientData.gender || 'OTHER',
          bloodGroup: 'UNKNOWN',
          address: 'Walk-in'
        }
      });
    }

    let apt;
    let retries = 0;
    while (retries < 5) {
      try {
        // Find next available token across ALL bookings for the session (Phone + Walk-in)
        const existing = await prisma.appointment.findMany({
          where: { sessionId, appointmentDate: { gte: startOfDay, lte: endOfDay } }
        });
        
        const existingByNum = new Map<number, any>();
        const bookedNums = new Set<number>();
        existing.forEach(t => {
          const num = parseInt(t.tokenNumber.replace(/\D/g, ''), 10);
          if (!isNaN(num)) {
            bookedNums.add(num);
            existingByNum.set(num, t);
          }
        });

        let nextAvailable = 1;
        while (bookedNums.has(nextAvailable) && nextAvailable <= session.tokenCapacity) {
          const row = existingByNum.get(nextAvailable);
          if (row && (row.status === "CANCELLED" || row.status === "NO_SHOW")) {
            // Can recycle this slot
            break;
          }
          nextAvailable++;
        }
        
        if (nextAvailable > session.tokenCapacity) {
          throw new Error("No slots available for this date");
        }
        const nextTokenNumberStr = nextAvailable.toString().padStart(2, "0");

        const existingSlot = existingByNum.get(nextAvailable);
        if (existingSlot && (existingSlot.status === "CANCELLED" || existingSlot.status === "NO_SHOW")) {
          apt = await prisma.appointment.update({
            where: { id: existingSlot.id },
            data: {
              doctorId,
              patientId: patient.id,
              status: 'BOOKED',
              bookingType: 'WALK_IN',
              calledAt: null,
              completedAt: null,
              cancelledAt: null,
              checkedInAt: null,
              bookedAt: new Date()
            }
          });
        } else {
          apt = await prisma.appointment.create({
            data: {
              doctorId,
              patientId: patient.id,
              sessionId,
              tokenNumber: nextTokenNumberStr,
              appointmentDate: startOfDay,
              status: 'BOOKED', // Walk-ins start as BOOKED until they pay at Cashier
              bookingType: 'WALK_IN'
            }
          });
        }
        break; // Success, exit loop
      } catch (error: any) {
        if ((error.code === 'P2002' || error.message?.includes("Unique constraint failed")) && retries < 4) {
          retries++;
          continue; // Retry on token collision
        }
        throw error;
      }
    }
    
    if (!apt) throw new Error("Failed to create appointment after retries.");

    await prisma.activityLog.create({
      data: {
        entityType: 'Appointment',
        entityId: apt.id,
        action: `WALK_IN_CREATED`,
        description: `Walk-in Token #${apt.tokenNumber} generated for ${patient.fullName}`,
        userId
      }
    });

    // Notify clients via WebSocket
    websocketService.broadcast('TOKEN_STATUS_UPDATED', { sessionId: apt.sessionId, appointment: apt });

    return apt;
  }

  // 6. Get Activity Log
  async getActivityLog(dateString: string) {
    const targetDate = new Date(dateString);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    return await prisma.activityLog.findMany({
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay }
      },
      include: {
        user: { select: { fullName: true, roleId: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // 7. Create Doctor Schedule (with Conflict Check)
  async createDoctorSchedule(doctorId: string, scheduleData: any, userId: string) {
    const { isRecurring, date, days, startTime, endTime, roomId, type, tokenLimit, interval } = scheduleData;
    
    // Mapping 'Mon', 'Tue' to numbers
    const dayMap: Record<string, number> = { 'Sun':0, 'Mon':1, 'Tue':2, 'Wed':3, 'Thu':4, 'Fri':5, 'Sat':6 };
    const numericDays = isRecurring && days ? days.map((d: string) => dayMap[d]) : [new Date(date).getDay()];

    // Strict Conflict Check against database
    const existingSessions = await prisma.doctorScheduleSession.findMany({
      where: {
        schedule: { doctorId },
        dayOfWeek: { in: numericDays },
        isActive: true
      },
      include: { schedule: true }
    });

    for (const session of existingSessions) {
      // String time comparison works well for HH:mm format (e.g. "08:00" < "12:00")
      if (startTime < session.endTime && endTime > session.startTime) {
        const dayNames = Object.keys(dayMap);
        const dayStr = dayNames.find(key => dayMap[key] === session.dayOfWeek);
        throw new Error(`Doctor already has an overlapping schedule on ${dayStr} from ${session.startTime} to ${session.endTime}.`);
      }
    }

    if (roomId) {
      const roomSessions = await prisma.doctorScheduleSession.findMany({
        where: {
          roomId: roomId,
          dayOfWeek: { in: numericDays },
          isActive: true
        },
        include: { schedule: { include: { doctor: true } } }
      });
      for (const session of roomSessions) {
        if (startTime < session.endTime && endTime > session.startTime) {
          const dayNames = Object.keys(dayMap);
          const dayStr = dayNames.find(key => dayMap[key] === session.dayOfWeek);
          throw new Error(`Room is already booked by Dr. ${session.schedule.doctor.fullName} on ${dayStr} from ${session.startTime} to ${session.endTime}.`);
        }
      }
    }

    // Handle local date parsing safely
    const localDateStr = date.includes('T') ? date.split('T')[0] : date;
    const scheduleDate = new Date(`${localDateStr}T00:00:00`);
    let validFrom = new Date(scheduleDate);

    let validUntil = isRecurring 
      ? new Date(`${(scheduleData.until || '2099-12-31').split('T')[0]}T00:00:00`) 
      : new Date(scheduleDate);
    
    validUntil.setHours(23, 59, 59, 999);

    const schedule = await prisma.doctorSchedule.create({
      data: {
        doctorId,
        validFrom: validFrom,
        validUntil: validUntil,
        sessions: {
          create: numericDays.map((day: number) => ({
            dayOfWeek: day,
            sessionName: type || 'General Consultation',
            startTime,
            endTime,
            tokenCapacity: tokenLimit,
            roomId: roomId || undefined
          }))
        }
      }
    });

    await prisma.activityLog.create({
      data: {
        entityType: 'DoctorSchedule',
        entityId: schedule.id,
        action: `SCHEDULE_CREATED`,
        description: `Created ${isRecurring ? 'recurring' : 'single'} schedule for ${type}`,
        userId
      }
    });

    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'SCHEDULE_CREATED', scheduleId: schedule.id });

    return schedule;
  }

  // 8. Session Management
  async updateSession(sessionId: string, data: any, userId: string) {
    const existing = await prisma.doctorScheduleSession.findUnique({
      where: { id: sessionId },
      include: { schedule: true }
    });
    if (!existing) throw new Error("Session not found");

    const startTime = data.startTime || existing.startTime;
    const endTime = data.endTime || existing.endTime;
    const roomId = data.roomId !== undefined ? data.roomId : existing.roomId;
    
    const dayMap: Record<string, number> = { 'Sun':0, 'Mon':1, 'Tue':2, 'Wed':3, 'Thu':4, 'Fri':5, 'Sat':6 };
    const dayNames = Object.keys(dayMap);
    
    // Check doctor overlap
    const existingSessions = await prisma.doctorScheduleSession.findMany({
      where: {
        schedule: { doctorId: existing.schedule.doctorId },
        dayOfWeek: existing.dayOfWeek,
        isActive: true,
        id: { not: sessionId }
      },
      include: { schedule: true }
    });
    
    for (const sess of existingSessions) {
      if (startTime < sess.endTime && endTime > sess.startTime) {
        const dayStr = dayNames.find(key => dayMap[key] === sess.dayOfWeek);
        throw new Error(`Doctor already has an overlapping schedule on ${dayStr} from ${sess.startTime} to ${sess.endTime}.`);
      }
    }

    // Check room overlap
    if (roomId) {
      const roomSessions = await prisma.doctorScheduleSession.findMany({
        where: {
          roomId: roomId,
          dayOfWeek: existing.dayOfWeek,
          isActive: true,
          id: { not: sessionId }
        },
        include: { schedule: { include: { doctor: true } } }
      });
      for (const sess of roomSessions) {
        if (startTime < sess.endTime && endTime > sess.startTime) {
          const dayStr = dayNames.find(key => dayMap[key] === sess.dayOfWeek);
          throw new Error(`Room is already booked by Dr. ${sess.schedule.doctor.fullName} on ${dayStr} from ${sess.startTime} to ${sess.endTime}.`);
        }
      }
    }

    const session = await prisma.doctorScheduleSession.update({
      where: { id: sessionId },
      data
    });

    await prisma.activityLog.create({
      data: {
        entityType: 'DoctorScheduleSession',
        entityId: session.id,
        action: `SESSION_UPDATED`,
        description: `Updated session ${session.sessionName}`,
        userId
      }
    });

    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'SESSION_UPDATED', sessionId: session.id });

    return session;
  }

  async cancelSession(sessionId: string, date: string, reason: string, userId: string) {
    const session = await prisma.doctorScheduleSession.findUnique({
      where: { id: sessionId },
      include: { schedule: true }
    });

    if (!session) throw new Error('Session not found');

    const exception = await prisma.doctorScheduleException.create({
      data: {
        scheduleId: session.scheduleId,
        exceptionDate: new Date(date),
        isUnavailable: true,
        reason: reason
      }
    });

    // Also cancel all pending appointments for this session on this date
    const startOfDay = new Date(new Date(date).setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date(date).setHours(23, 59, 59, 999));

    const pendingApts = await prisma.appointment.findMany({
      where: {
        sessionId,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { notIn: ['COMPLETED', 'CANCELLED'] }
      },
      include: { Patient: true, User: true }
    });

    await prisma.appointment.updateMany({
      where: {
        sessionId,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { notIn: ['COMPLETED', 'CANCELLED'] }
      },
      data: { status: 'CANCELLED' }
    });

    // Handle automated refunds for prepaid appointments
    const aptIds = pendingApts.map(apt => apt.id);
    const invoices = await prisma.invoice.findMany({
      where: { visitId: { in: aptIds }, status: 'PAID' },
      include: { payments: true }
    });
    const invoiceMap = new Map(invoices.map(inv => [inv.visitId, inv]));

    for (const apt of pendingApts) {
      const invoice = invoiceMap.get(apt.id);
      
      if (invoice) {
        for (const p of invoice.payments) {
          if (p.status === "COMPLETED") {
            try {
              await billingService.processRefund(p.id, p.amount, `Session cancelled by hospital (Reason: ${reason})`);
            } catch (err) {
              console.error(`Failed to process refund for payment ${p.id}:`, err);
            }
          }
        }
      }
    }

    // Dispatch SMS asynchronously
    for (const apt of pendingApts) {
      if (apt.Patient?.phone) {
        NotificationService.sendTemplatedSMS(
          apt.patientId,
          apt.Patient.phone,
          'SESSION_CANCELLED',
          {
            patientName: apt.Patient.fullName,
            doctorName: apt.User?.fullName || 'Doctor',
            date: date,
            reason: reason,
            hospitalName: "AMAZ Hospital"
          }
        ).catch(console.error);
      }
    }

    await prisma.activityLog.create({
      data: {
        entityType: 'DoctorScheduleException',
        entityId: exception.id,
        action: `SESSION_CANCELLED`,
        description: `Cancelled session ${session.sessionName} on ${date}. Reason: ${reason}`,
        userId
      }
    });

    // Notify clients to refresh
    websocketService.broadcast('SESSION_CANCELLED', { sessionId, date, reason });
    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'SESSION_CANCELLED', sessionId, date });

    return exception;
  }

  async deleteSession(sessionId: string, userId: string) {
    await prisma.doctorScheduleSession.delete({
      where: { id: sessionId }
    });
    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'SESSION_DELETED', sessionId });
    return { success: true };
  }

  // 9. Doctor Leave Management
  async createDoctorLeave(scheduleId: string, startDate: string, endDate: string, reason: string) {
    const leave = await prisma.doctorLeave.create({
      data: {
        scheduleId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason
      }
    });
    return leave;
  }

  async getDoctorLeaves(doctorId: string) {
    return prisma.doctorLeave.findMany({
      where: {
        schedule: { doctorId }
      },
      orderBy: { startDate: 'desc' }
    });
  }

  async updateDoctorLeaveStatus(leaveId: string, status: string) {
    const leave = await prisma.doctorLeave.update({
      where: { id: leaveId },
      data: { status }
    });
    return leave;
  }

  // 10. Booking Management, Cancellation & Full Refund Service
  async searchBookingsForManagement(params: {
    search?: string;
    date?: string;
    doctorId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.date) {
      const { startOfDay, endOfDay } = getTimezoneBoundaries(params.date);
      where.appointmentDate = {
        gte: startOfDay,
        lte: endOfDay
      };
    }

    if (params.doctorId && params.doctorId !== 'ALL') {
      where.doctorId = params.doctorId;
    }

    if (params.status && params.status !== 'ALL') {
      if (params.status === 'ACTIVE') {
        where.status = { in: ['SCHEDULED', 'CONFIRMED', 'WAITING', 'IN_CONSULTATION'] };
      } else if (params.status === 'CANCELLED') {
        where.status = 'CANCELLED';
      } else if (params.status === 'COMPLETED') {
        where.status = 'COMPLETED';
      } else {
        where.status = params.status;
      }
    }

    if (params.search && params.search.trim()) {
      const term = params.search.trim();
      where.OR = [
        { tokenNumber: { contains: term, mode: 'insensitive' } },
        { bookingReference: { contains: term, mode: 'insensitive' } },
        { Patient: { fullName: { contains: term, mode: 'insensitive' } } },
        { Patient: { phone: { contains: term } } }
      ];
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ appointmentDate: 'desc' }, { tokenNumber: 'asc' }],
        include: {
          Patient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              gender: true,
              age: true,
              dateOfBirth: true
            }
          },
          User: {
            select: {
              id: true,
              fullName: true,
              specialty: true,
              title: true
            }
          },
          DoctorScheduleSession: {
            select: {
              id: true,
              sessionName: true,
              startTime: true,
              endTime: true
            }
          },
          Payment: {
            include: {
              refunds: true
            }
          }
        }
      }),
      prisma.appointment.count({ where })
    ]);

    // For each appointment, resolve invoice if direct Payment is not present
    const enriched = await Promise.all(
      appointments.map(async (apt) => {
        let paymentRecord = apt.Payment;
        let invoiceRecord: any = null;

        if (!paymentRecord) {
          const inv = await prisma.invoice.findFirst({
            where: {
              OR: [
                { visitId: apt.id },
                ...(apt.bookingReference ? [{ visitId: apt.bookingReference }] : [])
              ]
            },
            include: {
              payments: {
                include: { refunds: true }
              }
            }
          });
          if (inv) {
            invoiceRecord = inv;
            paymentRecord = inv.payments?.[0] || null;
          }
        }

        const totalPaid = paymentRecord?.amount || invoiceRecord?.totalAmount || 0;
        const totalRefunded = paymentRecord?.refunds?.reduce((sum: number, r: any) => sum + r.amount, 0) || 0;
        const refundableAmount = Math.max(0, totalPaid - totalRefunded);

        return {
          id: apt.id,
          tokenNumber: apt.tokenNumber,
          bookingReference: apt.bookingReference,
          appointmentDate: apt.appointmentDate,
          status: apt.status,
          cancellationReason: apt.cancellationReason,
          cancelledAt: apt.cancelledAt,
          createdAt: apt.createdAt,
          patient: apt.Patient,
          doctor: apt.User,
          session: apt.DoctorScheduleSession,
          payment: paymentRecord ? {
            id: paymentRecord.id,
            amount: paymentRecord.amount,
            method: paymentRecord.method,
            status: paymentRecord.status,
            refunds: paymentRecord.refunds
          } : null,
          invoice: invoiceRecord ? {
            id: invoiceRecord.id,
            status: invoiceRecord.status,
            totalAmount: invoiceRecord.totalAmount
          } : null,
          totalPaid,
          totalRefunded,
          refundableAmount,
          isRefunded: totalRefunded > 0 && refundableAmount === 0
        };
      })
    );

    return {
      appointments: enriched,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  async cancelAndRefundAppointment(
    appointmentId: string,
    options: {
      reason: string;
      notes?: string;
      processRefund?: boolean;
      refundAmount?: number;
      shiftId?: string;
      userId?: string;
    }
  ) {
    const apt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        Patient: true,
        User: true,
        Payment: {
          include: { refunds: true }
        }
      }
    });

    if (!apt) throw new Error("Appointment not found");

    const effectiveReason = options.reason ? `${options.reason}${options.notes ? ` - ${options.notes}` : ''}` : (options.notes || "Cancelled at Front Desk");

    // 1. Mark appointment as CANCELLED
    const updatedApt = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: effectiveReason
      },
      include: { Patient: true, User: true }
    });

    // 2. Resolve Payment / Invoice
    let paymentRecord = apt.Payment;
    let invoiceRecord: any = null;

    if (!paymentRecord) {
      invoiceRecord = await prisma.invoice.findFirst({
        where: {
          OR: [
            { visitId: appointmentId },
            ...(apt.bookingReference ? [{ visitId: apt.bookingReference }] : [])
          ]
        },
        include: {
          payments: {
            include: { refunds: true }
          }
        }
      });
      if (invoiceRecord && invoiceRecord.payments?.length > 0) {
        paymentRecord = invoiceRecord.payments[0];
      }
    }

    let refundRecord: any = null;
    let actualRefundAmount = 0;

    // 3. Process Financial Refund if requested and payment exists
    if (options.processRefund && paymentRecord && paymentRecord.status !== 'REFUNDED') {
      const alreadyRefunded = paymentRecord.refunds?.reduce((sum: number, r: any) => sum + r.amount, 0) || 0;
      const maxRefundable = Math.max(0, paymentRecord.amount - alreadyRefunded);

      if (maxRefundable > 0) {
        actualRefundAmount = options.refundAmount && options.refundAmount > 0
          ? Math.min(options.refundAmount, maxRefundable)
          : maxRefundable;

        refundRecord = await billingService.processRefund(
          paymentRecord.id,
          actualRefundAmount,
          `Booking Cancellation: ${effectiveReason}`,
          options.shiftId
        );
      }
    }

    if (options.userId) {
      try {
        await prisma.activityLog.create({
          data: {
            entityType: 'Appointment',
            entityId: appointmentId,
            action: 'APPOINTMENT_CANCEL_REFUND',
            description: `Token #${apt.tokenNumber} cancelled. Refunded: LKR ${actualRefundAmount}. Reason: ${effectiveReason}`,
            userId: options.userId
          }
        });
      } catch (logErr) {
        console.warn("Could not log activity for cancelAndRefundAppointment:", logErr);
      }
    }

    // Broadcast WebSocket updates
    websocketService.broadcast('TOKEN_STATUS_UPDATED', { sessionId: apt.sessionId, appointment: updatedApt });
    websocketService.broadcast('APPOINTMENT_CANCELLED', { appointmentId, tokenNumber: apt.tokenNumber });

    return {
      success: true,
      appointment: updatedApt,
      refund: refundRecord,
      refundedAmount: actualRefundAmount,
      reason: effectiveReason
    };
  }
}

