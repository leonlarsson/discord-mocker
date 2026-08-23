import type { SubmittedOption } from "@discord-mocker/protocol";
import { generateSnowflake } from "@discord-mocker/protocol";
import type {
  APIApplicationCommandInteractionDataOption,
  APIChatInputApplicationCommandInteraction,
  APIInteractionResponseCallbackData,
  APIMessage,
  APIMessageInteractionMetadata,
  APIUser,
} from "discord-api-types/v10";
import {
  ApplicationCommandType,
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

/** Applies an edit (`editReply`, `update`) to an existing message in place. */
export function applyMessageEdit(
  message: APIMessage,
  data: APIInteractionResponseCallbackData,
): APIMessage {
  if (data.content !== undefined) message.content = data.content ?? "";
  if (data.embeds !== undefined) message.embeds = data.embeds ?? [];
  if (data.components !== undefined) message.components = data.components ?? [];
  // Clearing the loading flag is what turns "Bot is thinking…" into the real reply.
  message.flags = (message.flags ?? 0) & ~MessageFlags.Loading;
  message.edited_timestamp = new Date().toISOString();
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
  interaction: APIChatInputApplicationCommandInteraction,
  user: APIUser,
): APIMessageInteractionMetadata {
  return {
    id: interaction.id,
    type: InteractionType.ApplicationCommand,
    user,
    authorizing_integration_owners: interaction.authorizing_integration_owners,
    name: interaction.data.name,
    command_type: ApplicationCommandType.ChatInput,
  } as APIMessageInteractionMetadata;
}
