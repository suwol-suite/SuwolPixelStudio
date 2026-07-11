import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type CommandDefinition } from "./index";

function command(
  overrides: Partial<CommandDefinition> = {},
): CommandDefinition {
  return {
    id: "test.command",
    titleKey: "command.test",
    category: "test",
    canExecute: () => true,
    execute: () => undefined,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  it("registers, looks up, and unregisters commands", () => {
    const registry = new CommandRegistry();
    const unregister = registry.register(command());
    expect(registry.get("test.command")?.titleKey).toBe("command.test");
    unregister();
    expect(registry.get("test.command")).toBeUndefined();
  });

  it("executes enabled commands", async () => {
    const execute = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command({ execute }));
    await expect(registry.execute("test.command")).resolves.toEqual({
      status: "executed",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects duplicate command ids", () => {
    const registry = new CommandRegistry();
    registry.register(command());
    expect(() => registry.register(command())).toThrow("Duplicate command id");
  });

  it("blocks disabled commands without invoking them", async () => {
    const execute = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command({ canExecute: () => false, execute }));
    await expect(registry.execute("test.command")).resolves.toEqual({
      status: "disabled",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("handles missing commands", async () => {
    const registry = new CommandRegistry();
    await expect(registry.execute("missing.command")).resolves.toEqual({
      status: "not-found",
    });
  });

  it("contains command errors and keeps the registry usable", async () => {
    const registry = new CommandRegistry();
    registry.register(
      command({
        execute: () => {
          throw new Error("private details");
        },
      }),
    );
    await expect(registry.execute("test.command")).resolves.toEqual({
      status: "error",
      message: "Command execution failed.",
    });
    expect(registry.canExecute("test.command")).toBe(true);
  });

  it("notifies state subscribers", () => {
    const listener = vi.fn();
    const registry = new CommandRegistry();
    const unsubscribe = registry.subscribe(listener);
    registry.register(command());
    registry.notifyStateChanged();
    unsubscribe();
    registry.notifyStateChanged();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
