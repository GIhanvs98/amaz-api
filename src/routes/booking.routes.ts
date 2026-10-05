import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { getDoctors, getAvailability, getDepartmentAvailability, getAvailableDates, bookPhoneToken, markArrived, getTodayAppointments } from "../controllers/booking.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ALL']));

router.get("/doctors", cacheMiddleware(3600), getDoctors);
router.get("/availability", cacheMiddleware(60), getAvailability);
router.get("/department-availability", cacheMiddleware(60), getDepartmentAvailability);
router.get("/available-dates", cacheMiddleware(3600), getAvailableDates);
router.get("/appointments", getTodayAppointments);
router.post("/phone", bookPhoneToken);
router.patch("/:id/arrive", markArrived);

export default router;
