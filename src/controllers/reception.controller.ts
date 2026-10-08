import { Request, Response } from "express";
import { NotificationService } from "../services/notification.service.js";
import { prisma } from "../lib/prisma.js";
import { randomUUID } from "crypto";
import { BookingService } from "../services/booking.service.js";
import { websocketService } from "../services/websocket.service.js";
import { SMSService } from "../services/sms.service.js";
import { generateMRN } from "../utils/mrn.util.js";

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


async function getOpenShiftId(userId: string): Promise<string | undefined> {
  const shift = await prisma.cashRegisterShift.findFirst({
    where: { openedBy: userId, status: "OPEN" }
  });
  return shift?.id;
}

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
    
    const patients = await prisma.patient.findMany({
      where: {
        phone: {
          contains: q as string
        }
      },
      take: 5
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
        Role: { name: 'DOCTOR' },
        departmentId: { not: null }, // Only doctors actively assigned to a department
        isActive: true
      },
      select: {
        id: true,
        fullName: true,
        specialty: true,
        consultationFee: true,
        feeType: true
      }
    });

    res.json({ success: true, data: doctors });
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
      activeTokenNumber: patient.Appointment[0]?.tokenNumber || null,
      activeVisitStartTime: patient.Appointment[0]?.updatedAt || null
    });
  } catch (error: any) {
    console.error("Error fetching patient:", error);
    res.status(500).json({ error: error.message });
  }
};

