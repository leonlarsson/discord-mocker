import type { SubmittedOption } from "@discord-mocker/protocol";
import type {
  APIApplicationCommandBasicOption,
  APIApplicationCommandOptionChoice,
} from "discord-api-types/v10";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSubmittedOptions,
  hasChoices,
  type InvocableCommand,
  isOptionSatisfied,
  type OptionResolver,
  supportsAutocomplete,
} from "../lib/commands.js";

type MenuItem =
  | { kind: "command"; command: InvocableCommand }
  | { kind: "choice"; label: string; value: string; description?: string };

interface ComposerProps {
  channelName: string;
  commands: InvocableCommand[];
  resolver: OptionResolver;
  onSend: (content: string) => void;
  onRun: (commandId: string, options: SubmittedOption[]) => void;
  onAutocomplete: (input: {
    commandId: string;
    options: SubmittedOption[];
    focused: string;
  }) => Promise<APIApplicationCommandOptionChoice[]>;
}

/**
 * Discord's message box, including the `/` command flow.
 *
 * Faithfulness matters here: a command is only really tested if it is invoked the
 * way a user invokes it — through the picker, with required options enforced and
 * autocomplete round-tripping to the bot on every keystroke.
 */
export function Composer({
  channelName,
  commands,
  resolver,
  onSend,
  onRun,
  onAutocomplete,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [command, setCommand] = useState<InvocableCommand | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [optionIndex, setOptionIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [rawHighlight, setHighlight] = useState(0);
  const [choices, setChoices] = useState<APIApplicationCommandOptionChoice[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentOption: APIApplicationCommandBasicOption | undefined = command?.options[optionIndex];

  const reset = useCallback(() => {
    setCommand(null);
    setValues({});
    setOptionIndex(0);
    setDraft("");
    setText("");
    setChoices([]);
    setHighlight(0);
  }, []);

  // Ask the bot for autocomplete results as the user types into the option.
  useEffect(() => {
    if (!command || !currentOption || !supportsAutocomplete(currentOption)) {
      setChoices([]);
      return;
    }

    const timer = setTimeout(() => {
      void onAutocomplete({
        commandId: command.commandId,
        options: buildSubmittedOptions(
          command,
          { ...values, [currentOption.name]: draft },
          resolver,
        ),
        focused: currentOption.name,
      }).then(setChoices);
    }, 150);

    return () => clearTimeout(timer);
  }, [command, currentOption, draft, values, resolver, onAutocomplete]);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!command) {
      if (!text.startsWith("/")) return [];
      const query = text.slice(1).toLowerCase();
      return commands
        .filter((candidate) => candidate.path.join(" ").toLowerCase().includes(query))
        .map((candidate) => ({ kind: "command" as const, command: candidate }));
    }

    if (!currentOption) return [];

    if (currentOption.type === ApplicationCommandOptionType.Boolean) {
      return [
        { kind: "choice", label: "True", value: "true" },
        { kind: "choice", label: "False", value: "false" },
      ];
    }

    if (hasChoices(currentOption) && "choices" in currentOption) {
      return (currentOption.choices ?? [])
        .filter((choice) => choice.name.toLowerCase().includes(draft.toLowerCase()))
        .map((choice) => ({
          kind: "choice" as const,
          label: choice.name,
          value: String(choice.value),
        }));
    }

    return choices.map((choice) => ({
      kind: "choice" as const,
      label: choice.name,
      value: String(choice.value),
    }));
  }, [command, currentOption, text, commands, draft, choices]);

  const selectCommand = (next: InvocableCommand) => {
    setCommand(next);
    setValues({});
    setOptionIndex(0);
    setDraft("");
    setText("");
    inputRef.current?.focus();
  };

  const commitValue = (raw: string) => {
    if (!currentOption) return;
    setValues((previous) => ({ ...previous, [currentOption.name]: raw }));
    setOptionIndex((index) => index + 1);
    setDraft("");
    setChoices([]);
  };

  const submit = () => {
    if (!command) return;
    if (!isOptionSatisfied(command, values)) return;
    onRun(command.commandId, buildSubmittedOptions(command, values, resolver));
    reset();
  };

  const ready = command ? isOptionSatisfied(command, values) : false;
  // Clamping beats resetting in an effect: the menu shrinks as the user types, and
  // this keeps the highlight valid without an extra render.
  const highlight = Math.min(rawHighlight, Math.max(menuItems.length - 1, 0));

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const item = menuItems[highlight];

    if (event.key === "ArrowDown" && menuItems.length > 0) {
      event.preventDefault();
      setHighlight((index) => (index + 1) % menuItems.length);
      return;
    }

    if (event.key === "ArrowUp" && menuItems.length > 0) {
      event.preventDefault();
      setHighlight((index) => (index - 1 + menuItems.length) % menuItems.length);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      reset();
      return;
    }

    if (event.key === "Tab" && item) {
      event.preventDefault();
      if (item.kind === "command") selectCommand(item.command);
      else commitValue(item.value);
      return;
    }

    if (event.key === "Backspace" && command && draft === "") {
      event.preventDefault();
      if (optionIndex === 0) {
        reset();
        return;
      }
      const previousOption = command.options[optionIndex - 1];
      if (previousOption) {
        setDraft(values[previousOption.name] ?? "");
        setValues((previous) => {
          const next = { ...previous };
          delete next[previousOption.name];
          return next;
        });
        setOptionIndex((index) => index - 1);
      }
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();

    if (!command) {
      if (item?.kind === "command") {
        selectCommand(item.command);
      } else if (text.trim() && !text.startsWith("/")) {
        onSend(text.trim());
        setText("");
      }
      return;
    }

    // A highlighted suggestion wins over the raw text, the way it does in Discord:
    // typing "ap" and hitting Enter picks "Apple", not the literal "ap".
    const engaged = draft !== "" || currentOption?.required === true;
    if (item?.kind === "choice" && engaged) {
      commitValue(item.value);
      return;
    }

    if (draft !== "") {
      commitValue(draft);
      return;
    }

    // With every required option filled, Enter runs the command. Reaching for an
    // optional value is what Tab is for.
    if (ready) {
      submit();
      return;
    }

    if (item?.kind === "choice") {
      commitValue(item.value);
      return;
    }

    submit();
  };

  const entered = command
    ? command.options.slice(0, optionIndex).filter((option) => values[option.name])
    : [];

  return (
    <div className="composer-area">
      {menuItems.length > 0 || (text.startsWith("/") && !command) ? (
        <div className="command-menu">
          <div className="command-menu-header">
            {command
              ? `/${command.path.join(" ")}${currentOption ? ` — ${currentOption.name}` : ""}`
              : "Commands"}
          </div>
          <div className="command-menu-list">
            {menuItems.length === 0 ? (
              <div className="command-menu-empty">
                {commands.length === 0
                  ? "No commands registered yet — is your bot connected?"
                  : "No matches"}
              </div>
            ) : null}

            {menuItems.map((item, index) => (
              <button
                key={item.kind === "command" ? item.command.key : `${item.label}-${item.value}`}
                type="button"
                className={`command-row ${index === highlight ? "selected" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() =>
                  item.kind === "command" ? selectCommand(item.command) : commitValue(item.value)
                }
              >
                {item.kind === "command" ? (
                  <>
                    <span className="command-row-icon">/</span>
                    <span className="command-row-name">
                      {item.command.path.join(" ")}
                      <span className="command-row-args">
                        {item.command.options
                          .map((option) => (option.required ? option.name : `[${option.name}]`))
                          .join(" ")}
                      </span>
                    </span>
                    <span className="command-row-description">{item.command.description}</span>
                  </>
                ) : (
                  <span className="command-row-name">{item.label}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="composer">
        {command ? <span className="composer-chip">/{command.path.join(" ")}</span> : null}

        {entered.map((option) => (
          <span key={option.name} className="composer-option-chip">
            <span className="composer-option-name">{option.name}:</span>
            {values[option.name]}
          </span>
        ))}

        <input
          ref={inputRef}
          className="composer-input"
          value={command ? draft : text}
          onChange={(event) =>
            command ? setDraft(event.target.value) : setText(event.target.value)
          }
          onKeyDown={handleKeyDown}
          placeholder={
            command
              ? currentOption
                ? `${currentOption.name}${currentOption.required ? "" : " (optional)"}`
                : "Press Enter to run"
              : `Message #${channelName}`
          }
        />

        {command && currentOption ? (
          <span className={`composer-hint ${currentOption.required ? "required" : ""}`}>
            {currentOption.description}
          </span>
        ) : null}

        {command && !currentOption ? (
          <span className={`composer-hint ${ready ? "" : "required"}`}>
            {ready ? "Enter to run" : "missing required options"}
          </span>
        ) : null}
      </label>
    </div>
  );
}
