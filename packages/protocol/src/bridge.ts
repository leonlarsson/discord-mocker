/**
 * The mocker's own protocol between the server and the browser UI.
 *
 * Deliberately separate from the Discord protocol: the UI is an observer of the
 * mocked world, not a Discord client. Discord objects (`APIMessage`, and so on)
 * travel across it verbatim so the UI renders exactly what the bot produced.
 */

import type {
  APIApplicationCommand,
  APIApplicationCommandOptionChoice,
  APIChannel,
  APIMessage,
  APIRole,
  APIUser,
} from "discord-api-types/v10";

export interface BridgeGuild {
  id: string;
  name: string;
  iconColor: string;
  channels: APIChannel[];
  roles: APIRole[];
  /** Member user IDs, in display order. */
  memberIds: string[];
  ownerId: string;
}

export interface BridgeUser extends APIUser {
  avatarColor: string;
}

export type InspectorDirection =
  | "gateway:out"
  | "gateway:in"
  | "rest:request"
  | "rest:response"
  | "bot:stdout"
  | "bot:stderr"
  | "mocker";

export interface InspectorEntry {
  id: string;
  at: number;
  direction: InspectorDirection;
  /** One-line label, e.g. `DISPATCH INTERACTION_CREATE` or `POST /interactions/…/callback`. */
  label: string;
  /** Milliseconds elapsed, on response entries. */
  durationMs?: number;
  payload?: unknown;
}

export interface BotStatus {
  connected: boolean;
  user?: APIUser;
  applicationId?: string;
  /** Set when the mocker supervises the bot process itself. */
  process?: "running" | "stopped" | "crashed";
}

export interface BridgeSnapshot {
  guilds: BridgeGuild[];
  users: BridgeUser[];
  /** Messages keyed by channel ID, oldest first. */
  messages: Record<string, APIMessage[]>;
  commands: APIApplicationCommand[];
  bot: BotStatus;
  defaultUserId: string;
  inspector: InspectorEntry[];
}

/** A command option value as submitted from the UI composer. */
export interface SubmittedOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: SubmittedOption[];
  /** Set on the option the user is currently typing into, for autocomplete. */
  focused?: boolean;
}

export type ServerToClient =
  | { t: "snapshot"; d: BridgeSnapshot }
  | { t: "message:create"; d: { channelId: string; message: APIMessage } }
  | { t: "message:update"; d: { channelId: string; message: APIMessage } }
  | { t: "message:delete"; d: { channelId: string; messageId: string } }
  | { t: "commands"; d: APIApplicationCommand[] }
  | { t: "bot:status"; d: BotStatus }
  | { t: "inspector"; d: InspectorEntry }
  | { t: "autocomplete"; d: { nonce: string; choices: APIApplicationCommandOptionChoice[] } };

export type ClientToServer =
  | {
      t: "interaction:command";
      d: { channelId: string; userId: string; commandId: string; options: SubmittedOption[] };
    }
  | {
      t: "interaction:autocomplete";
      d: {
        nonce: string;
        channelId: string;
        userId: string;
        commandId: string;
        options: SubmittedOption[];
        focused: string;
      };
    }
  | { t: "message:send"; d: { channelId: string; userId: string; content: string } };
