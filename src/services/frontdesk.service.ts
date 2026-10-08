import { prisma } from '../lib/prisma.js';
import { websocketService } from './websocket.service.js';
import { NotificationService } from './notification.service.js';
import { billingService } from './billing.service.js';
import { generateMRN } from '../utils/mrn.util.js';

export class FrontdeskService {
  // 1. Get Doctor Status & Sessions for a given date
  async getDoctorsStatus(dateString: string) {
    // If dateString contains a T (ISO string), split it to get the local date part,
    // otherwise just use it directly. This avoids UTC timezone shift bugs.
    const localDateStr = dateString.includes('T') ? dateString.split('T')[0] : dateString;
    
    // Parse it as a local date by appending T00:00:00
    const targetDate = new Date(`${localDateStr}T00:00:00`);
    const startOfDay = new Date(targetDate);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const dayOfWeek = startOfDay.getDay(); // 0=Sun, 1=Mon...

    // Find all doctors
    const doctors = await prisma.user.findMany({
      where: { Role: { name: 'Doctor' }, isActive: true },
      select: { id: true, fullName: true, specialty: true, title: true, roomNumber: true }
    });

    // Find today's attendance records
    const attendance = await prisma.doctorAttendance.findMany({
      where: {
        date: { gte: startOfDay, lte: endOfDay }
      }
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
          where: { dayOfWeek, isActive: true }
        }
      }
    });

    // Find ongoing tokens
    const ongoingTokens = await prisma.appointment.findMany({
      where: {
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: 'CONSULTATION'
      },
      select: { doctorId: true, tokenNumber: true }
    });

    return doctors.map((doc: any) => {
      const docAttendance = attendance.find((a: any) => a.doctorId === doc.id);
      const docSchedule = schedules.find((s: any) => s.doctorId === doc.id);
      const currentToken = ongoingTokens.find((t: any) => t.doctorId === doc.id);
      
      return {
        ...doc,
        roomNumber: docAttendance?.roomNumber || doc.roomNumber,
        attendance: docAttendance || null,
        sessions: docSchedule?.sessions || [],
        currentlyServing: currentToken ? currentToken.tokenNumber : null
      };
    });
  }

  // 2. Update Doctor Attendance
  async updateDoctorAttendance(doctorId: string, status: string, roomNumber: string | null, userId: string, forceExit: boolean = false, dateString?: string) {
    const targetDate = dateString ? new Date(`${dateString.includes('T') ? dateString.split('T')[0] : dateString}T00:00:00`) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    let attendance = await prisma.doctorAttendance.findFirst({
      where: { doctorId, date: { gte: startOfDay, lte: endOfDay } }
    });

    if (status === 'COMPLETED' || status === 'LEFT') {
      const pendingApts = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: { in: ['BOOKED', 'ARRIVED', 'CONSULTATION'] }
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
              status: { in: ['BOOKED', 'ARRIVED', 'CONSULTATION'] }
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
          roomNumber: roomNumber || attendance.roomNumber,
          arrivedAt: status === 'ARRIVED' && !attendance.arrivedAt ? new Date() : attendance.arrivedAt,
          leftAt: status === 'COMPLETED' ? new Date() : attendance.leftAt
        }
      });
    } else {
      attendance = await prisma.doctorAttendance.create({
        data: {
          doctorId,
          status,
          roomNumber,
          date: targetDate,
          arrivedAt: status === 'ARRIVED' ? new Date() : null
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
        sessions: { where: { isActive: true } },
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

  // 5. Walk-in Registration
  async createWalkIn(doctorId: string, sessionId: string, patientData: any, userId: string) {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

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

    // Create or find patient (assuming patientData has name, phone)
    let patient = await prisma.patient.findFirst({ where: { phone: patientData.phone } });
    if (!patient) {
      const patientId = await generateMRN(prisma);
      patient = await prisma.patient.create({
        data: {
          patientId,
          fullName: patientData.fullName || `${patientData.firstName} ${patientData.lastName || ''}`.trim(),
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
    while (retries < 3) {
      try {
        // Find next available token across ALL bookings for the session (Phone + Walk-in)
        const existing = await prisma.appointment.findMany({
          where: { sessionId, appointmentDate: startOfDay },
          orderBy: { tokenNumber: 'desc' }
        });
        
        let nextTokenNumberStr = "";
        const bookedNums = new Set(existing.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
        let nextAvailable = 1;
        while (bookedNums.has(nextAvailable) && nextAvailable <= session.tokenCapacity) {
          nextAvailable++;
        }
        
        if (nextAvailable > session.tokenCapacity) {
          throw new Error("No slots available for this date");
        }
        nextTokenNumberStr = nextAvailable.toString().padStart(2, "0");

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
        break; // Success, exit loop
      } catch (error: any) {
        if (error.code === 'P2002' && retries < 2) {
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
    const { isRecurring, date, days, startTime, endTime, room, type, tokenLimit, interval } = scheduleData;
    
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
            tokenCapacity: tokenLimit
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

    return schedule;
  }

  // 8. Session Management
  async updateSession(sessionId: string, data: any, userId: string) {
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

    return exception;
  }

  async deleteSession(sessionId: string, userId: string) {
    await prisma.doctorScheduleSession.delete({
      where: { id: sessionId }
    });
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
}
