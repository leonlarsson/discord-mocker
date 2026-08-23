# discord-mocker

A local Discord client — UI and all — that your **unmodified discord.js bot** connects to.

Point your bot at the mocker instead of Discord, open a browser, type `/yourcommand`, and
watch it respond in a client that looks like Discord. No test server, no real tokens, no
waiting for command registration to propagate.

```
┌─ browser ──────────────────────────────────┐      ┌─ your bot ──────────────┐
│  Discord clone UI  +  payload inspector    │      │  discord.js, unchanged  │
└───────────────▲────────────────────────────┘      └───────────▲─────────────┘
                │ mocker bridge (ws)                            │ real gateway + REST
┌───────────────▼───────────────────────────────────────────────▼─────────────┐
│  mocker server — fake gateway, fake REST API, in-memory Discord world        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The one line you change

discord.js discovers its gateway by asking the REST API for it, so overriding the REST base
URL redirects the whole client — gateway included:

```ts
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  rest: { api: "http://localhost:5100/api" }, // the only mocker-specific line
});
```

Point it back at Discord and the same bot runs in production. Nothing else in your code
knows the mocker exists — no import swaps, no dependency injection, no mock client class.
Your commands register through the same `PUT /applications/…/commands` call they always
did, and the UI's command picker populates itself from whatever your bot registered.

## Quick start

```bash
pnpm install
pnpm build     # required before first run: the CLI serves the built UI

# terminal 1 — the mocker
cd examples/basic-bot && pnpm mocker

# terminal 2 — the bot
cd examples/basic-bot && pnpm start
```

Windows, macOS and Linux all work the same way. Node 20.11+ is required; a
`mocker.config.ts` needs Node 22.18+ to be loaded directly, or you can use
`mocker.config.js` on older versions.

Open <http://localhost:5100> and type `/`.

For working on the mocker itself, `pnpm dev` runs the server and the UI with watch mode
(UI on <http://localhost:5101>, proxying to the server on 5100).

## What works today

**Interactions**
- Slash commands, including subcommands and subcommand groups
- All basic option types, with required-option enforcement in the composer
- Autocomplete — every keystroke round-trips to your bot and renders its choices
- `reply`, `deferReply` + `editReply` (with the real "Bot is thinking…" state), `followUp`,
  ephemeral replies, and deleting responses

**Message components**
- Buttons in every style, including disabled and link buttons
- String select menus, with descriptions, placeholders and multi-select (`min_values`/
  `max_values`) — a multi-select submits when it closes, as Discord's does
- User, role, mentionable and channel selects, with their options drawn from the mocked
  world and their `resolved` payload filled in, so `interaction.users` and
  `interaction.roles` work rather than coming back empty
- `update()` and `deferUpdate()` edit the message the component lives on; `reply()` and
  `deferReply()` post a new one — the same split Discord makes

**The client**
- Guild rail, channel sidebar, member list, message grouping, embeds with inline fields
- Discord-flavoured markdown: bold, italic, underline, strike, spoilers, code, code blocks,
  user/channel/role mentions rendered with the role's real colour, `<t:…>` timestamps, links
- Ephemeral replies marked "Only you can see this"
- Switch which user you are acting as, from the account panel

**Messages**
- Sending a message dispatches `MESSAGE_CREATE` to your bot
- Bots can post to channels through `POST /channels/:id/messages`

**The inspector**
- Every gateway frame and REST call in one ordered log, filterable, with expandable payloads
  and response timings

## Configuration

Drop a `mocker.config.ts` next to your bot and it becomes version-controlled fixture data,
so everyone testing the bot gets the same world:

```ts
import { defineConfig } from "@discord-mocker/protocol";

export default defineConfig({
  port: 5100,
  defaultUser: "leon",
  users: [{ username: "leon", globalName: "Leon" }],
  guilds: [
    {
      name: "Mocker Test Server",
      roles: [{ name: "Admin", color: "#eb459e", permissions: "8" }],
      channels: [{ name: "general", topic: "General chatter" }],
      members: [{ user: "leon", roles: ["Admin"] }],
    },
  ],
});
```

Everything is optional — with no config at all, the mocker boots a sensible default world.

## Layout

| Package | What it is |
| --- | --- |
| `packages/protocol` | Shared vocabulary: gateway constants, config types, the UI bridge protocol. Typed against `discord-api-types`, the same package discord.js uses, so payload mistakes are compile errors. |
| `packages/server` | The fake gateway, the fake REST API, and the in-memory world. |
| `packages/web` | The client clone and the inspector (Vite + React). |
| `packages/cli` | `discord-mocker` — loads your config, serves the UI and the API on one port. |
| `examples/basic-bot` | An ordinary discord.js bot used as the development fixture. |

## Not there yet

Modals and context menus. Also: attachments, threads, reactions, HTTP interaction endpoint
mode (Ed25519-signed POSTs for serverless bots), and a headless assertion API for running
the same flows in CI.

One deliberate deviation: a component's `update()` does not badge its message "(edited)",
matching what you see in real bot panels, while `editReply` on a normal reply does.
