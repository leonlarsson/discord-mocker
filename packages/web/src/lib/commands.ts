import type { SubmittedOption } from "@discord-mocker/protocol";
import type {
  APIApplicationCommand,
  APIApplicationCommandBasicOption,
  APIApplicationCommandOption,
} from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord-api-types/v10";

/**
 * One thing a user can actually invoke.
 *
 * Discord's command menu lists leaves, not commands: `/config set` and
 * `/config get` are two rows, never one row you drill into. Flattening
 * subcommand groups up front is what lets the composer match that.
 */
export interface InvocableCommand {
  key: string;
  commandId: string;
  /** e.g. `["config", "channel", "set"]` */
  path: string[];
  description: string;
  options: APIApplicationCommandBasicOption[];
}

const isSubcommand = (option: APIApplicationCommandOption) =>
  option.type === ApplicationCommandOptionType.Subcommand ||
  option.type === ApplicationCommandOptionType.SubcommandGroup;

export function flattenCommands(commands: APIApplicationCommand[]): InvocableCommand[] {
  const invocable: InvocableCommand[] = [];

  const walk = (
    commandId: string,
    path: string[],
    description: string,
    options: APIApplicationCommandOption[] | undefined,
  ) => {
    const children = (options ?? []).filter(isSubcommand);
    if (children.length === 0) {
      invocable.push({
        key: `${commandId}:${path.join(".")}`,
        commandId,
        path,
        description,
        options: (options ?? []) as APIApplicationCommandBasicOption[],
      });
      return;
    }
    for (const child of children) {
      walk(
        commandId,
        [...path, child.name],
        child.description,
        "options" in child ? child.options : undefined,
      );
    }
  };

  for (const command of commands) {
    walk(command.id, [command.name], command.description, command.options);
  }

  return invocable;
}

export interface OptionResolver {
  userIdByName: (name: string) => string | undefined;
  channelIdByName: (name: string) => string | undefined;
}

function coerce(
  option: APIApplicationCommandBasicOption,
  raw: string,
  resolver: OptionResolver,
): string | number | boolean | undefined {
  switch (option.type) {
    case ApplicationCommandOptionType.Boolean:
      return raw.toLowerCase() === "true";
    case ApplicationCommandOptionType.Integer:
      return Number.parseInt(raw, 10);
    case ApplicationCommandOptionType.Number:
      return Number.parseFloat(raw);
    case ApplicationCommandOptionType.User:
    case ApplicationCommandOptionType.Mentionable:
      return resolver.userIdByName(raw.replace(/^@/, "")) ?? raw;
    case ApplicationCommandOptionType.Channel:
      return resolver.channelIdByName(raw.replace(/^#/, "")) ?? raw;
    default:
      return raw;
  }
}

/** Nests entered values back under their subcommand path, the way Discord sends them. */
export function buildSubmittedOptions(
  command: InvocableCommand,
  values: Record<string, string>,
  resolver: OptionResolver,
): SubmittedOption[] {
  const leaf: SubmittedOption[] = command.options
    .filter((option) => values[option.name] !== undefined && values[option.name] !== "")
    .map((option) => ({
      name: option.name,
      type: option.type,
      value: coerce(option, values[option.name] ?? "", resolver),
    }));

  const [, ...subPath] = command.path;
  if (subPath.length === 0) return leaf;

  return subPath.reduceRight<SubmittedOption[]>((nested, name, index) => {
    return [
      {
        name,
        type:
          index === subPath.length - 1
            ? ApplicationCommandOptionType.Subcommand
            : ApplicationCommandOptionType.SubcommandGroup,
        options: nested,
      },
    ];
  }, leaf);
}

export function isOptionSatisfied(
  command: InvocableCommand,
  values: Record<string, string>,
): boolean {
  return command.options
    .filter((option) => option.required)
    .every((option) => (values[option.name] ?? "").length > 0);
}

export function hasChoices(option: APIApplicationCommandBasicOption): boolean {
  return "choices" in option && Array.isArray(option.choices) && option.choices.length > 0;
}

export function supportsAutocomplete(option: APIApplicationCommandBasicOption): boolean {
  return "autocomplete" in option && option.autocomplete === true;
}

export function optionTypeLabel(option: APIApplicationCommandBasicOption): string {
  return ApplicationCommandOptionType[option.type] ?? "value";
}
