import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandRegistry } from "@suwol/command-system";
import type { Translate } from "../i18n";
import { Dialog } from "./Dialog";

interface CommandPaletteProps {
  readonly registry: CommandRegistry;
  readonly t: Translate;
  readonly onClose: () => void;
}

export function CommandPalette({ registry, t, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState(false);
  const [, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => registry.subscribe(() => setRevision((value) => value + 1)),
    [registry],
  );
  useEffect(() => inputRef.current?.focus(), []);

  const commands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return registry.getAll().filter((command) => {
      if (normalized === "") return true;
      return `${t(command.titleKey)} ${t(command.category)}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [query, registry, t]);

  useEffect(() => setSelectedIndex(0), [query]);

  async function runSelected(): Promise<void> {
    const selected = commands[selectedIndex];
    if (!selected?.canExecute()) return;
    const result = await registry.execute(selected.id);
    if (result.status === "executed") onClose();
    else if (result.status === "error") setError(true);
  }

  return (
    <Dialog
      title={t("palette.title")}
      closeLabel={t("dialog.close")}
      onClose={onClose}
      className="command-palette"
    >
      <input
        ref={inputRef}
        className="command-search"
        type="search"
        value={query}
        placeholder={t("palette.search")}
        aria-label={t("palette.search")}
        aria-controls="command-results"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((index) =>
              Math.min(commands.length - 1, index + 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            void runSelected();
          }
        }}
      />
      {error && (
        <p className="inline-error" role="alert">
          {t("palette.error")}
        </p>
      )}
      <div className="command-results" id="command-results" role="listbox">
        {commands.length === 0 && (
          <p className="empty-list">{t("palette.noResults")}</p>
        )}
        {commands.map((command, index) => {
          const enabled = command.canExecute();
          return (
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className="command-result"
              disabled={!enabled}
              key={command.id}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => {
                setSelectedIndex(index);
                void registry.execute(command.id).then((result) => {
                  if (result.status === "executed") onClose();
                  else if (result.status === "error") setError(true);
                });
              }}
            >
              <span>
                <strong>{t(command.titleKey)}</strong>
                <small>{t(command.category)}</small>
              </span>
              {!enabled && (
                <span className="command-disabled-label">
                  {t("palette.unavailable")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
