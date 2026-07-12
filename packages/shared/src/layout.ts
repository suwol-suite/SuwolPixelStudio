import { z } from "zod";

export const LAYOUT_SCHEMA_VERSION = 3 as const;
export type DockGroupId = "upper" | "lower";

export interface TabGroupLayout {
  readonly panelIds: readonly string[];
  readonly activePanelId: string | null;
}

export interface WorkspaceLayout {
  readonly schemaVersion: typeof LAYOUT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly toolsVisible: boolean;
  readonly rightDockVisible: boolean;
  readonly rightDockWidth: number;
  readonly upperGroup: TabGroupLayout | null;
  readonly lowerGroup: TabGroupLayout | null;
  readonly rightSplitRatio: number;
  readonly timelineVisible: boolean;
  readonly timelineHeight: number;
}

const panelIdSchema = z
    .string()
    .min(1)
    .max(180)
    .regex(/^[a-zA-Z0-9._-]+$/),
  groupSchema = z
    .object({
      panelIds: z.array(panelIdSchema).min(1).max(50),
      activePanelId: panelIdSchema.nullable(),
    })
    .strict()
    .superRefine((group, context) => {
      if (new Set(group.panelIds).size !== group.panelIds.length)
        context.addIssue({ code: "custom", path: ["panelIds"], message: "Panel ids must be unique." });
      if (group.activePanelId !== null && !group.panelIds.includes(group.activePanelId))
        context.addIssue({ code: "custom", path: ["activePanelId"], message: "Active panel must belong to its group." });
    });

export const workspaceLayoutSchema = z
  .object({
    schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
    toolsVisible: z.boolean(),
    rightDockVisible: z.boolean(),
    rightDockWidth: z.number().int().min(220).max(720),
    upperGroup: groupSchema.nullable(),
    lowerGroup: groupSchema.nullable(),
    rightSplitRatio: z.number().min(0.25).max(0.75),
    timelineVisible: z.boolean(),
    timelineHeight: z.number().int().min(112).max(420),
  })
  .strict()
  .superRefine((layout, context) => {
    const upper = layout.upperGroup?.panelIds ?? [],
      lower = layout.lowerGroup?.panelIds ?? [];
    if (upper.some((id) => lower.includes(id)))
      context.addIssue({ code: "custom", path: ["lowerGroup"], message: "A panel may appear in only one group." });
    if (layout.rightDockVisible && upper.length + lower.length === 0)
      context.addIssue({ code: "custom", path: ["rightDockVisible"], message: "An empty right dock cannot be visible." });
  });

const group = (panelIds: readonly string[], activePanelId = panelIds[0] ?? null): TabGroupLayout => ({
  panelIds,
  activePanelId,
});

export const STATIC_EDITING_LAYOUT: WorkspaceLayout = Object.freeze({
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  id: "static-editing",
  name: "Static Editing",
  toolsVisible: true,
  rightDockVisible: true,
  rightDockWidth: 320,
  upperGroup: group(["layers", "palette"], "layers"),
  lowerGroup: group(["properties", "preview"], "properties"),
  rightSplitRatio: 0.55,
  timelineVisible: false,
  timelineHeight: 180,
});

export const ANIMATION_LAYOUT: WorkspaceLayout = Object.freeze({
  ...structuredClone(STATIC_EDITING_LAYOUT),
  id: "animation",
  name: "Animation",
  lowerGroup: group(["properties", "preview"], "preview"),
  timelineVisible: true,
  timelineHeight: 210,
});

export const TILEMAP_LAYOUT: WorkspaceLayout = Object.freeze({
  ...structuredClone(STATIC_EDITING_LAYOUT),
  id: "tilemap",
  name: "Tilemap",
  upperGroup: group(["layers", "tilesets"], "layers"),
  lowerGroup: group(["properties", "palette"], "properties"),
  timelineVisible: false,
});

