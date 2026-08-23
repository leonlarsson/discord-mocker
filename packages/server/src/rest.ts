import { generateSnowflake, REST_API_VERSION } from "@discord-mocker/protocol";
import type {
  APIApplicationCommand,
  APIInteractionResponse,
  APIInteractionResponseCallbackData,
  APIMessage,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import {
  ApplicationCommandType,
  InteractionResponseType,
  MessageFlags,
} from "discord-api-types/v10";
import type { Context } from "hono";
import { Hono } from "hono";
import { applyMessageEdit, createInteractionMetadata, createMessage } from "./factories.js";
import type { Mocker, PendingInteraction } from "./mocker.js";

/**
 * Reads a request body as JSON, transparently unwrapping the multipart form
 * discord.js uses whenever a request carries attachments.
 */
/**
 * Which message `@original` refers to for a given interaction.
 *
 * For `reply()`/`deferReply()` it is the new response message. For a component's
 * `update()`/`deferUpdate()` it is the message the component sits on — the same
 * split real Discord makes.
 */
function originalMessageId(pending: PendingInteraction | undefined): string | undefined {
  if (!pending) return undefined;
  return pending.targetsSource ? pending.sourceMessageId : pending.responseMessageId;
}

async function readBody<T>(c: Context): Promise<T> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const payload = form.get("payload_json");
    return (typeof payload === "string" ? JSON.parse(payload) : {}) as T;
  }
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

function registerCommands(
  mocker: Mocker,
  body: RESTPostAPIApplicationCommandsJSONBody[],
  guildId?: string,
): APIApplicationCommand[] {
  // A bulk PUT replaces the scope's command set, exactly as Discord does.
  for (const [id, command] of mocker.world.commands) {
    if ((command.guild_id ?? undefined) === guildId) mocker.world.commands.delete(id);
  }

  const registered = body.map((command) => {
    const built = {
      ...command,
      id: generateSnowflake(),
      type: command.type ?? ApplicationCommandType.ChatInput,
      application_id: mocker.world.applicationId,
      version: generateSnowflake(),
      default_member_permissions: command.default_member_permissions ?? null,
      ...(guildId ? { guild_id: guildId } : {}),
    } as APIApplicationCommand;
    mocker.world.commands.set(built.id, built);
    return built;
  });

  mocker.emitter.emit({ t: "commands", d: [...mocker.world.commands.values()] });
  mocker.emitter.record(
    "mocker",
    `Registered ${registered.length} ${guildId ? "guild" : "global"} command(s)`,
    registered.map((command) => command.name),
  );
  return registered;
}

/**
 * Turns an interaction callback into a visible message, mirroring what a user
 * would see in a real client.
 */
function materializeResponse(
  mocker: Mocker,
  pending: PendingInteraction,
  data: APIInteractionResponseCallbackData | undefined,
  options: { loading: boolean },
): APIMessage {
  const message = options.loading
    ? mocker.createLoadingMessage(pending)
    : createMessage({
        channelId: pending.channelId,
        guildId: pending.guildId,
        author: mocker.world.botUser,
        data,
        interactionMetadata: createInteractionMetadata(
          pending.interaction,
          mocker.world.users.get(pending.userId) ?? mocker.world.botUser,
        ),
      });

  if (options.loading && data?.flags) message.flags = (message.flags ?? 0) | data.flags;

  pending.responseMessageId = message.id;
  mocker.publishMessage(pending.channelId, message);
  return message;
}

