import { prisma, withRetry } from "../lib/prisma.js";
import { NotificationService } from "./notification.service.js";
import { websocketService } from "./websocket.service.js";
import { SMSService } from "./sms.service.js";

export class BookingService {
  static async getDoctors() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const doctors = await prisma.user.findMany({
        where: { Role: { name: "DOCTOR" }, isActive: true },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          roomNumber: true,
          consultationFee: true,
          feeType: true,
          DoctorAttendance: {
            where: {
              date: { gte: today, lt: tomorrow },
              status: { in: ["ARRIVED", "LEFT"] }
            },
            take: 1
          }
        }
      });

                  return doctors.map(doc => {
        const todayAttendance = doc.DoctorAttendance[0];
        return {
          id: doc.id,
          fullName: doc.fullName,
          specialty: doc.specialty,
          roomNumber: todayAttendance?.roomNumber || doc.roomNumber,
          consultationFee: doc.consultationFee,
          feeType: doc.feeType,
          expectedStartTime: todayAttendance?.expectedStartTime,
          expectedEndTime: todayAttendance?.expectedEndTime,
          isArrived: todayAttendance?.status === "ARRIVED",
          isLeft: todayAttendance?.status === "LEFT",
          arrivedAt: todayAttendance?.arrivedAt ? new Date(todayAttendance.arrivedAt).toISOString() : undefined,
          outTime: todayAttendance?.leftAt ? new Date(todayAttendance.leftAt).toISOString() : undefined
        };
      });
    });
  }

  static async getAvailability(doctorId: string, date: string) {
    return withRetry(async () => {
      const dayOfWeek = new Date(date).getDay();
      const targetDate = new Date(date);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const session = await prisma.doctorScheduleSession.findFirst({
        where: { 
          dayOfWeek, 
          isActive: true,
          schedule: {
            doctorId,
            validFrom: { lte: endOfDay },
            OR: [
              { validUntil: null },
              { validUntil: { gte: startOfDay } }
            ]
          }
        }
      });

      if (!session) {
        return { available: false, reason: "Doctor does not consult on this day", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Check for schedule exceptions (doctor modified or cancelled this specific day)
      const exception = await prisma.doctorScheduleException.findFirst({
        where: {
          scheduleId: session.scheduleId,
          exceptionDate: { gte: startOfDay, lte: endOfDay }
        }
      });

      if (exception?.isUnavailable) {
        return { available: false, reason: "Doctor has marked this day as unavailable", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Check for approved leave
      const onLeave = await prisma.doctorLeave.findFirst({
        where: {
          scheduleId: session.scheduleId,
          status: "APPROVED",
          startDate: { lte: targetDate },
          endDate: { gte: targetDate }
        }
      });

      if (onLeave) {
        return { available: false, reason: "Doctor is on approved leave", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Use exception capacity/times if specified
      const effectiveCapacity = exception?.newTokenCapacity ?? session.tokenCapacity;
      const effectiveStartTime = exception?.newStartTime ?? session.startTime;
      const effectiveEndTime = exception?.newEndTime ?? session.endTime;

      const existingTokens = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: {
            gte: startOfDay,
            lte: endOfDay
          },
          status: { notIn: ["CANCELLED", "NO_SHOW"] } // Don't count cancelled/no-show as booked
        },
        select: { tokenNumber: true, status: true }
      });

      // Normalize: token numbers are stored as zero-padded 3-char strings e.g. "001" or with prefixes like "MLT-001"
      const bookedNumbers = new Set(existingTokens.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
      const tokens = [];
      
      for (let i = 1; i <= effectiveCapacity; i++) {
        tokens.push({
          tokenNumber: i,
          status: bookedNumbers.has(i) ? "BOOKED" : "AVAILABLE"
        });
      }

      const bookedCount = existingTokens.length;

      return {
        available: bookedCount < effectiveCapacity,
        bookedSlots: bookedCount,
        totalSlots: effectiveCapacity,
        tokens,
        startTime: effectiveStartTime,
        endTime: effectiveEndTime
      };
    });
  }

  static async getDepartmentAvailability(department: string, date: string) {
    const targetDate = new Date(date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existingTokens = await prisma.appointment.findMany({
      where: {
        department,
        appointmentDate: {
          gte: startOfDay,
          lte: endOfDay
        },
        status: { notIn: ["CANCELLED", "NO_SHOW"] }
      },
      select: { tokenNumber: true }
    });

    const bookedNumbers = new Set(existingTokens.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
    const tokens = [];
    const capacity = 100; // Hardcoded capacity for non-doctor departments

    for (let i = 1; i <= capacity; i++) {
      tokens.push({
        tokenNumber: i,
        status: bookedNumbers.has(i) ? "BOOKED" : "AVAILABLE"
      });
    }

    return {
      available: bookedNumbers.size < capacity,
      bookedSlots: bookedNumbers.size,
      totalSlots: capacity,
      tokens
    };
  }

  static async getAvailableDates(doctorId: string) {
    const dates: any[] = [];
    let currentDate = new Date();
    // Allow checking for today's tokens if there are any remaining.

    let daysChecked = 0;
    while (dates.length < 5 && daysChecked < 30) {
      const dateString = currentDate.toISOString().split('T')[0] as string;
      const availability = await this.getAvailability(doctorId, dateString);
      
      if (availability.available) {
        dates.push({
          date: dateString,
          availableSlots: availability.totalSlots - availability.bookedSlots,
          totalSlots: availability.totalSlots,
          startTime: availability.startTime,
          endTime: availability.endTime
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
      daysChecked++;
    }

    return dates;
  }

  static async bookPhoneToken(phone: string, fullName: string, doctorId: string, date: string, selectedTokenNumber?: number) {
    const dayOfWeek = new Date(date).getDay();
    const appointmentDate = new Date(date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let retries = 0;
    while (retries < 3) {
      try {
        const token = await withRetry(() => prisma.$transaction(async (tx) => {
      const session = await tx.doctorScheduleSession.findFirst({
        where: { 
          dayOfWeek, 
          isActive: true,
          schedule: {
            doctorId,
            validFrom: { lte: endOfDay },
            OR: [
              { validUntil: null },
              { validUntil: { gte: startOfDay } }
            ]
          }
        }
      });

      if (!session) throw new Error("Doctor is not available on this date");

      // Verify if the token is available
      if (selectedTokenNumber) {
        const existingToken = await tx.appointment.findFirst({
          where: {
            sessionId: session.id,
            appointmentDate: startOfDay,
            tokenNumber: selectedTokenNumber.toString().padStart(3, "0")
          }
        });
        if (existingToken) throw new Error(`Token ${selectedTokenNumber} is already booked`);
        if (selectedTokenNumber > session.tokenCapacity) throw new Error("Invalid token number");
      }

      const phoneBookedCount = await tx.appointment.count({
        where: {
          sessionId: session.id,
          appointmentDate: startOfDay,
          bookingType: "PHONE",
          status: { notIn: ["CANCELLED", "NO_SHOW"] }
        }
      });

      const phoneCapacity = Math.ceil(session.tokenCapacity * ((100 - session.walkInPercentage) / 100));

      if (phoneBookedCount >= phoneCapacity) {
        throw new Error("No phone slots available for this date");
      }

      const patient = await tx.patient.upsert({
        where: { phone },
        update: { fullName },
        create: { phone, fullName }
      });

      let nextTokenNumberStr = "";
      if (selectedTokenNumber) {
        nextTokenNumberStr = selectedTokenNumber.toString().padStart(3, "0");
      } else {
        // Find next lowest available token
        const existingTokens = await tx.appointment.findMany({
          where: { sessionId: session.id, appointmentDate: startOfDay },
          select: { tokenNumber: true }
        });
        const bookedNums = new Set(existingTokens.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
        let nextAvailable = 1;
        while (bookedNums.has(nextAvailable) && nextAvailable <= session.tokenCapacity) {
          nextAvailable++;
        }
        nextTokenNumberStr = nextAvailable.toString().padStart(3, "0");
      }

      return await tx.appointment.create({
        data: {
          tokenNumber: nextTokenNumberStr,
          patientId: patient.id,
          doctorId: doctorId,
          appointmentDate: startOfDay,
          sessionId: session.id,
          status: "BOOKED",
          bookingType: "PHONE" // Always set explicitly for phone bookings
        },
        include: {
          User: true
        }
      });
    }));

        try {
          await NotificationService.sendTemplatedSMS(
            token.patientId,
            phone,
            'APPOINTMENT_BOOKED',
            {
              patientName: fullName,
              doctorName: token.User?.fullName || 'General Physician',
              appointmentDate: appointmentDate.toLocaleDateString(),
              tokenNumber: token.tokenNumber,
              hospitalName: "AMAZ Hospital"
            }
          );
        } catch (e) {
          console.error("Failed to queue SMS job:", e);
        }

        try {
          const updatedAvailability = await BookingService.getAvailability(doctorId, date);
          websocketService.emitToRoom(`doctor_${doctorId}_${date}`, 'availability_updated', updatedAvailability);
        } catch (e) {
          console.error("Failed to broadcast availability update:", e);
        }

        try {
          SMSService.syncContact(phone, fullName).catch(console.error);
        } catch (e) {
          console.error("Failed to sync contact:", e);
        }

        return token;
      } catch (error: any) {
        if (error.code === 'P2002' && !selectedTokenNumber && retries < 2) {
          retries++;
          continue;
        }
        if (error.code === 'P2002' && selectedTokenNumber) {
          throw new Error(`Token ${selectedTokenNumber} was just booked by another user.`);
        }
        throw error;
      }
    }
  }

  static async markArrived(tokenId: string) {
    return withRetry(async () => {
      const existingToken = await prisma.appointment.findUnique({ where: { id: tokenId } });
      if (!existingToken) throw new Error("Token not found");
      if (existingToken.status === "ARRIVED") throw new Error("Patient already marked as arrived. Invoice already exists.");

      const token = await prisma.appointment.update({
        where: { id: tokenId },
        data: { status: "ARRIVED" },
        include: { Patient: true, User: true }
      });

      // Fetch the doctor's actual consultation fee and fee type
      const doctor = token.doctorId
        ? await prisma.user.findUnique({
            where: { id: token.doctorId },
            select: { consultationFee: true, feeType: true, fullName: true }
          })
        : null;

      const consultationFee = doctor?.consultationFee ?? 2500;
      const feeType = doctor?.feeType ?? "POST";
      const doctorName = doctor?.fullName || token.User?.fullName || 'General Physician';

      let invoice;

      if (feeType === "UPFRONT") {
        // UPFRONT: Charge consultation fee immediately at check-in
        invoice = await prisma.invoice.create({
          data: {
            visitId: token.id,
            patientId: token.patientId,
            status: "DRAFT",
            subtotal: consultationFee,
            totalAmount: consultationFee,
            lineItems: {
              create: {
                department: "CONSULTATION",
                description: `Consultation (Upfront) - Dr. ${doctorName}`,
                unitPrice: consultationFee,
                total: consultationFee,
                quantity: 1
              }
            }
          }
        });
      } else {
        // POST: Create empty invoice now; fee added when prescription is submitted
        invoice = await prisma.invoice.create({
          data: {
            visitId: token.id,
            patientId: token.patientId,
            status: "DRAFT",
            subtotal: 0,
            totalAmount: 0
          }
        });
      }

      return { token, invoice };
    });
  }
}
