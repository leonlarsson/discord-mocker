/**
 * A completely ordinary discord.js bot.
 *
 * The only mocker-specific line is the `rest.api` option — discord.js asks that
 * base URL for a gateway address, so overriding it redirects the entire client,
 * gateway included, at the mocker. Point it back at Discord and this bot runs
 * unchanged in production.
 */
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

const API = process.env.DISCORD_API ?? "http://localhost:5100/api";
const TOKEN = process.env.DISCORD_TOKEN ?? "mock.token.forlocaldevelopmentonly";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  rest: { api: API },
});

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Replies immediately"),
  new SlashCommandBuilder()
    .setName("echo")
    .setDescription("Repeats what you say")
    .addStringOption((option) =>
      option.setName("text").setDescription("What to repeat").setRequired(true),
    )
    .addBooleanOption((option) => option.setName("private").setDescription("Reply ephemerally")),
  new SlashCommandBuilder()
    .setName("slow")
    .setDescription("Defers, then edits the reply two seconds later"),
  new SlashCommandBuilder().setName("whoami").setDescription("Shows who invoked the command"),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Demonstrates autocomplete")
    .addStringOption((option) =>
      option
        .setName("fruit")
        .setDescription("Start typing to search")
        .setRequired(true)
        .setAutocomplete(true),
    ),
];

const FRUITS = ["Apple", "Apricot", "Banana", "Blackberry", "Cherry", "Grape", "Mango", "Peach"];

client.once(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.username} (${ready.user.id})`);

  for (const guild of ready.guilds.cache.values()) {
    await guild.commands.set(commands.map((command) => command.toJSON()));
    console.log(`Registered ${commands.length} commands in ${guild.name}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "ping":
      await interaction.reply(`Pong! Gateway heartbeat: ${client.ws.ping}ms`);
      break;

    case "echo": {
      const text = interaction.options.getString("text", true);
      const isPrivate = interaction.options.getBoolean("private") ?? false;
      await interaction.reply({
        content: text,
        flags: isPrivate ? MessageFlags.Ephemeral : undefined,
      });
      break;
    }

    case "slow": {
      await interaction.deferReply();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await interaction.editReply("Done thinking.");
      break;
    }

    case "search": {
      const fruit = interaction.options.getString("fruit", true);
      await interaction.reply(`You picked **${fruit}**.`);
      break;
    }

    case "whoami": {
      const embed = new EmbedBuilder()
        .setTitle(interaction.user.username)
        .setColor(0x5865f2)
        .addFields(
          { name: "User ID", value: interaction.user.id, inline: true },
          { name: "Channel", value: `<#${interaction.channelId}>`, inline: true },
          {
            name: "Roles",
            value:
              interaction.member && "roles" in interaction.member
                ? interaction.member.roles.cache
                    .filter((role) => role.name !== "@everyone")
                    .map((role) => `<@&${role.id}>`)
                    .join(" ") || "none"
                : "none",
          },
        );
      await interaction.reply({ embeds: [embed] });
      break;
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isAutocomplete()) return;
  const focused = interaction.options.getFocused().toLowerCase();
  await interaction.respond(
    FRUITS.filter((fruit) => fruit.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((fruit) => ({ name: fruit, value: fruit })),
  );
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  console.log(`#${message.channelId} <${message.author.username}> ${message.content}`);
});

await client.login(TOKEN);
