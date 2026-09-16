# Amaz Hospital - Backend Server

The backend of the Amaz Hospital Management System. This is a monolithic Node.js and Express application powered by Prisma and a NeonDB PostgreSQL database. It supports real-time features using WebSockets and handles everything from centralized billing logic to live prescription routing.

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (via NeonDB)
- **ORM**: Prisma (v6.12.0)
- **Real-Time Engine**: Socket.io
- **Language**: TypeScript

## Architecture & Features

### 1. Centralized Visit Model
All patient interactions are tied to a single "Visit" record. When a patient arrives, a visit is created. Every department (Doctor, Lab, Pharmacy) performs actions against this single visit, ensuring absolute data integrity and no duplication.

### 2. Centralized Billing Engine
Instead of scattered payments, the `BillingController` aggregates all charges into a unified invoice. 
- When a doctor finishes a consultation, a consultation charge is automatically drafted.
- When a pharmacist dispenses drugs, the exact cost is pushed to the visit's invoice.
- When the patient reaches the Cashier, the invoice is finalized and paid in full.

### 3. Realtime Prescription Engine (WebSockets)
We utilize `socket.io` mounted directly on the Express HTTP server to bypass external real-time providers. 
- When a Doctor creates a prescription, it is saved via `POST /api/prescriptions` and instantly broadcast to the Pharmacy POS terminal.
- Lab results trigger live toast notifications on the Doctor's screen.

## Project Structure

```
Backend/
├── prisma/
│   └── schema.prisma        # Database schema definitions and relationships
├── src/
│   ├── controllers/         # Business logic and HTTP handlers
│   ├── routes/              # Express route definitions
│   ├── services/            # Reusable core services (e.g., websocket.service.ts)
│   ├── app.ts               # Express configuration, middleware, and route mounting
│   └── server.ts            # Entry point: HTTP Server & WebSocket initialization
└── .env                     # Environment variables (not committed)
```

## Setup & Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   DATABASE_URL="postgres://user:pass@ep-hostname.neon.tech/neondb?sslmode=require"
   FRONTEND_URL="http://localhost:3000"
   ```

3. **Database Migrations**
   Sync your database schema with Prisma:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. **Run the Development Server**
   ```bash
   npm run dev
   ```
   The server will start on port 5000 (or the port specified in your `.env`).

## Deployment
For production, compile the TypeScript source to JavaScript and start the production server:
```bash
npm run build
npm start
```