export const generateToken = async (req: Request, res: Response) => {
  try {
    const { patientName, patientPhone, ageFallback, doctorId, doctorName, testIds, customLabPrices, serviceIds, customServicePrices, doctorTokenNumber, labTokenNumber, serviceTokenNumber, date, bookingType } = req.body;

    // Find or create patient
    let patient;
    if (patientPhone) {
      patient = await prisma.patient.findFirst({ where: { phone: patientPhone } });
    }
    
    if (!patient) {
      const patientId = await generateMRN(prisma);
      patient = await prisma.patient.create({
        data: {
          patientId,
          fullName: patientName || "Walk-in Patient",
          phone: patientPhone || `WALKIN-${randomUUID()}`, // UUID fallback guarantees uniqueness under concurrency
          ageFallback: ageFallback || null
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
      doctorDetails = await prisma.user.findUnique({ where: { id: doctorId } });
      const targetDate = date ? new Date(date) : new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      const todayAttendance = await prisma.doctorAttendance.findFirst({
        where: { doctorId: doctorId, date: { gte: startOfDay, lte: endOfDay } }
      });
      doctorRoomNumber = todayAttendance?.roomNumber || doctorDetails?.roomNumber || null;
    }
    
    let labTestsDetails: any[] = [];
    if (hasLab) {
      labTestsDetails = await prisma.labTest.findMany({
        where: { id: { in: testIds } }
      });
    }

    let extraServicesDetails: any[] = [];
    if (hasService) {
      extraServicesDetails = await prisma.extraService.findMany({
        where: { id: { in: serviceIds } }
      });
    }

    const isNonOPD = doctorDetails && doctorDetails.specialty && doctorDetails.specialty !== "General" && doctorDetails.specialty.toUpperCase() !== "OPD";
    const needsInvoice = isNonOPD || hasLab || hasService;

    let sharedRefNo = Math.floor(10000000 + Math.random() * 90000000).toString();

    // If it's a PHONE booking, check if this patient already has a BOOKED phone appointment today
    if (bookingType === "PHONE" && patient?.id) {
      const targetDate = date ? new Date(date) : new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

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

    // Helper to robustly generate a single token
    const generateSpecificToken = async (dept: string, docId: string | null, requestedTokenNumber?: number) => {
      const targetDate = date ? new Date(date) : new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      let token = null;

      let sessionId = null;
      if (dept === "CONSULTATION" && docId) {
        const dayOfWeek = targetDate.getDay();
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

      if (requestedTokenNumber) {
        const tokenDisplay = requestedTokenNumber.toString().padStart(2, "0");
        const exists = await prisma.appointment.findFirst({
          where: {
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            department: dept,
            doctorId: docId || null,
            tokenNumber: tokenDisplay,
            status: { notIn: ["CANCELLED", "NO_SHOW"] }
          }
        });

        if (exists) {
          throw new Error(`Token ${requestedTokenNumber} for ${dept} is already booked.`);
        }

        token = await prisma.appointment.create({
          data: {
            tokenNumber: tokenDisplay,
            patientId: patient!.id,
            doctorId: docId || null,
            sessionId: sessionId,
            department: dept,
            status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
            bookingType: bookingType || "WALK_IN",
            appointmentDate: targetDate,
            bookingReference: sharedRefNo
          }
        });
        return token;
      }

      let attempts = 0;
      const lastToken = await prisma.appointment.findFirst({
        where: {
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          department: dept,
          doctorId: docId || null,
          status: { notIn: ["CANCELLED", "NO_SHOW"] }
        },
        orderBy: { createdAt: 'desc' }
      });

      let nextTokenInt = 1;
      if (lastToken && !isNaN(parseInt(lastToken.tokenNumber))) {
        nextTokenInt = parseInt(lastToken.tokenNumber) + 1;
      } else {
        const count = await prisma.appointment.count({
          where: {
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            department: dept,
            doctorId: docId || null
          }
        });
        nextTokenInt = count + 1;
      }

      while (!token && attempts < 20) {
        const tokenDisplay = nextTokenInt.toString().padStart(2, "0");
        const exists = await prisma.appointment.findFirst({
          where: {
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            department: dept,
            doctorId: docId || null,
            tokenNumber: tokenDisplay
          }
        });

        if (exists) {
          nextTokenInt++;
          attempts++;
          continue;
        }

        try {
          token = await prisma.appointment.create({
            data: {
              tokenNumber: tokenDisplay,
              patientId: patient!.id,
              doctorId: docId || null,
              sessionId: sessionId,
              department: dept,
              status: dept === "LAB" ? "WAITING_FOR_LAB_TEST" : "BOOKED",
              bookingType: bookingType || "WALK_IN",
              appointmentDate: targetDate,
              bookingReference: sharedRefNo
            }
          });
        } catch (e: any) {
          nextTokenInt++;
          attempts++;
        }
      }
      
      if (!token) throw new Error(`Failed to generate token for ${dept}`);
      return token;
    };

    const tokensToGenerate: { dept: string, docId: string | null, name: string, roomNumber: string | null, requestedTokenNumber?: number }[] = [];
    if (hasConsultation) {
      tokensToGenerate.push({ dept: "CONSULTATION", docId: doctorId, name: doctorName || "General Physician", roomNumber: doctorRoomNumber, requestedTokenNumber: doctorTokenNumber });
    }
    if (hasLab) {
      const firstLabRoom = labTestsDetails.find((t: any) => t.roomNumber)?.roomNumber || null;
      tokensToGenerate.push({ dept: "LAB", docId: null, name: "Laboratory", roomNumber: firstLabRoom, requestedTokenNumber: labTokenNumber });
    }
    if (hasService) {
      const firstServiceRoom = extraServicesDetails.find((s: any) => s.roomNumber)?.roomNumber || null;
      tokensToGenerate.push({ dept: "EXTRA_SERVICE", docId: null, name: "Extra Services", roomNumber: firstServiceRoom, requestedTokenNumber: serviceTokenNumber });
    }

    if (tokensToGenerate.length === 0) {
      return res.status(400).json({ success: false, error: "No services selected to generate token." });
    }

    const generatedTokens = [];
    for (const t of tokensToGenerate) {
      const token = await generateSpecificToken(t.dept, t.docId, t.requestedTokenNumber);
      generatedTokens.push({
        id: token.id,
        refNo: token.bookingReference,
        tokenNumber: token.tokenNumber,
        department: token.department,
        status: token.status,
        doctorName: t.name,
        patientName: patient.fullName,
        appointmentDate: token.appointmentDate,
        roomNumber: t.roomNumber
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
            department: "OTHER",
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

      const invoice = await prisma.invoice.create({
        data: {
          visitId: generatedTokens[0]?.id || "", // Associate invoice with the first primary token
          patientId: patient.id,
          status: bookingType === "PHONE" ? "DRAFT" : "PAID",
          subtotal: totalAmount,
          totalAmount: totalAmount,
          lineItems: { create: lineItems },
          ...(bookingType !== "PHONE" && {
            payments: {
              create: [{
                amount: totalAmount,
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

    // --- Post Generation Hooks ---
    if (hasLab) {
      const { labService } = await import('../services/lab.service.js');
      const labToken = generatedTokens.find(t => t.department === "LAB");
      await labService.createRequest({
        patientId: patient.id,
        visitId: labToken?.id || generatedTokens[0]?.id || "",
        testIds,
        doctorId: doctorId || null,
        priority: "ROUTINE",
        customPrices: customLabPrices,
        skipBilling: true
      });
    }

    if (patientPhone && !patientPhone.startsWith('WALKIN')) {
      await NotificationService.sendTemplatedSMS(
        patient.id,
        patientPhone,
        'APPOINTMENT_BOOKED',
        {
          patientName: patient.fullName,
          doctorName: generatedTokens.map(t => t.doctorName).join(", "),
          appointmentDate: new Date().toLocaleDateString(),
          tokenNumber: generatedTokens.map(t => `${t.department === 'LAB' ? 'LAB-' : ''}${t.tokenNumber}`).join(", "),
          hospitalName: "AMAZ Hospital"
        }
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
    const { roomNumber, startTime, endTime } = req.body;

    if (!roomNumber || roomNumber.trim() === "") {
      return res.status(400).json({ success: false, error: "Room number is mandatory" });
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
          roomNumber: roomNumber || null,
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
          roomNumber: roomNumber || null,
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
    const { appointmentId, fee, isUpfront } = req.body;
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

    if (appointment.status === "COMPLETED" || appointment.status === "CANCELLED" || appointment.status === "WAITING") {
      return res.status(400).json({ success: false, error: `Cannot checkout appointment in status: ${appointment.status}` });
    }

    let allApptIds = [appointmentId];
    
    let allApptsForPatient = [];
    if (appointment.bookingReference) {
      allApptsForPatient = await prisma.appointment.findMany({
        where: { 
          bookingReference: appointment.bookingReference,
          status: { in: ["BOOKED", "WAITING_FOR_LAB_TEST"] } // Include Lab tests which default to this status
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

    // Update each appointment's status correctly
    for (const apptId of allApptIds) {
      const appt = allApptsForPatient.find(a => a.id === apptId) || appointment;
      const newStatus = appt.department === "LAB" ? "WAITING_FOR_LAB_TEST" : "WAITING";
      const updated = await prisma.appointment.update({
        where: { id: apptId },
        data: { status: newStatus }
      });
      if (apptId === appointmentId) {
        updatedAppointment = updated as any;
      }
    }

    let mergedInvoice: any = null;

    await prisma.$transaction(async (tx) => {
      if (allApptIds.length > 0) {
        const placeholders = allApptIds.map((_, i) => `$${i + 1}`).join(',');
        await tx.$executeRawUnsafe(`SELECT id FROM "Invoice" WHERE "visitId" IN (${placeholders}) AND status = 'DRAFT' FOR UPDATE`, ...allApptIds);
      }

      let invoices = await tx.invoice.findMany({
        where: {
          visitId: { in: allApptIds },
          status: "DRAFT"
        },
        include: { lineItems: true }
      });

      if (invoices.length > 0) {
        // Pay all existing DRAFT invoices
        for (const inv of invoices) {
          const updatedInv = await tx.invoice.update({
            where: { id: inv.id },
            data: {
              status: "PAID",
              payments: {
                create: [{
                  amount: inv.totalAmount,
                  method: req.body.paymentMethod || "CASH",
                  status: "COMPLETED", shiftId: await getOpenShiftId(((req as any).user)?.id),
                  appointmentId: appointment.id
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
      } else if (isUpfront && fee > 0) {
        // Create a new invoice if no draft exists
        mergedInvoice = await tx.invoice.create({
          data: {
            patientId: appointment.patientId,
            subtotal: fee,
            totalAmount: fee,
            status: "PAID",
            payments: {
              create: [{
                amount: fee,
                method: req.body.paymentMethod || "CASH",
                status: "COMPLETED", shiftId: await getOpenShiftId(((req as any).user)?.id),
                appointmentId: appointment.id
              }]
            },
            lineItems: {
              create: [
                {
                  description: `Consultation - Dr. ${appointment.User?.fullName || 'General'}`,
                  quantity: 1,
                  unitPrice: fee,
                  total: fee,
                  department: "CONSULTATION"
                }
              ]
            }
          },
          include: { lineItems: true }
        });
      }
    });

    if (websocketService.getIo()) {
      websocketService.getIo().emit("TOKEN_STATUS_UPDATED", { tokenId: appointmentId });
    }

    let allTokens = await prisma.appointment.findMany({
      where: { id: { in: allApptIds } },
      include: { Patient: true, User: true }
    });

    const targetDate = new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    allTokens = await Promise.all(allTokens.map(async (t) => {
      let roomNumber = t.User?.roomNumber || null;
      if (t.doctorId) {
        const attendance = await prisma.doctorAttendance.findFirst({
          where: { doctorId: t.doctorId, date: { gte: startOfDay, lte: endOfDay } }
        });
        if (attendance?.roomNumber) {
          roomNumber = attendance.roomNumber;
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
    
    const invoices = await prisma.invoice.findMany({
      where: search ? {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : [])
        ]
      } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        lineItems: true
      }
    });

    const allPatientIds = Array.from(new Set(invoices.map(i => i.patientId).filter(id => id !== null))) as string[];
    const patientsMap = new Map();
    if (allPatientIds.length > 0) {
      const pats = await prisma.patient.findMany({
        where: { id: { in: allPatientIds } }
      });
      pats.forEach(p => patientsMap.set(p.id, p));
    }

    const data = invoices.map(inv => ({
      ...inv,
      Patient: inv.patientId ? patientsMap.get(inv.patientId) || null : null
    }));

    res.json({ success: true, data });
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
      where: { openedBy: user.id, status: "OPEN" }
    });

    if (!shift) return res.status(400).json({ error: "No open shift found." });
    
    const payments = await prisma.payment.findMany({
      where: { shiftId: shift.id, status: "COMPLETED" }
    });

    let systemCashTotal = 0;
    let systemCardTotal = 0;

    payments.forEach(payment => {
      if (payment.method === "CASH") systemCashTotal += payment.amount;
      if (payment.method === "CARD" || payment.method === "BANK" || payment.method === "QR") systemCardTotal += payment.amount;
    });

    const expectedCash = shift.openingFloat + systemCashTotal;
    const variance = Number(declaredCash) - expectedCash;

    await prisma.cashRegisterShift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        status: "CLOSED",
        expectedCash,
        actualCash: Number(declaredCash),
        variance
      }
    });

    const summary = {
      totalInvoices: payments.length, // approximation
      systemCashTotal,
      systemCardTotal,
      declaredCash: Number(declaredCash),
      expectedCash,
      variance
    };

    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
