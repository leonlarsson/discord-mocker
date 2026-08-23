import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  GATEWAY_VERSION,
  GatewayOpcodes,
  generateSnowflake,
  HEARTBEAT_INTERVAL,
  isIdentify,
  MockerCloseCode,
  parseGatewayFrame,
} from "@discord-mocker/protocol";
import type {
  ApplicationFlags,
  GatewayDispatchEvents,
  GatewayDispatchPayload,
  GatewayReadyDispatchData,
  GatewayReceivePayload,
  UserFlags,
} from "discord-api-types/v10";
import { type WebSocket, WebSocketServer } from "ws";
import type { Emitter } from "./events.js";
import type { World } from "./world.js";

interface Session {
  socket: WebSocket;
  sessionId: string;
  sequence: number;
  identified: boolean;
  lastHeartbeat: number;
  heartbeatWatchdog?: NodeJS.Timeout;
}

/**
 * A Discord gateway, faithful enough that unmodified discord.js reaches READY.
 *
 * Bots find their way here without any client changes: discord.js asks
 * `GET /gateway/bot` for a websocket URL, and the mocker's REST layer answers with
 * this server's address. Everything after that is the real protocol — HELLO,
 * IDENTIFY, heartbeat/ACK, sequenced dispatches.
 */
export class GatewayServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sessions = new Set<Session>();

  constructor(
    private readonly world: World,
    private readonly emitter: Emitter,
  ) {
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  get connectionCount(): number {
    return [...this.sessions].filter((session) => session.identified).length;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  private handleConnection(socket: WebSocket): void {
    const session: Session = {
      socket,
      sessionId: generateSnowflake(),
      sequence: 0,
      identified: false,
      lastHeartbeat: Date.now(),
    };
    this.sessions.add(session);

    this.send(session, {
      op: GatewayOpcodes.Hello,
      t: null,
      s: null,
      d: { heartbeat_interval: HEARTBEAT_INTERVAL },
    });

    socket.on("message", (raw) => this.handleFrame(session, raw.toString()));
    socket.on("close", () => this.endSession(session));
    socket.on("error", () => this.endSession(session));
  }

  private handleFrame(session: Session, raw: string): void {
    const payload = parseGatewayFrame(raw);
    if (!payload) {
      session.socket.close(MockerCloseCode.DecodeError, "Invalid JSON");
      return;
    }

    switch (payload.op) {
      case GatewayOpcodes.Identify: {
        if (!isIdentify(payload)) return;
        if (session.identified) {
          session.socket.close(MockerCloseCode.AlreadyAuthenticated, "Already identified");
          return;
        }
        this.emitter.record("gateway:in", "IDENTIFY", {
          intents: payload.d.intents,
          properties: payload.d.properties,
        });
        this.identify(session);
        break;
      }

      case GatewayOpcodes.Heartbeat: {
        session.lastHeartbeat = Date.now();
        this.send(
          session,
          { op: GatewayOpcodes.HeartbeatAck, t: null, s: null, d: null as never },
          { quiet: true },
        );
        break;
      }

      case GatewayOpcodes.Resume: {
        // Sessions do not survive a mocker restart, so always ask for a fresh identify.
        this.emitter.record("gateway:in", "RESUME");
        this.send(session, { op: GatewayOpcodes.InvalidSession, t: null, s: null, d: false });
        break;
      }

      case GatewayOpcodes.RequestGuildMembers:
      case GatewayOpcodes.PresenceUpdate:
      case GatewayOpcodes.VoiceStateUpdate:
        this.emitter.record("gateway:in", `OP ${payload.op}`, payload.d);
        break;

      default:
        this.emitter.record("gateway:in", `Unhandled op ${payload.op}`, payload);
        break;
    }
  }

  private identify(session: Session): void {
    session.identified = true;

    const ready: GatewayReadyDispatchData = {
      v: GATEWAY_VERSION,
      user: {
        ...this.world.botUser,
        verified: true,
        mfa_enabled: true,
        flags: 0 as UserFlags,
      },
      guilds: [...this.world.guilds.keys()].map((id) => ({ id, unavailable: true })),
      session_id: session.sessionId,
      resume_gateway_url: "ws://localhost/gateway",
      shard: [0, 1],
      application: {
        id: this.world.applicationId,
        flags: 0 as ApplicationFlags,
        flags_new: "0",
      },
    };

    this.dispatchTo(session, "READY" as GatewayDispatchEvents, ready);

    // discord.js holds `ready` until every guild from READY arrives, so send them now.
    for (const guild of this.world.guilds.values()) {
      this.dispatchTo(
        session,
        "GUILD_CREATE" as GatewayDispatchEvents,
        this.world.toGuildCreate(guild),
      );
    }

    this.world.botStatus = {
      ...this.world.botStatus,
      connected: true,
      user: this.world.botUser,
      applicationId: this.world.applicationId,
    };
    this.emitter.emit({ t: "bot:status", d: this.world.botStatus });

    session.heartbeatWatchdog = setInterval(() => {
      if (Date.now() - session.lastHeartbeat > HEARTBEAT_INTERVAL * 2) {
        session.socket.close(MockerCloseCode.SessionTimedOut, "Heartbeat timed out");
      }
    }, HEARTBEAT_INTERVAL);
  }

  /** Sends a dispatch to every identified session. */
  dispatch(event: GatewayDispatchEvents, data: unknown): void {
    for (const session of this.sessions) {
      if (session.identified) this.dispatchTo(session, event, data);
    }
  }

  private dispatchTo(session: Session, event: GatewayDispatchEvents, data: unknown): void {
    session.sequence += 1;
    const payload = {
      op: GatewayOpcodes.Dispatch,
      t: event,
      s: session.sequence,
      d: data,
    } as GatewayDispatchPayload;
    this.send(session, payload);
    this.emitter.record("gateway:out", `DISPATCH ${event}`, data);
  }

  private send(
    session: Session,
    payload: GatewayReceivePayload,
    options?: { quiet?: boolean },
  ): void {
    if (session.socket.readyState !== session.socket.OPEN) return;
    session.socket.send(JSON.stringify(payload));
    if (!options?.quiet && payload.op !== GatewayOpcodes.Dispatch) {
      this.emitter.record("gateway:out", `OP ${payload.op}`, payload.d);
    }
  }

  private endSession(session: Session): void {
    if (session.heartbeatWatchdog) clearInterval(session.heartbeatWatchdog);
    this.sessions.delete(session);
    if (this.connectionCount === 0) {
      this.world.botStatus = { ...this.world.botStatus, connected: false };
      this.emitter.emit({ t: "bot:status", d: this.world.botStatus });
      this.emitter.record("mocker", "Bot disconnected");
    }
  }

  close(): void {
    for (const session of this.sessions) session.socket.terminate();
    this.wss.close();
  }
}
