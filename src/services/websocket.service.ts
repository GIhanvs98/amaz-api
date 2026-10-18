import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";

class WebSocketService {
  private io: SocketIOServer | null = null;

  public initialize(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: "*", // allow all origins for dev
        methods: ["GET", "POST"]
      }
    });

    // Middleware for Authentication (Optional)
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (!token) {
          // Allow anonymous connections for public screens (Customer Display)
          return next();
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");
        (socket as any).user = decoded;
        next();
      } catch (err) {
        // If token is invalid, log it but still allow connection as anonymous
        console.warn(`[Socket.io] Invalid token provided for socket ${socket.id}`);
        next();
      }
    });

    this.io.on("connection", (socket) => {
      console.log(`[Socket.io] Authenticated client connected: ${socket.id}`);

      // Basic room joining mechanism if needed later
      socket.on("join", (room) => {
        socket.join(room);
        console.log(`[Socket.io] Client ${socket.id} joined room ${room}`);
      });

      socket.on("leave", (room) => {
        socket.leave(room);
        console.log(`[Socket.io] Client ${socket.id} left room ${room}`);
      });
      
      // Cart sync relay for Customer Display
      socket.on("sync_cart", (data: { room: string; state: any }) => {
        if (data.room && data.state) {
          socket.to(data.room).emit("cart_updated", data.state);
        }
      });

      socket.on("disconnect", () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
      });
    });

    console.log("[Socket.io] WebSocket Service initialized.");
  }

  public getIo(): SocketIOServer {
    if (!this.io) {
      throw new Error("WebSocketService is not initialized. Please call initialize() first.");
    }
    return this.io;
  }

  public broadcast(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public emitToRoom(room: string, event: string, data: any) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }
}

export const websocketService = new WebSocketService();