export function createRestApp(mocker: Mocker): Hono {
  const api = new Hono();

  api.use("*", async (c, next) => {
    const started = Date.now();
    // discord.js reads these off every response to drive its rate limiter.
    c.header("x-ratelimit-limit", "50");
    c.header("x-ratelimit-remaining", "49");
    c.header("x-ratelimit-reset-after", "1");
    c.header("x-ratelimit-bucket", "mocker");
    mocker.emitter.record("rest:request", `${c.req.method} ${c.req.path}`);
    await next();
    mocker.emitter.record(
      "rest:response",
      `${c.res.status} ${c.req.method} ${c.req.path}`,
      undefined,
      Date.now() - started,
    );
  });

  // --- Connection handshake -------------------------------------------------

  api.get("/gateway/bot", (c) => {
    const host = c.req.header("host") ?? "localhost";
    return c.json({
      url: `ws://${host}/gateway`,
      shards: 1,
      session_start_limit: {
        total: 1000,
        remaining: 1000,
        reset_after: 0,
        max_concurrency: 1,
      },
    });
  });

  api.get("/gateway", (c) => {
    const host = c.req.header("host") ?? "localhost";
    return c.json({ url: `ws://${host}/gateway` });
  });

  api.get("/users/@me", (c) => c.json(mocker.world.botUser));

  api.get("/oauth2/applications/@me", (c) =>
    c.json({
      id: mocker.world.applicationId,
      name: mocker.world.botUser.username,
      description: "Mocked application",
      bot_public: false,
      bot_require_code_grant: false,
      flags: 0,
      owner: mocker.world.botUser,
    }),
  );

  // --- Command registration -------------------------------------------------

  api.put("/applications/:applicationId/commands", async (c) =>
    c.json(registerCommands(mocker, await readBody(c))),
  );

  api.put("/applications/:applicationId/guilds/:guildId/commands", async (c) =>
    c.json(registerCommands(mocker, await readBody(c), c.req.param("guildId"))),
  );

  api.post("/applications/:applicationId/commands", async (c) => {
    const [command] = registerCommands(mocker, [await readBody(c)]);
    return c.json(command, 201);
  });

  api.post("/applications/:applicationId/guilds/:guildId/commands", async (c) => {
    const [command] = registerCommands(mocker, [await readBody(c)], c.req.param("guildId"));
    return c.json(command, 201);
  });

  api.get("/applications/:applicationId/commands", (c) =>
    c.json([...mocker.world.commands.values()].filter((command) => !command.guild_id)),
  );

  api.get("/applications/:applicationId/guilds/:guildId/commands", (c) =>
    c.json(
      [...mocker.world.commands.values()].filter(
        (command) => command.guild_id === c.req.param("guildId"),
      ),
    ),
  );

  // --- Interaction responses ------------------------------------------------

  api.post("/interactions/:interactionId/:token/callback", async (c) => {
    const pending = mocker.pending.get(c.req.param("token"));
    if (!pending) return c.json({ message: "Unknown interaction", code: 10062 }, 404);

    const body = await readBody<APIInteractionResponse>(c);
    const data = "data" in body ? (body.data as APIInteractionResponseCallbackData) : undefined;
    let message: APIMessage | undefined;

    switch (body.type) {
      case InteractionResponseType.ChannelMessageWithSource:
        if (pending.replied)
          return c.json({ message: "Interaction has already been acknowledged", code: 40060 }, 400);
        pending.replied = true;
        message = materializeResponse(mocker, pending, data, { loading: false });
        break;

      case InteractionResponseType.DeferredChannelMessageWithSource:
        if (pending.replied)
          return c.json({ message: "Interaction has already been acknowledged", code: 40060 }, 400);
        pending.replied = true;
        pending.deferred = true;
        message = materializeResponse(mocker, pending, data, { loading: true });
        break;

      case InteractionResponseType.UpdateMessage: {
        if (pending.replied)
          return c.json({ message: "Interaction has already been acknowledged", code: 40060 }, 400);
        pending.replied = true;
        pending.targetsSource = true;

        const source = pending.sourceMessageId
          ? mocker.world.findMessage(pending.sourceMessageId)
          : undefined;
        if (!source) return c.json({ message: "Unknown Message", code: 10008 }, 404);

        message = applyMessageEdit(source.message, data ?? {}, { markEdited: false });
        mocker.republishMessage(source.channelId, message);
        break;
      }

      case InteractionResponseType.DeferredMessageUpdate: {
        if (pending.replied)
          return c.json({ message: "Interaction has already been acknowledged", code: 40060 }, 400);
        // Acknowledged silently: nothing changes until the bot edits.
        pending.replied = true;
        pending.deferred = true;
        pending.targetsSource = true;
        break;
      }

      case InteractionResponseType.ApplicationCommandAutocompleteResult: {
        const choices = (data as { choices?: [] } | undefined)?.choices ?? [];
        if (pending.autocompleteNonce) {
          mocker.emitter.emit({
            t: "autocomplete",
            d: { nonce: pending.autocompleteNonce, choices },
          });
        }
        mocker.pending.delete(pending.interaction.token);
        break;
      }

      default:
        mocker.emitter.record("mocker", `Unsupported callback type ${body.type}`, body);
        break;
    }

    if (c.req.query("with_response") === "true") {
      return c.json({
        interaction: {
          id: pending.interaction.id,
          type: pending.interaction.type,
          response_message_id: message?.id,
          response_message_loading: pending.deferred,
          response_message_ephemeral: Boolean((message?.flags ?? 0) & MessageFlags.Ephemeral),
        },
        ...(message ? { resource: { type: body.type, message } } : {}),
      });
    }

    return c.body(null, 204);
  });

  // --- Followups and edits (the webhook surface) ----------------------------

  api.get("/webhooks/:applicationId/:token/messages/:messageId", (c) => {
    const pending = mocker.pending.get(c.req.param("token"));
    const messageId = c.req.param("messageId");
    const targetId = messageId === "@original" ? originalMessageId(pending) : messageId;
    const found = targetId ? mocker.world.findMessage(targetId) : undefined;
    if (!found) return c.json({ message: "Unknown Message", code: 10008 }, 404);
    return c.json(found.message);
  });

  api.patch("/webhooks/:applicationId/:token/messages/:messageId", async (c) => {
    const pending = mocker.pending.get(c.req.param("token"));
    const messageId = c.req.param("messageId");
    const targetId = messageId === "@original" ? originalMessageId(pending) : messageId;
    const found = targetId ? mocker.world.findMessage(targetId) : undefined;
    if (!found) return c.json({ message: "Unknown Message", code: 10008 }, 404);

    const data = await readBody<APIInteractionResponseCallbackData>(c);
    // Editing a component's own message is an update, not a user-visible edit.
    const updated = applyMessageEdit(found.message, data, {
      markEdited: !pending?.targetsSource,
    });
    mocker.republishMessage(found.channelId, updated);
    return c.json(updated);
  });

  api.delete("/webhooks/:applicationId/:token/messages/:messageId", (c) => {
    const pending = mocker.pending.get(c.req.param("token"));
    const messageId = c.req.param("messageId");
    const targetId = messageId === "@original" ? originalMessageId(pending) : messageId;
    const found = targetId ? mocker.world.findMessage(targetId) : undefined;
    if (found) {
      const messages = mocker.world.messages.get(found.channelId) ?? [];
      mocker.world.messages.set(
        found.channelId,
        messages.filter((message) => message.id !== found.message.id),
      );
      mocker.emitter.emit({
        t: "message:delete",
        d: { channelId: found.channelId, messageId: found.message.id },
      });
    }
    return c.body(null, 204);
  });

  api.post("/webhooks/:applicationId/:token", async (c) => {
    const pending = mocker.pending.get(c.req.param("token"));
    if (!pending) return c.json({ message: "Unknown Webhook", code: 10015 }, 404);

    const data = await readBody<APIInteractionResponseCallbackData>(c);
    const message = createMessage({
      channelId: pending.channelId,
      guildId: pending.guildId,
      author: mocker.world.botUser,
      data,
      interactionMetadata: createInteractionMetadata(
        pending.interaction,
        mocker.world.users.get(pending.userId) ?? mocker.world.botUser,
      ),
    });
    mocker.publishMessage(pending.channelId, message);
    return c.json(message);
  });

  // --- Channels -------------------------------------------------------------

  api.get("/channels/:channelId", (c) => {
    const channel = mocker.world.channels.get(c.req.param("channelId"));
    if (!channel) return c.json({ message: "Unknown Channel", code: 10003 }, 404);
    return c.json(channel);
  });

  api.post("/channels/:channelId/messages", async (c) => {
    const channelId = c.req.param("channelId");
    const guild = mocker.world.guildForChannel(channelId);
    if (!guild) return c.json({ message: "Unknown Channel", code: 10003 }, 404);

    const data = await readBody<APIInteractionResponseCallbackData>(c);
    const message = createMessage({
      channelId,
      guildId: guild.id,
      author: mocker.world.botUser,
      data,
    });
    mocker.publishMessage(channelId, message);
    return c.json(message);
  });

  api.get("/channels/:channelId/messages", (c) =>
    c.json([...(mocker.world.messages.get(c.req.param("channelId")) ?? [])].reverse()),
  );

  api.notFound((c) => {
    mocker.emitter.record("mocker", `Unmocked route: ${c.req.method} ${c.req.path}`);
    return c.json({ message: "404: Not Found", code: 0 }, 404);
  });

  const app = new Hono();
  app.route(`/api/v${REST_API_VERSION}`, api);
  // discord.js can be pointed at a versionless base too.
  app.route("/api", api);
  return app;
}
