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
app.use("/api/auth", authRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/tokens", tokenRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/dashboard", dashboardRoutes);
app.use("/api/booking", bookingRoutes);
app.use("/api/reception", receptionRoutes);


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
