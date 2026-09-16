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

import pharmacyRoutes from "./routes/pharmacy.routes";
import billingRoutes from "./routes/billing.routes";
import labRoutes from "./routes/lab.routes";

app.get("/health", (_req, res) => {
    res.json({
        success: true,
        message: "Amaz Hospital API is running",
    });
});

app.use("/api/pharmacy", pharmacyRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/lab", labRoutes);

export default app;