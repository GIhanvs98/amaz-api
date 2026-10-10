import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { prisma } from "../lib/prisma.js";
import { parseStringPromise, Builder } from "xml2js";
import crypto from "crypto";

class RealandWsService {
  private wss: WebSocketServer | null = null;
  private xmlBuilder = new Builder({ headless: true, rootName: "Message" });

  public initialize(server: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (url.pathname === "/ws/biometric") {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit("connection", ws, request);
        });
      }
    });

    this.wss.on("connection", (ws: WebSocket, request) => {
      console.log(`[Realand WS] New connection from ${request.socket.remoteAddress}`);

      ws.on("message", async (message: Buffer) => {
        try {
          const payloadStr = message.toString().trim();
          console.log(`[Realand WS] Received XML:`, payloadStr);

          // Parse XML
          const parsed = await parseStringPromise(payloadStr, { explicitArray: false });
          const msg = parsed.Message;
          if (!msg) return;

          const serialNo = msg.DeviceSerialNo || "UNKNOWN";

          // Handle "Register" command
          if (msg.Request === "Register") {
            const token = crypto.randomUUID();
            const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
              Response: "Register",
              Actid: msg.Rrid,
              Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              DeviceSerialNo: serialNo,
              Token: token,
              Result: "OK"
            });
            ws.send(responseXml);
            return;
          }

          // Handle "Login" command
          if (msg.Request === "Login") {
            const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
              Response: "Login",
              Actid: msg.Rrid,
              Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              DeviceSerialNo: serialNo,
              Result: "OK"
            });
            ws.send(responseXml);
            return;
          }

          // Handle "TimeLog" (Attendance Punch)
          if (msg.Event === "TimeLog") {
            await this.handleTimeLog(msg, ws, serialNo);
          }

        } catch (error) {
          console.error(`[Realand WS] XML Parse/Process Error:`, error);
        }
      });

      ws.on("close", () => {
        console.log(`[Realand WS] Connection closed.`);
      });
    });

    console.log("[Realand WS] Service initialized on /ws/biometric");
  }

  private async handleTimeLog(msg: any, ws: WebSocket, serialNo: string) {
    try {
      // 1. Log Raw JSON
      const rawLog = await prisma.rawAttendanceLog.create({
        data: {
          deviceSerial: serialNo,
          payload: msg,
        },
      });

      // 2. Process the attendance record
      const deviceUserId = msg.UserID;
      const timestampStr = msg.Time;
      if (deviceUserId && timestampStr) {
        const mapping = await prisma.deviceUserMapping.findFirst({
          where: { deviceUserId: String(deviceUserId) }
        });

        if (mapping) {
          await prisma.processedAttendance.create({
            data: {
              employeeId: mapping.employeeId,
              timestamp: new Date(timestampStr),
              type: "CLOCK_IN",
            },
          });
          console.log(`[Realand WS] Punch processed for User ID: ${deviceUserId}`);
        } else {
          console.warn(`[Realand WS] Unknown User ID scanned: ${deviceUserId}`);
        }
        
        // Mark raw log processed
        await prisma.rawAttendanceLog.update({
          where: { id: rawLog.id },
          data: { processed: true },
        });
      }

      // 3. Send ACK to device so it removes the offline log
      const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
        Response: "TimeLog",
        Actid: msg.Rrid,
        Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        Result: "OK"
      });
      ws.send(responseXml);

    } catch (e: any) {
      if (e.code !== 'P2002') {
         console.error(`[Realand WS] TimeLog processing failed:`, e);
      }
    }
  }
}

export const realandWsService = new RealandWsService();
