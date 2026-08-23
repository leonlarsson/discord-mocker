import type { SubmittedOption } from "@discord-mocker/protocol";
import { generateSnowflake } from "@discord-mocker/protocol";
import type {
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
  APIInteractionDataResolved,
  APIInteractionResponseCallbackData,
  APIMessage,
  APIMessageComponentInteraction,
  APIMessageInteractionMetadata,
  APIUser,
} from "discord-api-types/v10";
import {
  ApplicationCommandType,
  ComponentType,
  InteractionContextType,
  InteractionType,
  MessageFlags,
  MessageType,
} from "discord-api-types/v10";
import type { GuildState, World } from "./world.js";

/** Discord's interaction tokens are opaque 100+ char strings; shape matters, contents do not. */
export function createInteractionToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "mock.";
  for (let index = 0; index < 100; index += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return token;
}

export interface CreateMessageInput {
  channelId: string;
  guildId: string;
  author: APIUser;
  content?: string;
  data?: APIInteractionResponseCallbackData;
  interactionMetadata?: APIMessageInteractionMetadata;
  extraFlags?: number;
}

export function createMessage(input: CreateMessageInput): APIMessage {
  const now = new Date().toISOString();
  const flags = (input.data?.flags ?? 0) | (input.extraFlags ?? 0);

  return {
    id: generateSnowflake(),
    type: input.interactionMetadata ? MessageType.ChatInputCommand : MessageType.Default,
    channel_id: input.channelId,
    guild_id: input.guildId,
    author: input.author,
    content: input.data?.content ?? input.content ?? "",
    timestamp: now,
    edited_timestamp: null,
    tts: input.data?.tts ?? false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: input.data?.embeds ?? [],
    components: input.data?.components ?? [],
    pinned: false,
    flags,
    ...(input.interactionMetadata ? { interaction_metadata: input.interactionMetadata } : {}),
  } as APIMessage;
}

/**
 * Applies an edit (`editReply`, `update`) to an existing message in place.
 *
 * `markEdited` is false when a component's `update()` rewrites the message it
 * lives on: Discord does not badge those as edited, so a counter that ticks on a
 * button press should not sprout "(edited)".
 */
export function applyMessageEdit(
  message: APIMessage,
  data: APIInteractionResponseCallbackData,
  options: { markEdited?: boolean } = {},
): APIMessage {
  if (data.content !== undefined) message.content = data.content ?? "";
  if (data.embeds !== undefined) message.embeds = data.embeds ?? [];
  if (data.components !== undefined) message.components = data.components ?? [];
  // Clearing the loading flag is what turns "Bot is thinking…" into the real reply.
  message.flags = (message.flags ?? 0) & ~MessageFlags.Loading;
  if (options.markEdited ?? true) message.edited_timestamp = new Date().toISOString();
  return message;
}

function toInteractionOptions(
  options: SubmittedOption[],
): APIApplicationCommandInteractionDataOption[] {
  return options.map((option) => {
    const base = {
      name: option.name,
      type: option.type,
      ...(option.focused ? { focused: true } : {}),
    };
    if (option.options) {
      return { ...base, options: toInteractionOptions(option.options) };
    }
    return { ...base, value: option.value };
  }) as APIApplicationCommandInteractionDataOption[];
}

export interface CreateCommandInteractionInput {
  world: World;
  guild: GuildState;
  channelId: string;
  userId: string;
  commandId: string;
  commandName: string;
  options: SubmittedOption[];
  type: InteractionType.ApplicationCommand | InteractionType.ApplicationCommandAutocomplete;
}

export function createCommandInteraction(
  input: CreateCommandInteractionInput,
): APIChatInputApplicationCommandInteraction {
  const { world, guild } = input;
  const member = guild.members.get(input.userId);
  const channel = guild.channels.get(input.channelId);
  if (!member || !channel) {
    throw new Error(`Cannot build interaction for channel ${input.channelId}`);
  }

  const permissions = world.permissionsFor(guild, input.userId);

  return {
    id: generateSnowflake(),
    application_id: world.applicationId,
    type: input.type,
    token: createInteractionToken(),
    version: 1,
    guild_id: guild.id,
    channel_id: input.channelId,
    channel,
    member: { ...member, permissions },
    app_permissions: world.permissionsFor(guild, world.botUser.id),
    locale: "en-US",
    guild_locale: "en-US",
    entitlements: [],
    authorizing_integration_owners: { 0: guild.id },
    context: InteractionContextType.Guild,
    attachment_size_limit: 26_214_400,
    data: {
      id: input.commandId,
      name: input.commandName,
      type: ApplicationCommandType.ChatInput,
      guild_id: guild.id,
      resolved: {},
      options: toInteractionOptions(input.options),
    },
  } as unknown as APIChatInputApplicationCommandInteraction;
}

