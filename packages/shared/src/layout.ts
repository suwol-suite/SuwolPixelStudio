import { z } from "zod";

export const LAYOUT_SCHEMA_VERSION = 1 as const;
export type DockEdge = "left" | "right" | "bottom" | "center";
export interface DockTabs { readonly type: "tabs"; readonly id: string; readonly edge: DockEdge; readonly panelIds: readonly string[]; readonly activePanelId: string | null; readonly size: number; }
export interface DockSplit { readonly type: "split"; readonly id: string; readonly direction: "horizontal" | "vertical"; readonly ratio: number; readonly first: DockNode; readonly second: DockNode; }
export type DockNode = DockTabs | DockSplit;
export interface WorkspaceLayout { readonly schemaVersion: typeof LAYOUT_SCHEMA_VERSION; readonly id: string; readonly name: string; readonly root: DockNode; readonly hiddenPanelIds: readonly string[]; }

const panelIdSchema = z.string().min(1).max(180).regex(/^[a-zA-Z0-9._-]+$/), tabsSchema = z.object({ type: z.literal("tabs"), id: z.string().min(1).max(128), edge: z.enum(["left", "right", "bottom", "center"]), panelIds: z.array(panelIdSchema).max(50), activePanelId: panelIdSchema.nullable(), size: z.number().int().min(48).max(4096) }).strict();
const nodeSchema: z.ZodType<DockNode> = z.lazy(() => z.union([tabsSchema, z.object({ type: z.literal("split"), id: z.string().min(1).max(128), direction: z.enum(["horizontal", "vertical"]), ratio: z.number().min(0.1).max(0.9), first: nodeSchema, second: nodeSchema }).strict()]));
export const workspaceLayoutSchema = z.object({ schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION), id: z.string().min(1).max(128), name: z.string().min(1).max(100), root: nodeSchema, hiddenPanelIds: z.array(panelIdSchema).max(100) }).strict().superRefine((layout, context) => {
  const nodes = new Set<string>(), panels = new Set<string>();
  const visit = (node: DockNode): void => {
    if (nodes.has(node.id)) context.addIssue({ code: "custom", path: ["root"], message: "Dock node ids must be unique." });
    nodes.add(node.id);
    if (node.type === "split") { visit(node.first); visit(node.second); return; }
    for (const panel of node.panelIds) { if (panels.has(panel)) context.addIssue({ code: "custom", path: ["root"], message: "A panel may appear in only one tab group." }); panels.add(panel); }
    if (node.activePanelId !== null && !node.panelIds.includes(node.activePanelId)) context.addIssue({ code: "custom", path: ["root"], message: "Active panel must belong to its tab group." });
  };
  visit(layout.root);
  for (const hidden of layout.hiddenPanelIds) if (panels.has(hidden)) context.addIssue({ code: "custom", path: ["hiddenPanelIds"], message: "Visible and hidden panel sets overlap." });
});

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = { schemaVersion: 1, id: "suwol-default", name: "Suwol Default", root: { type: "split", id: "root-horizontal", direction: "horizontal", ratio: 0.18, first: { type: "tabs", id: "left-tabs", edge: "left", panelIds: ["tools"], activePanelId: "tools", size: 64 }, second: { type: "split", id: "editor-right", direction: "horizontal", ratio: 0.75, first: { type: "split", id: "editor-bottom", direction: "vertical", ratio: 0.75, first: { type: "tabs", id: "center-tabs", edge: "center", panelIds: [], activePanelId: null, size: 640 }, second: { type: "tabs", id: "bottom-tabs", edge: "bottom", panelIds: ["timeline"], activePanelId: "timeline", size: 180 } }, second: { type: "tabs", id: "right-tabs", edge: "right", panelIds: ["layers", "palette", "properties", "preview", "brushes", "tilesets", "slices"], activePanelId: "layers", size: 280 } } }, hiddenPanelIds: [] };

export function parseWorkspaceLayout(input: unknown): WorkspaceLayout { const result = workspaceLayoutSchema.safeParse(input); if (!result.success) throw new Error("Workspace layout JSON is invalid."); return result.data; }
export function recoverWorkspaceLayout(input: unknown): WorkspaceLayout { try { return parseWorkspaceLayout(input); } catch { return structuredClone(DEFAULT_WORKSPACE_LAYOUT); } }
export function layoutPanelIds(layout: WorkspaceLayout): readonly string[] { const result: string[] = []; const visit = (node: DockNode): void => { if (node.type === "tabs") result.push(...node.panelIds); else { visit(node.first); visit(node.second); } }; visit(layout.root); return result; }
export function moveLayoutPanel(layout: WorkspaceLayout, panelId: string, targetTabsId: string, targetIndex: number): WorkspaceLayout { const next = structuredClone(layout); const remove = (node: DockNode): void => { if (node.type === "tabs") { const index = node.panelIds.indexOf(panelId); if (index >= 0) (node.panelIds as string[]).splice(index, 1); } else { remove(node.first); remove(node.second); } }, find = (node: DockNode): DockTabs | null => node.type === "tabs" ? node.id === targetTabsId ? node : null : find(node.first) ?? find(node.second); remove(next.root); const target = find(next.root); if (target === null) throw new Error("Target dock tab group does not exist."); (target.panelIds as string[]).splice(Math.max(0, Math.min(target.panelIds.length, targetIndex)), 0, panelId); (target as { activePanelId: string | null }).activePanelId = panelId; return parseWorkspaceLayout(next); }
export function serializeWorkspaceLayout(layout: WorkspaceLayout): string { return JSON.stringify(parseWorkspaceLayout(layout), null, 2); }
