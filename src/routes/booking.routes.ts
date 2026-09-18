import { Router } from "express";
import { getDoctors, getAvailability, bookPhoneToken, markArrived, getTodayAppointments } from "../controllers/booking.controller.js";

const router = Router();

router.get("/doctors", getDoctors);
router.get("/availability", getAvailability);
router.get("/appointments", getTodayAppointments);
router.post("/phone", bookPhoneToken);
router.patch("/:id/arrive", markArrived);

export default router;
