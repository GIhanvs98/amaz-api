import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { SMSService } from "../services/sms.service.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not defined in environment variables");

export const requestOTP = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    // Check if patient exists
    const patient = await prisma.patient.findFirst({ where: { phone } });
    if (!patient) return res.status(404).json({ error: "No records found for this phone number." });

    // Rate Limiting check (prevent spamming)
    const existingOTP = await prisma.patientOTP.findUnique({ where: { phone } });
    if (existingOTP && existingOTP.expiresAt > new Date() && existingOTP.attempts < 3) {
      // Allow re-sending if it's the same active window, but you might want to throttle this too.
      // For simplicity, we just overwrite, but if they requested in the last 1 minute, block it.
      if (existingOTP.updatedAt.getTime() > Date.now() - 60000) {
        return res.status(429).json({ error: "Please wait 60 seconds before requesting another OTP." });
      }
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await prisma.patientOTP.upsert({
      where: { phone },
      update: { code: otp, expiresAt, attempts: 0 },
      create: { phone, code: otp, expiresAt }
    });

    const message = `Your AMAZ Hospital patient portal OTP is ${otp}. It expires in 5 minutes.`;
    await SMSService.sendSMS(phone, message);

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    
    const record = await prisma.patientOTP.findUnique({ where: { phone } });
    if (!record) return res.status(400).json({ error: "No OTP requested or OTP expired." });

    if (Date.now() > record.expiresAt.getTime()) {
      await prisma.patientOTP.delete({ where: { phone } });
      return res.status(400).json({ error: "OTP expired." });
    }

    if (record.attempts >= 3) {
      await prisma.patientOTP.delete({ where: { phone } });
      return res.status(429).json({ error: "Too many failed attempts. OTP invalidated." });
    }

    if (record.code !== otp) {
      await prisma.patientOTP.update({
        where: { phone },
        data: { attempts: { increment: 1 } }
      });
      return res.status(400).json({ error: "Invalid OTP." });
    }

    // Success
    await prisma.patientOTP.delete({ where: { phone } });

    const patient = await prisma.patient.findFirst({ where: { phone } });
    if (!patient) return res.status(404).json({ error: "Patient not found." });

    // Generate JWT for patient
    const token = jwt.sign(
      { id: patient.id, role: "PATIENT", fullName: patient.fullName },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ success: true, token, patient });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getPatientHistory = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || user.role !== "PATIENT") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const patient = await prisma.patient.findUnique({
      where: { id: user.id },
      include: {
        Prescription: {
          include: { items: true },
          orderBy: { createdAt: 'desc' }
        },
        LabRequests: {
          include: { items: { include: { LabTest: true } } },
          orderBy: { requestedAt: 'desc' }
        },
        Appointment: {
          include: { User: { select: { fullName: true } } },
          orderBy: { appointmentDate: 'desc' }
        }
      }
    });

    res.json({ success: true, data: patient });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