export const BUILTIN_WORKSPACE_LAYOUTS = Object.freeze([
  STATIC_EDITING_LAYOUT,
  ANIMATION_LAYOUT,
  TILEMAP_LAYOUT,
]);
export const DEFAULT_WORKSPACE_LAYOUT = STATIC_EDITING_LAYOUT;

function normalizeGroup(input: TabGroupLayout | null): TabGroupLayout | null {
  if (input === null) return null;
  const panelIds = [...new Set(input.panelIds)];
  if (panelIds.length === 0) return null;
  return {
    panelIds,
    activePanelId: input.activePanelId !== null && panelIds.includes(input.activePanelId)
      ? input.activePanelId
      : (panelIds[0] ?? null),
  };
}

function normalizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const upperGroup = normalizeGroup(layout.upperGroup),
    lowerGroup = normalizeGroup(layout.lowerGroup),
    hasPanels = upperGroup !== null || lowerGroup !== null;
  return {
    ...layout,
    upperGroup,
    lowerGroup,
    rightDockVisible: hasPanels && layout.rightDockVisible,
  };
}

function migrateLegacyLayout(input: unknown): unknown {
  if (typeof input !== "object" || input === null || !("schemaVersion" in input)) return input;
  const legacy = input as Record<string, unknown>;
  if (legacy.schemaVersion !== 1 && legacy.schemaVersion !== 2) return input;
  const hidden = new Set(Array.isArray(legacy.hiddenPanelIds) ? legacy.hiddenPanelIds.filter((id): id is string => typeof id === "string") : []),
    rightPanels: string[] = [];
  let toolsVisible = !hidden.has("tools"), rightDockWidth = 320, timelineVisible = false, timelineHeight = 180;
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (record.type === "split") {
      visit(record.first);
      visit(record.second);
      return;
    }
    if (record.type !== "tabs" || !Array.isArray(record.panelIds)) return;
    const ids = record.panelIds.filter((id): id is string => typeof id === "string" && !hidden.has(id));
    if (record.edge === "left") toolsVisible = ids.includes("tools");
    if (record.edge === "right") {
      rightPanels.push(...ids.filter((id) => id !== "tools" && id !== "timeline"));
      if (typeof record.size === "number") rightDockWidth = Math.min(720, Math.max(220, Math.round(record.size)));
    }
    if (record.edge === "bottom" && ids.includes("timeline")) {
      timelineVisible = true;
      if (typeof record.size === "number") timelineHeight = Math.min(420, Math.max(112, Math.round(record.size)));
    }
  };
  visit(legacy.root);
  const unique = [...new Set(rightPanels)],
    upperIds = unique.filter((id) => ["layers", "palette", "tilesets", "brushes"].includes(id)),
    lowerIds = unique.filter((id) => !upperIds.includes(id));
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    id: typeof legacy.id === "string" ? legacy.id : crypto.randomUUID(),
    name: typeof legacy.name === "string" ? legacy.name : "Migrated Layout",
    toolsVisible,
    rightDockVisible: unique.length > 0,
    rightDockWidth,
    upperGroup: upperIds.length === 0 ? null : group(upperIds),
    lowerGroup: lowerIds.length === 0 ? null : group(lowerIds),
    rightSplitRatio: 0.55,
    timelineVisible,
    timelineHeight,
  };
}

export function parseWorkspaceLayout(input: unknown): WorkspaceLayout {
  const result = workspaceLayoutSchema.safeParse(migrateLegacyLayout(input));
  if (!result.success) throw new Error("Workspace layout JSON is invalid.");
  return normalizeLayout(result.data);
}

export function recoverWorkspaceLayout(input: unknown): WorkspaceLayout {
  try {
    return parseWorkspaceLayout(input);
  } catch {
    return structuredClone(DEFAULT_WORKSPACE_LAYOUT);
  }
}

