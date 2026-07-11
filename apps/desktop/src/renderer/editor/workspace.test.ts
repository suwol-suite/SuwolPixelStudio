import { describe, expect, it } from "vitest";
import { EditorSession } from "@suwol/editor-core";
import { WorkspaceStore } from "./workspace";

describe("WorkspaceStore document identity", () => {
  it("does not duplicate a document that is opened again with the same stable ID", () => {
    const workspace = new WorkspaceStore(), session = EditorSession.create({
      name: "Document",
      layerName: "Layer",
      width: 1,
      height: 1,
    });
    const first = workspace.add(session), second = workspace.add(EditorSession.fromSnapshot(session.snapshot()));
    expect(second).toBe(first);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.activeId).toBe(first.id);
  });
  it("releases document view state across 50 open-close cycles", () => {
    const workspace = new WorkspaceStore();
    for (let index = 0; index < 50; index += 1) {
      const entry = workspace.add(EditorSession.create({
        name: `Document ${index}`,
        layerName: "Layer",
        width: 16,
        height: 16,
      }));
      entry.view.selection.setRect({ x: index % 16, y: index % 16, width: 1, height: 1 }, "replace");
      entry.view.recentColors.push([index, 0, 0, 255]);
      expect(workspace.close(entry.id)).toBe(true);
    }
    expect(workspace.documents).toEqual([]);
    expect(workspace.active).toBeNull();
  });
});
