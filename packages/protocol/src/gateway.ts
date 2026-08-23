import type {
  GatewayDispatchPayload,
  GatewayIdentify,
  GatewayReceivePayload,
  GatewayResume,
  GatewaySendPayload,
} from "discord-api-types/v10";
import { GatewayOpcodes } from "discord-api-types/v10";

export type { GatewayDispatchPayload, GatewayReceivePayload, GatewaySendPayload };
export { GatewayOpcodes };

/** The gateway API version the mocker speaks. Matches what discord.js v14 requests. */
export const GATEWAY_VERSION = 10;

/** The REST API version the mocker serves under `/api/vN`. */
export const REST_API_VERSION = 10;

/**
 * Interval between HELLO-negotiated heartbeats, in ms.
 *
 * Real Discord sends ~41250ms. Keeping the real value means a mocked session
 * exercises the same heartbeat/ACK timing as production instead of a fast path.
 */
export const HEARTBEAT_INTERVAL = 41_250;

/** Gateway close codes the mocker can send. */
export enum MockerCloseCode {
  UnknownError = 4000,
  UnknownOpcode = 4001,
  DecodeError = 4002,
  NotAuthenticated = 4003,
  AuthenticationFailed = 4004,
  AlreadyAuthenticated = 4005,
  InvalidSeq = 4007,
  RateLimited = 4008,
  SessionTimedOut = 4009,
  InvalidShard = 4010,
  InvalidIntents = 4013,
  DisallowedIntents = 4014,
}

export function isIdentify(payload: GatewaySendPayload): payload is GatewayIdentify {
  return payload.op === GatewayOpcodes.Identify;
}

export function isResume(payload: GatewaySendPayload): payload is GatewayResume {
  return payload.op === GatewayOpcodes.Resume;
}

/** Parses a raw gateway frame, returning null when it is not valid JSON. */
export function parseGatewayFrame(raw: string): GatewaySendPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("op" in parsed)) return null;
    return parsed as GatewaySendPayload;
  } catch {
    return null;
  }
}