export function layoutPanelIds(layout: WorkspaceLayout): readonly string[] {
  return [
    ...(layout.toolsVisible ? ["tools"] : []),
    ...(layout.upperGroup?.panelIds ?? []),
    ...(layout.lowerGroup?.panelIds ?? []),
    ...(layout.timelineVisible ? ["timeline"] : []),
  ];
}

export function activateLayoutPanel(layout: WorkspaceLayout, groupId: DockGroupId, panelId: string): WorkspaceLayout {
  const key = groupId === "upper" ? "upperGroup" : "lowerGroup",
    target = layout[key];
  if (!target?.panelIds.includes(panelId)) return layout;
  return parseWorkspaceLayout({ ...layout, [key]: { ...target, activePanelId: panelId } });
}

export function moveLayoutPanel(layout: WorkspaceLayout, panelId: string, targetGroupId: string, targetIndex: number): WorkspaceLayout {
  const targetKey = targetGroupId === "upper" || targetGroupId === "upper-group" ? "upperGroup" : targetGroupId === "lower" || targetGroupId === "lower-group" ? "lowerGroup" : null;
  if (targetKey === null) throw new Error("Target dock group does not exist.");
  const without = (input: TabGroupLayout | null): TabGroupLayout | null => input === null ? null : normalizeGroup({ ...input, panelIds: input.panelIds.filter((id) => id !== panelId) }),
    upperGroup = without(layout.upperGroup),
    lowerGroup = without(layout.lowerGroup),
    target = targetKey === "upperGroup" ? upperGroup : lowerGroup,
    ids = [...(target?.panelIds ?? [])];
  ids.splice(Math.max(0, Math.min(ids.length, targetIndex)), 0, panelId);
  return parseWorkspaceLayout({
    ...layout,
    upperGroup: targetKey === "upperGroup" ? group(ids, panelId) : upperGroup,
    lowerGroup: targetKey === "lowerGroup" ? group(ids, panelId) : lowerGroup,
    rightDockVisible: true,
  });
}

export function setLayoutPanelVisibility(layout: WorkspaceLayout, panelId: string, visible: boolean): WorkspaceLayout {
  if (panelId === "tools") return parseWorkspaceLayout({ ...layout, toolsVisible: visible });
  if (panelId === "timeline") return parseWorkspaceLayout({ ...layout, timelineVisible: visible });
  const exists = layout.upperGroup?.panelIds.includes(panelId) === true || layout.lowerGroup?.panelIds.includes(panelId) === true;
  if (visible && exists) return parseWorkspaceLayout({ ...layout, rightDockVisible: true });
  if (visible) {
    const preferred: DockGroupId = ["layers", "palette", "tilesets", "brushes"].includes(panelId) ? "upper" : "lower";
    return moveLayoutPanel(layout, panelId, preferred, preferred === "upper" ? layout.upperGroup?.panelIds.length ?? 0 : layout.lowerGroup?.panelIds.length ?? 0);
  }
  const without = (input: TabGroupLayout | null): TabGroupLayout | null => input === null ? null : normalizeGroup({ ...input, panelIds: input.panelIds.filter((id) => id !== panelId) }),
    upperGroup = without(layout.upperGroup), lowerGroup = without(layout.lowerGroup);
  return parseWorkspaceLayout({ ...layout, upperGroup, lowerGroup, rightDockVisible: upperGroup !== null || lowerGroup !== null });
}

export function setRightDockVisibility(layout: WorkspaceLayout, visible: boolean): WorkspaceLayout {
  if (visible && layout.upperGroup === null && layout.lowerGroup === null)
    return parseWorkspaceLayout({ ...layout, rightDockVisible: true, upperGroup: group(["layers", "palette"], "layers"), lowerGroup: group(["properties", "preview"], "properties") });
  return parseWorkspaceLayout({ ...layout, rightDockVisible: visible && (layout.upperGroup !== null || layout.lowerGroup !== null) });
}

export function serializeWorkspaceLayout(layout: WorkspaceLayout): string {
  return JSON.stringify(parseWorkspaceLayout(layout), null, 2);
}
