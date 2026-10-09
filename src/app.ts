import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

const app = express();

app.use(helmet());

app.use(
    cors({
        origin: [process.env.FRONTEND_URL ?? "http://localhost:3000", "http://localhost:3001", "http://192.168.1.101:3000", "http://192.168.1.101:3001", "http://localhost:3002"],
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
import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import patientRoutes from "./routes/patient.routes.js";
import tokenRoutes from "./routes/token.routes.js";
import userRoutes from "./routes/user.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import receptionRoutes from "./routes/reception.routes.js";
import frontdeskRoutes from "./routes/frontdesk.routes.js";
import extraServiceRoutes from "./routes/extraService.routes.js";
import barcodeRoutes from "./routes/barcode.routes.js";
import settingRoutes from "./routes/setting.routes.js";
import patientPortalRoutes from "./routes/patient-portal.routes.js";
import roomRoutes from "./routes/room.routes.js";
import staffRoutes from "./routes/staff.routes.js";
import hrRoutes from "./routes/hr.routes.js";

import { prisma } from "./lib/prisma.js";

app.get("/health", async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            success: true,
            message: "Amaz Hospital API and Database are running",
        });
    } catch (error) {
        console.error("Health check failed:", error);
        res.status(503).json({
            success: false,
            message: "Database connection failed",
        });
    }
});

app.use("/api/pharmacy", pharmacyRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/barcode", barcodeRoutes);
app.use("/api/auth", authRoutes);
app.patch("/api/testpatch/:id", (req, res) => { res.send("OK"); });
app.use("/api/patients", patientRoutes);
app.use("/api/tokens", tokenRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/booking", bookingRoutes);
app.use("/api/reception", receptionRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/frontdesk", frontdeskRoutes);
app.use("/api/extra-services", extraServiceRoutes);
app.use("/api/patient-portal", patientPortalRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/hr", hrRoutes);


// Handle 404
app.use((req, res) => {
    res.status(404).json({ success: false, error: "Route not found: " + req.originalUrl });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ success: false, error: "Internal server error", details: err.message });
});

export default app;
