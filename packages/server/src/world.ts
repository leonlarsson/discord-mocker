import type {
  BotStatus,
  BridgeGuild,
  BridgeSnapshot,
  BridgeUser,
  MockerConfig,
  MockerGuildConfig,
  MockerUserConfig,
} from "@discord-mocker/protocol";
import { seededSnowflake } from "@discord-mocker/protocol";
import type {
  APIApplicationCommand,
  APIGuildMember,
  APIGuildTextChannel,
  APIMessage,
  APIRole,
  APIUser,
  GatewayGuildCreateDispatchData,
  GuildMemberFlags,
  RoleFlags,
} from "discord-api-types/v10";
import {
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildMFALevel,
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildSystemChannelFlags,
  GuildVerificationLevel,
  Locale,
  PermissionFlagsBits,
} from "discord-api-types/v10";

const AVATAR_COLORS = ["#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#3ba55c"];

/** Permissions the mocker reports for a member with no explicit role grants. */
const DEFAULT_PERMISSIONS = (
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.UseApplicationCommands |
  PermissionFlagsBits.AddReactions |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.AttachFiles
).toString();

export interface GuildState {
  id: string;
  name: string;
  iconColor: string;
  ownerId: string;
  roles: Map<string, APIRole>;
  channels: Map<string, APIGuildTextChannel<ChannelType.GuildText>>;
  members: Map<string, APIGuildMember>;
  /** Channel display order, resolved from config order. */
  channelOrder: string[];
}

function toColorInt(color: string | number | undefined): number {
  if (typeof color === "number") return color;
  if (!color) return 0;
  return Number.parseInt(color.replace("#", ""), 16);
}

function buildUser(config: MockerUserConfig, index: number): BridgeUser {
  const id = config.id ?? seededSnowflake(`user:${config.username}`);
  return {
    id,
    username: config.username,
    global_name: config.globalName ?? config.username,
    discriminator: config.discriminator ?? "0",
    avatar: null,
    bot: config.bot ?? false,
    avatarColor: config.avatarColor ?? AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#5865f2",
  };
}

/**
 * The mocked Discord instance: users, guilds, channels, messages and the
 * commands the connected bot has registered.
 *
 * The world is the single source of truth. The gateway, the REST API and the UI
 * bridge are all just views onto it, which is what keeps the UI honest — it can
 * only show what the bot actually produced.
 */
export class World {
  readonly users = new Map<string, BridgeUser>();
  readonly guilds = new Map<string, GuildState>();
  /** Every channel in every guild, for O(1) lookup by the REST layer. */
  readonly channels = new Map<string, APIGuildTextChannel<ChannelType.GuildText>>();
  readonly messages = new Map<string, APIMessage[]>();
  readonly commands = new Map<string, APIApplicationCommand>();

  botUser: APIUser;
  applicationId: string;
  defaultUserId = "";
  botStatus: BotStatus = { connected: false };

  constructor(readonly config: MockerConfig) {
    const botName = config.bot?.username ?? "Mocked Bot";
    this.applicationId = config.bot?.applicationId ?? seededSnowflake(`app:${botName}`);
    this.botUser = {
      id: this.applicationId,
      username: botName,
      global_name: botName,
      discriminator: "0000",
      avatar: null,
      bot: true,
    };

    (config.users ?? []).forEach((user, index) => {
      const built = buildUser(user, index);
      this.users.set(built.id, built);
    });

    for (const guild of config.guilds ?? []) {
      const state = this.buildGuild(guild);
      this.guilds.set(state.id, state);
    }

    const named = config.defaultUser
      ? [...this.users.values()].find((user) => user.username === config.defaultUser)
      : undefined;
    this.defaultUserId = named?.id ?? [...this.users.keys()][0] ?? "";
  }

