/**
 * The user-facing config shape (`mocker.config.ts`).
 *
 * Everything is optional: `defineConfig({})` boots a usable world. Anything
 * declared here is version-controlled alongside the bot; anything created in the
 * UI at runtime layers on top of it for that session only.
 */

export type MockerChannelType = "text" | "voice" | "category" | "announcement";

export interface MockerUserConfig {
  /** Stable snowflake. Derived deterministically from `username` when omitted. */
  id?: string;
  username: string;
  /** The modern display name shown in the client. Defaults to `username`. */
  globalName?: string;
  /** Legacy discriminator. Defaults to "0" (post-migration usernames). */
  discriminator?: string;
  /** Hex colour used to render the generated default avatar. */
  avatarColor?: string;
  bot?: boolean;
}

export interface MockerRoleConfig {
  id?: string;
  name: string;
  /** Hex string (`"#5865f2"`) or the raw integer Discord uses. */
  color?: string | number;
  /** Permission bitfield as a decimal string, e.g. `"8"` for Administrator. */
  permissions?: string;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface MockerChannelConfig {
  id?: string;
  name: string;
  type?: MockerChannelType;
  topic?: string;
  nsfw?: boolean;
  /** Name of the category channel this sits under. */
  parent?: string;
}

export interface MockerMemberConfig {
  /** Username of a user declared in `users`. */
  user: string;
  nickname?: string;
  /** Names of roles declared on the same guild. */
  roles?: string[];
}

export interface MockerGuildConfig {
  id?: string;
  name: string;
  /** Username of the owning member. Defaults to the first member. */
  owner?: string;
  roles?: MockerRoleConfig[];
  channels?: MockerChannelConfig[];
  members?: MockerMemberConfig[];
}

export interface MockerBotConfig {
  /** Identity the mocker reports for your bot in READY. */
  username?: string;
  applicationId?: string;
  /**
   * Optional dev command (`"pnpm dev"`). When set, the mocker supervises the
   * process and streams its output into the inspector. Off by default — most
   * projects already have their own watch loop.
   */
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Whether to start `command` on boot. Defaults to true when a command is set. */
  autoStart?: boolean;
}

export interface MockerConfig {
  /** Port serving the gateway, the REST API, and the UI. Defaults to 5100. */
  port?: number;
  users?: MockerUserConfig[];
  guilds?: MockerGuildConfig[];
  bot?: MockerBotConfig;
  /** Username of the identity the client acts as on boot. */
  defaultUser?: string;
}

/** Identity helper giving `mocker.config.ts` full type checking and completion. */
export function defineConfig(config: MockerConfig): MockerConfig {
  return config;
}
