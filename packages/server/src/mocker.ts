import type {
  BridgeSnapshot,
  ClientToServer,
  ComponentUse,
  MockerConfig,
} from "@discord-mocker/protocol";
import type {
  APIChatInputApplicationCommandInteraction,
  APIMessage,
  APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { GatewayDispatchEvents, InteractionType, MessageFlags } from "discord-api-types/v10";
import { AttachmentStore } from "./attachments.js";
import { Emitter } from "./events.js";
import {
  createCommandInteraction,
  createComponentInteraction,
  createInteractionMetadata,
  createMessage,
} from "./factories.js";
import { GatewayServer } from "./gateway.js";
import { World } from "./world.js";

export interface PendingInteraction {
  interaction: APIChatInputApplicationCommandInteraction | APIMessageComponentInteraction;
  channelId: string;
  guildId: string;
  userId: string;
  /** Message ID of the initial response, once one exists. */
  responseMessageId?: string;
  deferred: boolean;
  replied: boolean;
  /** Set for autocomplete interactions, so results can be routed back to the composer. */
  autocompleteNonce?: string;
  /** For component interactions: the message the component lives on. */
  sourceMessageId?: string;
  /**
   * Whether follow-up edits target the source message rather than a new reply.
   * `update()` and `deferUpdate()` set this; `reply()` and `deferReply()` do not.
   */
  targetsSource?: boolean;
}

/**
 * Wires the mocked world, the gateway and the UI together.
 *
 * Every route in and out of the mocked Discord passes through here, which is what
 * lets the inspector show a single ordered story: UI action -> gateway dispatch ->
 * bot REST call -> rendered message.
 */
export class Mocker {
  readonly world: World;
  readonly emitter = new Emitter();
  readonly gateway: GatewayServer;
  /** Live interactions keyed by token — the same lookup real Discord does. */
  readonly pending = new Map<string, PendingInteraction>();
  /** Files the bot uploaded, served back so its images actually render. */
  readonly attachments = new AttachmentStore();

  constructor(readonly config: MockerConfig) {
    this.world = new World(config);
    this.gateway = new GatewayServer(this.world, this.emitter);
  }

  snapshot(): BridgeSnapshot {
    return this.world.snapshot(this.emitter.history());
  }

  publishMessage(channelId: string, message: APIMessage): void {
    this.world.addMessage(channelId, message);
    this.emitter.emit({ t: "message:create", d: { channelId, message } });
  }

  republishMessage(channelId: string, message: APIMessage): void {
    this.emitter.emit({ t: "message:update", d: { channelId, message } });
  }

  /** Handles one action from the browser UI. */
  handleClientMessage(message: ClientToServer): void {
    switch (message.t) {
      case "interaction:command":
        this.runCommand(message.d);
        break;
      case "interaction:autocomplete":
        this.runAutocomplete(message.d);
        break;
      case "interaction:component":
        this.runComponent(message.d);
        break;
      case "message:send":
        this.sendUserMessage(message.d);
        break;
    }
  }

  private runCommand(input: {
    channelId: string;
    userId: string;
    commandId: string;
    options: ClientCommandOptions;
  }): void {
    const command = this.world.commands.get(input.commandId);
    const guild = this.world.guildForChannel(input.channelId);
    if (!command || !guild) return;

    const interaction = createCommandInteraction({
      world: this.world,
      guild,
      channelId: input.channelId,
      userId: input.userId,
      commandId: command.id,
      commandName: command.name,
      options: input.options,
      type: InteractionType.ApplicationCommand,
    });

    this.pending.set(interaction.token, {
      interaction,
      channelId: input.channelId,
      guildId: guild.id,
      userId: input.userId,
      deferred: false,
      replied: false,
    });

    // Discord shows the invocation to the user immediately, before the bot answers.
    this.emitter.record("mocker", `/${command.name} invoked`, { options: input.options });
    this.gateway.dispatch(GatewayDispatchEvents.InteractionCreate, interaction);
  }

  private runAutocomplete(input: {
    nonce: string;
    channelId: string;
    userId: string;
    commandId: string;
    options: ClientCommandOptions;
    focused: string;
  }): void {
    const command = this.world.commands.get(input.commandId);
    const guild = this.world.guildForChannel(input.channelId);
    if (!command || !guild) return;

    const options = input.options.map((option) =>
      option.name === input.focused ? { ...option, focused: true } : option,
    );

    const interaction = createCommandInteraction({
      world: this.world,
      guild,
      channelId: input.channelId,
      userId: input.userId,
      commandId: command.id,
      commandName: command.name,
      options,
      type: InteractionType.ApplicationCommandAutocomplete,
    });

    this.pending.set(interaction.token, {
      interaction,
      channelId: input.channelId,
      guildId: guild.id,
      userId: input.userId,
      deferred: false,
      replied: false,
      autocompleteNonce: input.nonce,
    });

    this.gateway.dispatch(GatewayDispatchEvents.InteractionCreate, interaction);
  }

  private runComponent(input: ComponentUse): void {
    const guild = this.world.guildForChannel(input.channelId);
    const found = this.world.findMessage(input.messageId);
    if (!guild || !found) return;

    const interaction = createComponentInteraction({
      world: this.world,
      guild,
      channelId: input.channelId,
      userId: input.userId,
      message: found.message,
      customId: input.customId,
      componentType: input.componentType,
      ...(input.values ? { values: input.values } : {}),
    });

    this.pending.set(interaction.token, {
      interaction,
      channelId: input.channelId,
      guildId: guild.id,
      userId: input.userId,
      deferred: false,
      replied: false,
      sourceMessageId: found.message.id,
    });

    this.emitter.record("mocker", `Component "${input.customId}" used`, {
      componentType: input.componentType,
      values: input.values,
    });
    this.gateway.dispatch(GatewayDispatchEvents.InteractionCreate, interaction);
  }

  private sendUserMessage(input: { channelId: string; userId: string; content: string }): void {
    const guild = this.world.guildForChannel(input.channelId);
    const author = this.world.users.get(input.userId);
    if (!guild || !author) return;

    const message = createMessage({
      channelId: input.channelId,
      guildId: guild.id,
      author,
      content: input.content,
    });

    this.publishMessage(input.channelId, message);
    this.gateway.dispatch(GatewayDispatchEvents.MessageCreate, {
      ...message,
      member: guild.members.get(input.userId),
    });
  }

  /** Creates the "Bot is thinking…" placeholder a deferred reply shows. */
  createLoadingMessage(pending: PendingInteraction): APIMessage {
    return createMessage({
      channelId: pending.channelId,
      guildId: pending.guildId,
      author: this.world.botUser,
      content: "",
      extraFlags: MessageFlags.Loading,
      interactionMetadata: createInteractionMetadata(
        pending.interaction,
        this.world.users.get(pending.userId) ?? this.world.botUser,
      ),
    });
  }

  close(): void {
    this.gateway.close();
  }
}

type ClientCommandOptions = Extract<ClientToServer, { t: "interaction:command" }>["d"]["options"];
