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
      // Handle biometric connections on /ws/biometric, /ws, /, /wssample, but avoid interfering with socket.io
      if (!url.pathname.startsWith("/socket.io")) {
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

          // Track device status as ONLINE in database
          if (serialNo !== "UNKNOWN") {
            try {
              await prisma.biometricDevice.upsert({
                where: { serialNumber: serialNo },
                update: {
                  status: "ONLINE",
                  lastSeenAt: new Date(),
                  ipAddress: request.socket.remoteAddress || null
                },
                create: {
                  serialNumber: serialNo,
                  location: "Main Entrance",
                  status: "ONLINE",
                  lastSeenAt: new Date(),
                  ipAddress: request.socket.remoteAddress || null
                }
              });
            } catch (devErr) {
              // Ignore unique/constraint race conditions
            }
          }

          // Handle "Register" command
          if (msg.Request === "Register") {
            const token = crypto.randomUUID();
            const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
              Response: "Register",
              Actid: msg.Rrid || "0",
              Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              DeviceSerialNo: serialNo,
              Token: token,
              Result: "OK"
            });
            ws.send(responseXml);
            console.log(`[Realand WS] Register response sent for ${serialNo}`);
            return;
          }

          // Handle "Login" command
          if (msg.Request === "Login") {
            const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
              Response: "Login",
              Actid: msg.Rrid || "0",
              Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              DeviceSerialNo: serialNo,
              Result: "OK"
            });
            ws.send(responseXml);
            console.log(`[Realand WS] Login response sent for ${serialNo}`);
            return;
          }

          // Handle "AdminLog" / "AdminLog_v2" (Real-time admin/enrollment event pushed by device)
          if (msg.Event === "AdminLog" || msg.Event === "AdminLog_v2") {
            const responseXml = `<?xml version="1.0"?>\n` + this.xmlBuilder.buildObject({
              Response: msg.Event === "AdminLog_v2" ? "AdminLog_v2" : "AdminLog",
              Actid: msg.Rrid || msg.TransID || "0",
              Time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
              Result: "OK"
            });
            ws.send(responseXml);
            console.log(`[Realand WS] AdminLog ACK sent for ${serialNo}`);
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

    console.log("[Realand WS] Service initialized for biometric terminals.");
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
      const rawTime = msg.Time;
      // Realand devices format time as "2026-10-19-T12:00:00Z" (note the hyphen before T).
      const cleanTime = rawTime ? rawTime.replace("-T", "T") : new Date().toISOString();
      const punchTime = isNaN(new Date(cleanTime).getTime()) ? new Date() : new Date(cleanTime);

      if (deviceUserId) {
        const rawDeviceUserId = String(deviceUserId).trim();
        const unpaddedId = rawDeviceUserId.replace(/^0+/, "") || "0";
        const padded18 = unpaddedId.padStart(18, "0");

        const mapping = await prisma.deviceUserMapping.findFirst({
          where: {
            OR: [
              { deviceUserId: rawDeviceUserId },
              { deviceUserId: unpaddedId },
              { deviceUserId: padded18 }
            ]
          },
          include: { employee: true }
        });

        if (mapping) {
          await prisma.processedAttendance.create({
            data: {
              employeeId: mapping.employeeId,
              timestamp: punchTime,
              type: "CLOCK_IN",
            },
          });

          // Also update StaffAttendance if user is linked
          if (mapping.employee?.userId) {
            const todayStart = new Date(punchTime.getFullYear(), punchTime.getMonth(), punchTime.getDate(), 0, 0, 0, 0);
            await prisma.staffAttendance.upsert({
              where: {
                userId_date: {
                  userId: mapping.employee.userId,
                  date: todayStart
                }
              },
              update: {
                checkIn: punchTime
              },
              create: {
                userId: mapping.employee.userId,
                date: todayStart,
                checkIn: punchTime,
                status: "PRESENT"
              }
            }).catch(() => {});

            // If user is a Doctor, update DoctorAttendance arrivedAt
            await prisma.doctorAttendance.updateMany({
              where: {
                doctorId: mapping.employee.userId,
                date: { gte: todayStart }
              },
              data: {
                status: "ARRIVED",
                arrivedAt: punchTime
              }
            }).catch(() => {});
          }

          console.log(`[Realand WS] Punch processed for Device User ID: ${deviceUserId}`);
        } else {
          console.warn(`[Realand WS] Unmapped Device User ID scanned: ${deviceUserId}`);
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
        Actid: msg.Rrid || "0",
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
