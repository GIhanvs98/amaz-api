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
import authRoutes from "./routes/auth.routes.js";

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

export default app;