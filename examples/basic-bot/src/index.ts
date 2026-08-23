/**
 * A completely ordinary discord.js bot.
 *
 * The only mocker-specific line is the `rest.api` option — discord.js asks that
 * base URL for a gateway address, so overriding it redirects the entire client,
 * gateway included, at the mocker. Point it back at Discord and this bot runs
 * unchanged in production.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
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
  new SlashCommandBuilder().setName("panel").setDescription("Buttons and select menus to poke at"),
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

/** Counter state per panel message, to show `update()` mutating a message in place. */
const counters = new Map<string, number>();

function buildPanel(count: number) {
  const buttons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("count").setLabel("Count up").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("reset")
      .setLabel("Reset")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(count === 0),
    new ButtonBuilder().setCustomId("slow").setLabel("Slow update").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("secret").setLabel("Ephemeral").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel("Docs")
      .setStyle(ButtonStyle.Link)
      .setURL("https://discord.js.org"),
  );

  const flavours = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("flavour")
      .setPlaceholder("Pick a flavour")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Vanilla")
          .setValue("vanilla")
          .setDescription("The safe one"),
        new StringSelectMenuOptionBuilder().setLabel("Chocolate").setValue("chocolate"),
        new StringSelectMenuOptionBuilder().setLabel("Pistachio").setValue("pistachio"),
      ),
  );

  const toppings = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("toppings")
      .setPlaceholder("Pick up to two toppings")
      .setMinValues(1)
      .setMaxValues(2)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Sprinkles").setValue("sprinkles"),
        new StringSelectMenuOptionBuilder().setLabel("Fudge").setValue("fudge"),
        new StringSelectMenuOptionBuilder().setLabel("Nuts").setValue("nuts"),
      ),
  );

  const people = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId("who").setPlaceholder("Pick a member"),
  );

  const roles = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new RoleSelectMenuBuilder().setCustomId("role").setPlaceholder("Pick a role"),
  );

  return {
    content: `Counter: **${count}**`,
    components: [buttons, flavours, toppings, people, roles],
  };
}

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

    case "panel": {
      await interaction.reply(buildPanel(0));
      break;
    }

    case "search": {
      const fruit = interaction.options.getString("fruit", true);
      await interaction.reply(`You picked **${fruit}**.`);
      break;
    }

    case "whoami": {
      // inCachedGuild() narrows `member` to a full GuildMember; without it the
      // member may be the raw API shape, where `roles` is a list of IDs.
      const roleMentions = interaction.inCachedGuild()
        ? interaction.member.roles.cache
            .filter((role) => role.name !== "@everyone")
            .map((role) => `<@&${role.id}>`)
        : [];

      const embed = new EmbedBuilder()
        .setTitle(interaction.user.username)
        .setColor(0x5865f2)
        .addFields(
          { name: "User ID", value: interaction.user.id, inline: true },
          { name: "Channel", value: `<#${interaction.channelId}>`, inline: true },
          { name: "Roles", value: roleMentions.join(" ") || "none" },
        );
      await interaction.reply({ embeds: [embed] });
      break;
    }
  }
});

/** Buttons and select menus both arrive as component interactions. */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isMessageComponent()) return;

  const messageId = interaction.message.id;
  const count = counters.get(messageId) ?? 0;

  if (interaction.isButton()) {
    const button = interaction as ButtonInteraction;
    switch (button.customId) {
      case "count":
        counters.set(messageId, count + 1);
        // update() edits the message the component lives on, in place.
        await button.update(buildPanel(count + 1));
        return;

      case "reset":
        counters.set(messageId, 0);
        await button.update(buildPanel(0));
        return;

      case "slow":
        // deferUpdate() acknowledges silently, then the edit lands later.
        await button.deferUpdate();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        counters.set(messageId, count + 10);
        await button.editReply(buildPanel(count + 10));
        return;

      case "secret":
        await button.reply({
          content: "This reply is only visible to you.",
          flags: MessageFlags.Ephemeral,
        });
        return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    await interaction.reply({
      content: `You chose: ${interaction.values.map((value) => `**${value}**`).join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.isUserSelectMenu()) {
    const picked = interaction.users.map((user) => `<@${user.id}>`).join(", ");
    await interaction.reply({ content: `You picked ${picked}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    const picked = interaction.roles.map((role) => `<@&${role.id}>`).join(", ");
    await interaction.reply({ content: `You picked ${picked}`, flags: MessageFlags.Ephemeral });
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