  private buildGuild(config: MockerGuildConfig): GuildState {
    const id = config.id ?? seededSnowflake(`guild:${config.name}`);
    const roles = new Map<string, APIRole>();

    // @everyone always exists and always shares the guild's ID.
    roles.set(id, {
      id,
      name: "@everyone",
      color: 0,
      colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
      hoist: false,
      position: 0,
      permissions: DEFAULT_PERMISSIONS,
      managed: false,
      mentionable: false,
      flags: 0 as RoleFlags,
    });

    (config.roles ?? []).forEach((role, index) => {
      const roleId = role.id ?? seededSnowflake(`role:${config.name}:${role.name}`);
      roles.set(roleId, {
        id: roleId,
        name: role.name,
        color: toColorInt(role.color),
        colors: {
          primary_color: toColorInt(role.color),
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: role.hoist ?? false,
        position: index + 1,
        permissions: role.permissions ?? DEFAULT_PERMISSIONS,
        managed: false,
        mentionable: role.mentionable ?? false,
        flags: 0 as RoleFlags,
      });
    });

    const channels = new Map<string, APIGuildTextChannel<ChannelType.GuildText>>();
    const channelOrder: string[] = [];
    (config.channels ?? []).forEach((channel, index) => {
      const channelId = channel.id ?? seededSnowflake(`channel:${config.name}:${channel.name}`);
      const built: APIGuildTextChannel<ChannelType.GuildText> = {
        id: channelId,
        type: ChannelType.GuildText,
        guild_id: id,
        name: channel.name,
        position: index,
        permission_overwrites: [],
        nsfw: channel.nsfw ?? false,
        topic: channel.topic ?? null,
        last_message_id: null,
        rate_limit_per_user: 0,
        parent_id: null,
      };
      channels.set(channelId, built);
      channelOrder.push(channelId);
      this.channels.set(channelId, built);
      this.messages.set(channelId, []);
    });

    const members = new Map<string, APIGuildMember>();
    const roleIdByName = new Map([...roles.values()].map((role) => [role.name, role.id]));
    for (const member of config.members ?? []) {
      const user = [...this.users.values()].find((candidate) => candidate.username === member.user);
      if (!user) continue;
      members.set(user.id, {
        user,
        nick: member.nickname ?? null,
        avatar: null,
        roles: (member.roles ?? [])
          .map((name) => roleIdByName.get(name))
          .filter((value): value is string => Boolean(value)),
        joined_at: new Date(2023, 0, 1).toISOString(),
        deaf: false,
        mute: false,
        flags: 0 as GuildMemberFlags,
      });
    }

    // The bot is a member of every guild it can see.
    members.set(this.botUser.id, {
      user: this.botUser,
      nick: null,
      avatar: null,
      roles: [],
      joined_at: new Date(2023, 0, 1).toISOString(),
      deaf: false,
      mute: false,
      flags: 0 as GuildMemberFlags,
    });

    const ownerName = config.owner ?? config.members?.[0]?.user;
    const owner = [...this.users.values()].find((user) => user.username === ownerName);

    return {
      id,
      name: config.name,
      iconColor: AVATAR_COLORS[this.guilds.size % AVATAR_COLORS.length] ?? "#5865f2",
      ownerId: owner?.id ?? this.botUser.id,
      roles,
      channels,
      members,
      channelOrder,
    };
  }

  guildForChannel(channelId: string): GuildState | undefined {
    const channel = this.channels.get(channelId);
    if (!channel?.guild_id) return undefined;
    return this.guilds.get(channel.guild_id);
  }

  /** Effective permissions for a member, as the decimal string Discord sends. */
  permissionsFor(guild: GuildState, userId: string): string {
    if (guild.ownerId === userId) return PermissionFlagsBits.Administrator.toString();
    const member = guild.members.get(userId);
    if (!member) return DEFAULT_PERMISSIONS;
    let permissions = BigInt(guild.roles.get(guild.id)?.permissions ?? DEFAULT_PERMISSIONS);
    for (const roleId of member.roles) {
      const role = guild.roles.get(roleId);
      if (role) permissions |= BigInt(role.permissions);
    }
    return permissions.toString();
  }

  addMessage(channelId: string, message: APIMessage): void {
    const channelMessages = this.messages.get(channelId);
    if (channelMessages) channelMessages.push(message);
    else this.messages.set(channelId, [message]);

    const channel = this.channels.get(channelId);
    if (channel) channel.last_message_id = message.id;
  }

  findMessage(messageId: string): { channelId: string; message: APIMessage } | undefined {
    for (const [channelId, messages] of this.messages) {
      const message = messages.find((candidate) => candidate.id === messageId);
      if (message) return { channelId, message };
    }
    return undefined;
  }

  /** Builds the full GUILD_CREATE payload the gateway sends after READY. */
  toGuildCreate(guild: GuildState): GatewayGuildCreateDispatchData {
    return {
      id: guild.id,
      name: guild.name,
      icon: null,
      icon_hash: null,
      splash: null,
      discovery_splash: null,
      owner_id: guild.ownerId,
      afk_channel_id: null,
      afk_timeout: 300,
      widget_enabled: false,
      widget_channel_id: null,
      verification_level: GuildVerificationLevel.None,
      default_message_notifications: GuildDefaultMessageNotifications.OnlyMentions,
      explicit_content_filter: GuildExplicitContentFilter.Disabled,
      roles: [...guild.roles.values()],
      emojis: [],
      features: [],
      mfa_level: GuildMFALevel.None,
      application_id: null,
      system_channel_id: guild.channelOrder[0] ?? null,
      system_channel_flags: GuildSystemChannelFlags.SuppressJoinNotifications,
      rules_channel_id: null,
      max_presences: null,
      max_members: 500_000,
      vanity_url_code: null,
      description: null,
      banner: null,
      premium_tier: GuildPremiumTier.None,
      premium_subscription_count: 0,
      preferred_locale: Locale.EnglishUS,
      public_updates_channel_id: null,
      max_video_channel_users: 25,
      nsfw_level: GuildNSFWLevel.Default,
      premium_progress_bar_enabled: false,
      safety_alerts_channel_id: null,
      stickers: [],
      hub_type: null,
      incidents_data: null,
      joined_at: new Date(2023, 0, 1).toISOString(),
      large: false,
      unavailable: false,
      member_count: guild.members.size,
      voice_states: [],
      members: [...guild.members.values()],
      channels: [...guild.channels.values()],
      threads: [],
      presences: [],
      stage_instances: [],
      guild_scheduled_events: [],
      soundboard_sounds: [],
    };
  }

  toBridgeGuild(guild: GuildState): BridgeGuild {
    return {
      id: guild.id,
      name: guild.name,
      iconColor: guild.iconColor,
      ownerId: guild.ownerId,
      channels: guild.channelOrder
        .map((id) => guild.channels.get(id))
        .filter((channel): channel is APIGuildTextChannel<ChannelType.GuildText> =>
          Boolean(channel),
        ),
      memberIds: [...guild.members.keys()],
      roles: [...guild.roles.values()],
    };
  }

  snapshot(inspector: BridgeSnapshot["inspector"]): BridgeSnapshot {
    return {
      guilds: [...this.guilds.values()].map((guild) => this.toBridgeGuild(guild)),
      users: [...this.users.values(), { ...this.botUser, avatarColor: "#5865f2" }],
      messages: Object.fromEntries(this.messages),
      commands: [...this.commands.values()],
      bot: this.botStatus,
      defaultUserId: this.defaultUserId,
      inspector,
    };
  }
}
