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
  it("keeps independent viewport state while switching and reordering tabs", () => {
    const workspace = new WorkspaceStore(), first = workspace.add(EditorSession.create({ name: "One", layerName: "Layer", width: 16, height: 16 })), second = workspace.add(EditorSession.create({ name: "Two", layerName: "Layer", width: 32, height: 32 }));
    first.view.viewport.zoom = 4;
    first.view.viewport.panX = -120;
    second.view.viewport.zoom = 2;
    second.view.viewport.panX = 80;
    workspace.activate(first.id);
    expect(workspace.active?.view.viewport).toMatchObject({ zoom: 4, panX: -120 });
    workspace.activate(second.id);
    expect(workspace.active?.view.viewport).toMatchObject({ zoom: 2, panX: 80 });
    expect(workspace.reorder(second.id, 0)).toBe(true);
    expect(workspace.documents.map(({ id }) => id)).toEqual([second.id, first.id]);
  });
});
