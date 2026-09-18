import { Request, Response } from "express";
import { SMSService } from "../services/sms.service.js";

export const generateToken = async (req: Request, res: Response) => {
  try {
    const { patientName, patientPhone, doctorName, department } = req.body;

    // In a real app, you would save this to the database, assign a queue number, etc.
    // For this implementation, we will mock the queue number generation
    const refNo = Math.floor(10000000 + Math.random() * 90000000).toString(); // e.g., 38006444
    const queueNumber = Math.floor(1 + Math.random() * 50).toString().padStart(3, "0"); // e.g., 040

    if (patientPhone) {
      await SMSService.sendTokenSMS(
        patientPhone,
        refNo,
        doctorName || "General Physician",
        queueNumber,
        "Leesons Hospital" // Or AMAZ Hospital based on the context
      );
    }

    res.status(201).json({
      success: true,
      data: {
        refNo,
        queueNumber,
        patientName,
        doctorName,
        department,
        status: "WAITING"
      }
    });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};