export function createInteractionMetadata(
  interaction: APIChatInputApplicationCommandInteraction | APIMessageComponentInteraction,
  user: APIUser,
): APIMessageInteractionMetadata {
  const base = {
    id: interaction.id,
    user,
    authorizing_integration_owners: interaction.authorizing_integration_owners,
  };

  if (interaction.type === InteractionType.MessageComponent) {
    return {
      ...base,
      type: InteractionType.MessageComponent,
      interacted_message_id: interaction.message.id,
    } as APIMessageInteractionMetadata;
  }

  return {
    ...base,
    type: InteractionType.ApplicationCommand,
    name: interaction.data.name,
    command_type: ApplicationCommandType.ChatInput,
  } as APIMessageInteractionMetadata;
}

export interface CreateComponentInteractionInput {
  world: World;
  guild: GuildState;
  channelId: string;
  userId: string;
  /** The message the component lives on — discord.js exposes it as `interaction.message`. */
  message: APIMessage;
  customId: string;
  componentType: number;
  values?: string[];
}

/**
 * Resolves the IDs an entity select returns into the objects discord.js expects.
 *
 * Without this, `interaction.users` and friends come back empty and a bot that
 * reads them looks broken for reasons that have nothing to do with the bot.
 */
function resolveSelectValues(
  input: CreateComponentInteractionInput,
): APIInteractionDataResolved | undefined {
  const values = input.values ?? [];
  if (values.length === 0) return undefined;

  const { world, guild } = input;
  const wantsUsers =
    input.componentType === ComponentType.UserSelect ||
    input.componentType === ComponentType.MentionableSelect;
  const wantsRoles =
    input.componentType === ComponentType.RoleSelect ||
    input.componentType === ComponentType.MentionableSelect;
  const wantsChannels = input.componentType === ComponentType.ChannelSelect;

  const resolved: APIInteractionDataResolved = {};

  if (wantsUsers) {
    for (const id of values) {
      const user = world.users.get(id);
      const member = guild.members.get(id);
      if (user) resolved.users = { ...resolved.users, [id]: user };
      if (member) {
        // Resolved members carry permissions and drop the nested user object.
        const { user: _user, ...rest } = member;
        resolved.members = {
          ...resolved.members,
          [id]: { ...rest, permissions: world.permissionsFor(guild, id) },
        };
      }
    }
  }

  if (wantsRoles) {
    for (const id of values) {
      const role = guild.roles.get(id);
      if (role) resolved.roles = { ...resolved.roles, [id]: role };
    }
  }

  if (wantsChannels) {
    for (const id of values) {
      const channel = guild.channels.get(id);
      if (channel) {
        resolved.channels = {
          ...resolved.channels,
          [id]: { ...channel, permissions: world.permissionsFor(guild, input.userId) },
        };
      }
    }
  }

  return resolved;
}

export function createComponentInteraction(
  input: CreateComponentInteractionInput,
): APIMessageComponentInteraction {
  const { world, guild } = input;
  const member = guild.members.get(input.userId);
  const channel = guild.channels.get(input.channelId);
  if (!member || !channel) {
    throw new Error(`Cannot build component interaction for channel ${input.channelId}`);
  }

  const resolved = resolveSelectValues(input);

  return {
    id: generateSnowflake(),
    application_id: world.applicationId,
    type: InteractionType.MessageComponent,
    token: createInteractionToken(),
    version: 1,
    guild_id: guild.id,
    channel_id: input.channelId,
    channel,
    member: { ...member, permissions: world.permissionsFor(guild, input.userId) },
    app_permissions: world.permissionsFor(guild, world.botUser.id),
    locale: "en-US",
    guild_locale: "en-US",
    entitlements: [],
    authorizing_integration_owners: { 0: guild.id },
    context: InteractionContextType.Guild,
    attachment_size_limit: 26_214_400,
    message: input.message,
    data: {
      custom_id: input.customId,
      component_type: input.componentType,
      ...(input.values ? { values: input.values } : {}),
      ...(resolved ? { resolved } : {}),
    },
  } as unknown as APIMessageComponentInteraction;
}
