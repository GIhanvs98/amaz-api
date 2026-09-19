import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

const app = express();

app.use(helmet());

app.use(
    cors({
        origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
        credentials: true,
    }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

import pharmacyRoutes from "./routes/pharmacy.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import labRoutes from "./routes/lab.routes.js";
import financeRoutes from "./routes/finance.routes.js";
import prescriptionRoutes from "./routes/prescription.routes.js";
import receptionRoutes from "./routes/reception.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import doctorRoutes from "./routes/doctor-attendance.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import authRoutes from "./routes/auth.routes.js";
import adminRoutes from "./routes/admin.routes.js";

app.get("/health", (_req, res) => {
    res.json({
        success: true,
        message: "Amaz Hospital API is running",
    });
});

app.use("/api/pharmacy", pharmacyRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/reception", receptionRoutes);
app.use("/api/booking", bookingRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);

export default app;