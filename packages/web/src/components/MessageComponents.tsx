import type {
  APIButtonComponent,
  APIMessageComponent,
  APIMessageComponentEmoji,
  APISelectMenuComponent,
  APISelectMenuOption,
} from "discord-api-types/v10";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { useEffect, useRef, useState } from "react";
import type { MentionContext } from "../lib/markdown.js";

export interface ComponentUseInput {
  customId: string;
  componentType: number;
  values?: string[];
}

const BUTTON_STYLE_CLASS: Record<number, string> = {
  [ButtonStyle.Primary]: "primary",
  [ButtonStyle.Secondary]: "secondary",
  [ButtonStyle.Success]: "success",
  [ButtonStyle.Danger]: "danger",
  [ButtonStyle.Link]: "link",
  [ButtonStyle.Premium]: "premium",
};

function Emoji({ emoji }: { emoji: APIMessageComponentEmoji | undefined }) {
  if (!emoji?.name) return null;
  return <span className="component-emoji">{emoji.name}</span>;
}

function Button({
  button,
  onUse,
}: {
  button: APIButtonComponent;
  onUse: (input: ComponentUseInput) => void;
}) {
  const className = `discord-button ${BUTTON_STYLE_CLASS[button.style] ?? "secondary"}`;

  // Link buttons never reach the bot — they are just anchors, so treat them as such.
  if (button.style === ButtonStyle.Link) {
    return (
      <a
        className={className}
        href={button.disabled || !("url" in button) ? undefined : button.url}
        target="_blank"
        rel="noreferrer"
      >
        <Emoji emoji={"emoji" in button ? button.emoji : undefined} />
        {"label" in button ? button.label : null}
        <span className="button-external" aria-hidden>
          ↗
        </span>
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={button.disabled ?? false}
      onClick={() =>
        "custom_id" in button
          ? onUse({ customId: button.custom_id, componentType: ComponentType.Button })
          : undefined
      }
    >
      <Emoji emoji={"emoji" in button ? button.emoji : undefined} />
      {"label" in button ? button.label : null}
    </button>
  );
}

/** Entity selects have no inline options — their choices come from the mocked world. */
function optionsFor(
  menu: APISelectMenuComponent,
  context: MentionContext,
): Array<APISelectMenuOption & { color?: string }> {
  switch (menu.type) {
    case ComponentType.StringSelect:
      return menu.options ?? [];

    case ComponentType.UserSelect:
    case ComponentType.MentionableSelect: {
      const users = [...context.usersById.values()]
        .filter((user) => context.guild?.memberIds.includes(user.id))
        .map((user) => ({
          label: user.global_name ?? user.username,
          value: user.id,
          description: `@${user.username}`,
        }));
      if (menu.type === ComponentType.UserSelect) return users;
      return [
        ...users,
        ...(context.guild?.roles ?? [])
          .filter((role) => role.name !== "@everyone")
          .map((role) => ({
            label: `@${role.name}`,
            value: role.id,
            description: "role",
            color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : undefined,
          })),
      ];
    }

    case ComponentType.RoleSelect:
      return (context.guild?.roles ?? []).map((role) => ({
        label: `@${role.name}`,
        value: role.id,
        color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : undefined,
      }));

    case ComponentType.ChannelSelect:
      return (context.guild?.channels ?? []).map((channel) => ({
        label: `#${channel.name ?? channel.id}`,
        value: channel.id,
      }));

    default:
      return [];
  }
}

function SelectMenu({
  menu,
  context,
  onUse,
}: {
  menu: APISelectMenuComponent;
  context: MentionContext;
  onUse: (input: ComponentUseInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = optionsFor(menu, context);
  const maxValues = menu.max_values ?? 1;
  const minValues = menu.min_values ?? 1;
  const multi = maxValues > 1;

  // A multi-select submits when it closes, the way Discord's does.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (multi && selected.length >= minValues) {
        onUse({ customId: menu.custom_id, componentType: menu.type, values: selected });
        setSelected([]);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, multi, selected, minValues, menu.custom_id, menu.type, onUse]);

  const choose = (value: string) => {
    if (!multi) {
      setOpen(false);
      onUse({ customId: menu.custom_id, componentType: menu.type, values: [value] });
      return;
    }
    setSelected((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : current.length >= maxValues
          ? current
          : [...current, value],
    );
  };

  const summary =
    selected.length > 0
      ? options
          .filter((option) => selected.includes(option.value))
          .map((option) => option.label)
          .join(", ")
      : (menu.placeholder ?? "Make a selection");

  return (
    <div className="select-container" ref={containerRef}>
      <button
        type="button"
        className={`select-trigger ${open ? "open" : ""}`}
        disabled={menu.disabled ?? false}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={selected.length > 0 ? "select-value" : "select-placeholder"}>
          {summary}
        </span>
        <span className="select-chevron" aria-hidden>
          ⌄
        </span>
      </button>

      {open ? (
        <div className="select-menu">
          {options.length === 0 ? (
            <div className="select-empty">No options</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`select-option ${selected.includes(option.value) ? "selected" : ""}`}
                onClick={() => choose(option.value)}
              >
                <span
                  className="select-option-label"
                  style={option.color ? { color: option.color } : undefined}
                >
                  {option.emoji?.name ? (
                    <span className="component-emoji">{option.emoji.name}</span>
                  ) : null}
                  {option.label}
                </span>
                {option.description ? (
                  <span className="select-option-description">{option.description}</span>
                ) : null}
                {multi && selected.includes(option.value) ? (
                  <span className="select-check" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a message's action rows.
 *
 * Unknown component types are skipped rather than crashing the message: bots reach
 * for new component types faster than a mocker can follow, and a message that
 * renders partially beats one that does not render at all.
 */
export function MessageComponents({
  components,
  context,
  onUse,
}: {
  components: APIMessageComponent[];
  context: MentionContext;
  onUse: (input: ComponentUseInput) => void;
}) {
  return (
    <>
      {components.map((row, rowIndex) => {
        if (row.type !== ComponentType.ActionRow) return null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows never reorder within a message
          <div className="action-row" key={`row-${rowIndex}`}>
            {row.components.map((component) => {
              if (component.type === ComponentType.Button) {
                return (
                  <Button
                    key={
                      "custom_id" in component
                        ? component.custom_id
                        : "url" in component
                          ? component.url
                          : component.sku_id
                    }
                    button={component}
                    onUse={onUse}
                  />
                );
              }
              if (
                component.type === ComponentType.StringSelect ||
                component.type === ComponentType.UserSelect ||
                component.type === ComponentType.RoleSelect ||
                component.type === ComponentType.MentionableSelect ||
                component.type === ComponentType.ChannelSelect
              ) {
                return (
                  <SelectMenu
                    key={component.custom_id}
                    menu={component}
                    context={context}
                    onUse={onUse}
                  />
                );
              }
              return null;
            })}
          </div>
        );
      })}
    </>
  );
}
