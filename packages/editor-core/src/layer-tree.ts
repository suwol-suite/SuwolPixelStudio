import { makeId, type GroupLayer, type Layer, type LayerId, type PixelDocument } from "./types";

export function flattenLayerTree(model: Pick<PixelDocument, "rootLayerIds" | "layers">): LayerId[] {
  const result: LayerId[] = [], seen = new Set<LayerId>();
  const visit = (id: LayerId): void => {
    if (seen.has(id)) throw new Error("Layer tree contains a cycle or duplicate parent.");
    const layer = model.layers[id];
    if (layer === undefined) throw new Error(`Layer ${id} is missing.`);
    seen.add(id);
    result.push(id);
    if (layer.kind === "group") for (const childId of layer.childIds) visit(childId);
  };
  for (const id of model.rootLayerIds) visit(id);
  if (seen.size !== Object.keys(model.layers).length)
    throw new Error("Layer tree contains unreachable layers.");
  return result;
}

export function layerAncestors(model: Pick<PixelDocument, "layers">, layerId: LayerId): LayerId[] {
  const result: LayerId[] = [], seen = new Set<LayerId>();
  let current = model.layers[layerId]?.parentId ?? null;
  while (current !== null) {
    if (seen.has(current)) throw new Error("Layer tree contains a cycle.");
    seen.add(current);
    result.push(current);
    current = model.layers[current]?.parentId ?? null;
  }
  return result;
}

export function canReparentLayer(
  model: Pick<PixelDocument, "layers">,
  layerId: LayerId,
  parentId: LayerId | null,
): boolean {
  if (layerId === parentId || model.layers[layerId] === undefined) return false;
  if (parentId === null) return true;
  const parent = model.layers[parentId];
  return parent?.kind === "group" && !layerAncestors(model, parentId).includes(layerId);
}

export function reparentLayer(
  model: Pick<PixelDocument, "rootLayerIds" | "layerOrder" | "layers">,
  layerId: LayerId,
  parentId: LayerId | null,
  targetIndex: number,
): void {
  if (!canReparentLayer(model, layerId, parentId))
    throw new Error("Layer cannot be moved to that parent.");
  const layer = model.layers[layerId];
  if (layer === undefined) throw new Error("Layer does not exist.");
  removeFromParent(model, layer);
  const destination = parentId === null
    ? model.rootLayerIds
    : (model.layers[parentId] as GroupLayer).childIds;
  destination.splice(Math.max(0, Math.min(destination.length, Math.round(targetIndex))), 0, layerId);
  layer.parentId = parentId;
  model.layerOrder = flattenLayerTree(model);
}

export function createGroupLayer(
  model: Pick<PixelDocument, "rootLayerIds" | "layerOrder" | "layers">,
  name: string,
  parentId: LayerId | null = null,
  targetIndex = Number.MAX_SAFE_INTEGER,
): GroupLayer {
  const id = makeId("group"),
    group: GroupLayer = {
      id,
      kind: "group",
      name: name.trim() || "Group",
      parentId,
      childIds: [],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
    };
  if (parentId !== null && model.layers[parentId]?.kind !== "group")
    throw new Error("Group parent must be another group.");
  model.layers[id] = group;
  const destination = parentId === null
    ? model.rootLayerIds
    : (model.layers[parentId] as GroupLayer).childIds;
  destination.splice(Math.min(destination.length, Math.max(0, targetIndex)), 0, id);
  model.layerOrder = flattenLayerTree(model);
  return group;
}

export function removeGroupKeepingChildren(
  model: Pick<PixelDocument, "rootLayerIds" | "layerOrder" | "layers">,
  groupId: LayerId,
): void {
  const group = model.layers[groupId];
  if (group?.kind !== "group") throw new Error("Group does not exist.");
  const parentList = group.parentId === null
    ? model.rootLayerIds
    : (model.layers[group.parentId] as GroupLayer).childIds,
    index = parentList.indexOf(groupId);
  if (index < 0) throw new Error("Group parent relation is inconsistent.");
  parentList.splice(index, 1, ...group.childIds);
  for (const childId of group.childIds) {
    const child = model.layers[childId];
    if (child !== undefined) child.parentId = group.parentId;
  }
  Reflect.deleteProperty(model.layers, groupId);
  model.layerOrder = flattenLayerTree(model);
}

export function descendantLayerIds(model: Pick<PixelDocument, "layers">, groupId: LayerId): LayerId[] {
  const group = model.layers[groupId];
  if (group?.kind !== "group") return [];
  const result: LayerId[] = [];
  for (const childId of group.childIds) {
    result.push(childId);
    result.push(...descendantLayerIds(model, childId));
  }
  return result;
}

function removeFromParent(
  model: Pick<PixelDocument, "rootLayerIds" | "layers">,
  layer: Layer,
): void {
  const parent = layer.parentId === null ? null : model.layers[layer.parentId];
  const source = layer.parentId === null
    ? model.rootLayerIds
    : parent?.kind === "group"
      ? parent.childIds
      : null;
  if (source === null) throw new Error("Layer parent is invalid.");
  const index = source.indexOf(layer.id);
  if (index < 0) throw new Error("Layer parent relation is inconsistent.");
  source.splice(index, 1);
}
