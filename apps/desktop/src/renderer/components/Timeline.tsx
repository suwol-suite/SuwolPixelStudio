import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CommandRegistry } from "@suwol/command-system";
import type { ApplicationCommandId } from "@suwol/shared";
import {
  getCel,
  advancePlayback,
  imageReferenceCounts,
  playbackFrameRange,
  timelineVisibleRange,
  updateFrameSelection,
  type FrameId,
} from "@suwol/editor-core";
import type { Translate } from "../i18n";
import type { WorkspaceDocument, WorkspaceStore } from "../editor/workspace";
import { CelThumbnailService } from "../editor/thumbnail";
import { Tooltip } from "./Tooltip";

const thumbnails = new CelThumbnailService();

function TimelineControl({ label, description, shortcut, disabled, disabledReason, testId, pressed, onClick, children }: { readonly label: string; readonly description: string; readonly shortcut?: string; readonly disabled?: boolean; readonly disabledReason?: string; readonly testId?: string; readonly pressed?: boolean; readonly onClick: () => void; readonly children: ReactNode }) {
  return <Tooltip metadata={{ name: label, description, ...(shortcut === undefined ? {} : { shortcut }), ...(disabled === true && disabledReason !== undefined ? { disabledReason } : {}) }}>
    {(descriptionId) => <button type="button" aria-label={label} aria-describedby={descriptionId} aria-pressed={pressed} data-testid={testId} disabled={disabled} onClick={onClick}>{children}</button>}
  </Tooltip>;
}

function CelThumbnail({ entry, imageId }: { readonly entry: WorkspaceDocument; readonly imageId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    try {
      const thumbnail = thumbnails.get(imageId, entry.session.model.revision, entry.session.getSurface(imageId)),
        context = canvas.getContext("2d");
      canvas.width = thumbnail.width;
      canvas.height = thumbnail.height;
      context?.putImageData(
        new ImageData(new Uint8ClampedArray(thumbnail.rgba), thumbnail.width, thumbnail.height),
        0,
        0,
      );
    } catch {
      canvas.dataset.failed = "true";
    }
  }, [entry, imageId, entry.session.model.revision]);
  return <canvas ref={ref} className="cel-thumbnail" aria-hidden="true" />;
}

export function Timeline({
  entry,
  workspace,
  commands,
  t,
}: {
  readonly entry: WorkspaceDocument;
  readonly workspace: WorkspaceStore;
  readonly commands: CommandRegistry;
  readonly t: Translate;
}) {
  const scroller = useRef<HTMLDivElement>(null),
    [viewportWidth, setViewportWidth] = useState(800),
    [scrollTop, setScrollTop] = useState(0),
    [contextMenu, setContextMenu] = useState<Readonly<{
      x: number;
      y: number;
      kind: "frame" | "cel";
    }> | null>(null),
    cellWidth = Math.round(64 * entry.view.timeline.zoom),
    order = entry.session.model.frameOrder,
    visible = timelineVisibleRange(
      order.length,
      entry.view.timeline.scrollLeft,
      viewportWidth,
      cellWidth,
      3,
    ),
    frames = order.slice(visible.start, visible.end),
    references = imageReferenceCounts(entry.session.model);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth));
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    element.scrollLeft = entry.view.timeline.scrollLeft;
    return () => observer.disconnect();
  }, [entry]);

  useEffect(() => {
    let frameRequest = 0;
    const tick = (now: number) => {
      const playback = entry.view.playback;
      if (playback.isPlaying) {
        const range = playbackFrameRange(entry.session.model, entry.view.activeTagId),
          currentIndex = Math.max(0, range.indexOf(entry.view.activeFrameId)),
          durations = range.map((id) => entry.session.model.frames[id]?.durationMs ?? 100),
          activeTag = entry.view.activeTagId === null ? null : entry.session.model.tags[entry.view.activeTagId],
          mode = activeTag?.playback === "pingpong" ? "pingpong" : playback.mode,
          delta = playback.lastTime === 0 ? 0 : Math.min(60_000, Math.max(0, now - playback.lastTime)),
          advanced = advancePlayback(
            durations,
            {
              index: currentIndex,
              direction: playback.direction,
              elapsedInFrame: playback.elapsedInFrame,
              isPlaying: true,
            },
            delta,
            mode,
          ),
          frameId = range[advanced.index];
        playback.lastTime = now;
        playback.elapsedInFrame = advanced.elapsedInFrame;
        playback.direction = advanced.direction;
        playback.isPlaying = advanced.isPlaying;
        if (frameId !== undefined && frameId !== entry.view.activeFrameId) {
          entry.view.activeFrameId = frameId;
          entry.session.setActiveFrame(frameId);
          workspace.invalidateCanvas(entry.id);
        } else if (!advanced.isPlaying) workspace.touch();
      }
      frameRequest = requestAnimationFrame(tick);
    };
    frameRequest = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRequest);
  }, [entry, workspace]);

  function selectFrame(frameId: FrameId, event?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    entry.view.playback.isPlaying = false;
    entry.view.floating = null;
    const mode = event?.shiftKey
        ? "range"
        : event?.ctrlKey === true || event?.metaKey === true
          ? "toggle"
          : "replace",
      selection = updateFrameSelection(
        order,
        entry.view.timeline.selectedFrames,
        entry.view.timeline.selectionAnchor,
        frameId,
        mode,
      );
    entry.view.timeline.selectedFrames = new Set(selection.selected);
    entry.view.timeline.selectionAnchor = selection.anchor;
    entry.view.activeFrameId = frameId;
    entry.session.setActiveFrame(frameId);
    workspace.invalidateCanvas(entry.id);
  }

  const gridColumns = `${visible.offset}px repeat(${frames.length}, ${cellWidth}px) ${Math.max(0, (order.length - visible.end) * cellWidth)}px`,
    contextItems: readonly (readonly [ApplicationCommandId, string])[] =
      contextMenu?.kind === "frame"
        ? [
            ["frame.duplicate", t("frame.duplicate")],
            ["frame.duplicateLinked", t("frame.duplicateLinked")],
            ["frame.setDuration", t("frame.duration")],
            ["frame.delete", t("frame.delete")],
          ]
        : [
            ["cel.create", t("cel.create")],
            ["cel.delete", t("cel.delete")],
            ["cel.linkToPrevious", t("cel.link")],
            ["cel.unlink", t("cel.unlink")],
          ];
  return (
    <div
      className="animation-timeline"
      data-testid="animation-timeline"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setContextMenu(null);
        entry.view.timeline.selectedFrames.clear();
        entry.view.timeline.selectionAnchor = null;
        entry.view.timeline.selectedCelId = null;
        entry.view.timeline.selectedCels.clear();
        entry.view.timeline.celSelectionAnchor = null;
        workspace.touch();
      }}
      onClick={(event) => {
        if (contextMenu !== null && !(event.target as HTMLElement).closest(".timeline-context-menu"))
          setContextMenu(null);
      }}
    >
      <div className="playback-toolbar" role="toolbar" aria-label={t("animation.playback")}>
        <TimelineControl label={t("frame.first")} description={t("tooltip.frame.navigate")} shortcut="Shift+[" onClick={() => void commands.execute("frame.first")}>|◀</TimelineControl>
        <TimelineControl label={t("frame.previous")} description={t("tooltip.frame.navigate")} shortcut="[" onClick={() => void commands.execute("frame.previous")}>◀</TimelineControl>
        <TimelineControl label={entry.view.playback.isPlaying ? t("animation.pause") : t("animation.play")} description={t("tooltip.animation.playback")} shortcut="Enter" testId="play-pause" pressed={entry.view.playback.isPlaying} onClick={() => void commands.execute("animation.playPause")}>{entry.view.playback.isPlaying ? "Ⅱ" : "▶"}</TimelineControl>
        <TimelineControl label={t("frame.next")} description={t("tooltip.frame.navigate")} shortcut="]" onClick={() => void commands.execute("frame.next")}>▶</TimelineControl>
        <TimelineControl label={t("frame.last")} description={t("tooltip.frame.navigate")} shortcut="Shift+]" onClick={() => void commands.execute("frame.last")}>▶|</TimelineControl>
        <select
          aria-label={t("animation.mode")}
          value={entry.view.playback.mode}
          onChange={(event) => {
            const map = { loop: "animation.setLoop", once: "animation.setOnce", pingpong: "animation.setPingPong" } as const;
            void commands.execute(map[event.target.value as keyof typeof map]);
          }}
        >
          <option value="loop">{t("animation.loop")}</option>
          <option value="once">{t("animation.once")}</option>
          <option value="pingpong">{t("animation.pingpong")}</option>
        </select>
        <TimelineControl label={t("animation.onionSkin")} description={t("tooltip.animation.onionSkin")} shortcut="O" testId="toggle-onion" pressed={entry.view.onionSkin.enabled} disabled={order.length < 2} disabledReason={t("tooltip.disabled.multipleFrames")} onClick={() => void commands.execute("animation.toggleOnionSkin")}>◉</TimelineControl>
        <TimelineControl label={t("animation.onionSettings")} description={t("tooltip.animation.onionSettings")} disabled={order.length < 2} disabledReason={t("tooltip.disabled.multipleFrames")} onClick={() => void commands.execute("animation.onionSkinSettings")}>⚙</TimelineControl>
        <span>{order.indexOf(entry.view.activeFrameId) + 1}/{order.length}</span>
        <button data-testid="frame-add" type="button" onClick={() => void commands.execute("frame.add")}>+ {t("frame.new")}</button>
        <button data-testid="frame-duplicate" type="button" onClick={() => void commands.execute("frame.duplicate")}>{t("frame.duplicate")}</button>
        <button data-testid="frame-linked" type="button" onClick={() => void commands.execute("frame.duplicateLinked")}>{t("frame.duplicateLinked")}</button>
        <button data-testid="frame-delete" type="button" disabled={order.length <= 1} onClick={() => void commands.execute("frame.delete")}>{t("frame.delete")}</button>
        <TimelineControl label={t("command.timeline.zoomOut")} description={t("tooltip.timeline.zoom")} onClick={() => void commands.execute("timeline.zoomOut")}>−</TimelineControl>
        <span>{Math.round(entry.view.timeline.zoom * 100)}%</span>
        <TimelineControl label={t("command.timeline.zoomIn")} description={t("tooltip.timeline.zoom")} onClick={() => void commands.execute("timeline.zoomIn")}>+</TimelineControl>
      </div>
      <div className="timeline-tags" aria-label={t("tag.title")}>
        {Object.values(entry.session.model.tags).map((tag) => (
          <div
            key={tag.id}
            className={`timeline-tag-range ${entry.view.activeTagId === tag.id ? "active" : ""}`}
            style={{
              borderColor: `rgb(${tag.color[0]} ${tag.color[1]} ${tag.color[2]} / ${tag.color[3] / 255})`,
            }}
          >
            <button
              type="button"
              onClick={() => {
                entry.view.activeTagId = entry.view.activeTagId === tag.id ? null : tag.id;
                workspace.touch();
              }}
            >
              {tag.name} · {order.indexOf(tag.fromFrameId) + 1}–{order.indexOf(tag.toFrameId) + 1}
            </button>
            <label>
              <span>{t("tag.from")}</span>
              <input
                aria-label={`${tag.name} ${t("tag.from")}`}
                type="range"
                min="1"
                max={order.length}
                value={order.indexOf(tag.fromFrameId) + 1}
                onChange={(event) => {
                  const frameId = order[Number(event.target.value) - 1];
                  if (frameId !== undefined) entry.session.editTag(tag.id, { fromFrameId: frameId });
                  workspace.touch();
                }}
              />
            </label>
            <label>
              <span>{t("tag.to")}</span>
              <input
                aria-label={`${tag.name} ${t("tag.to")}`}
                type="range"
                min="1"
                max={order.length}
                value={order.indexOf(tag.toFrameId) + 1}
                onChange={(event) => {
                  const frameId = order[Number(event.target.value) - 1];
                  if (frameId !== undefined) entry.session.editTag(tag.id, { toFrameId: frameId });
                  workspace.touch();
                }}
              />
            </label>
          </div>
        ))}
      </div>
      <div className="timeline-body">
        <div className="timeline-layer-headers">
          <div className="timeline-corner">{t("timeline.layerFrame")}</div>
          <div style={{ transform: `translateY(${-scrollTop}px)` }}>
            {[...entry.session.model.layerOrder].reverse().map((layerId) => (
              <div className="timeline-layer-name" key={layerId}>{entry.session.model.layers[layerId]?.name}</div>
            ))}
          </div>
        </div>
        <div
          ref={scroller}
          className="timeline-scroll"
          onScroll={(event) => {
            entry.view.timeline.scrollLeft = event.currentTarget.scrollLeft;
            setScrollTop(event.currentTarget.scrollTop);
            workspace.touch();
          }}
        >
          <div className="timeline-frame-row" style={{ gridTemplateColumns: gridColumns, width: order.length * cellWidth }}>
            <span />
            {frames.map((frameId, visibleIndex) => {
              const frame = entry.session.model.frames[frameId],
                index = visible.start + visibleIndex;
              return (
                <button
                  data-testid={`frame-${index + 1}`}
                  className={`${entry.view.activeFrameId === frameId ? "active" : ""} ${entry.view.timeline.selectedFrames.has(frameId) ? "selected" : ""}`}
                  style={{ gridColumn: visibleIndex + 2 }}
                  type="button"
                  role="tab"
                  aria-selected={entry.view.activeFrameId === frameId}
                  aria-label={`${t("frame.title")} ${index + 1}, ${frame?.durationMs ?? 0} ms`}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/frame-id", frameId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = event.dataTransfer.getData("text/frame-id");
                    if (entry.session.model.frames[dragged] !== undefined) {
                      entry.session.moveFrame(dragged, index);
                      workspace.touch();
                    }
                  }}
                  onClick={(event) => selectFrame(frameId, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    selectFrame(frameId);
                    setContextMenu({ x: event.clientX, y: event.clientY, kind: "frame" });
                  }}
                >
                  F{index + 1}
                  <input
                    data-testid={`duration-${index + 1}`}
                    aria-label={`${t("frame.duration")} ${index + 1}`}
                    type="number"
                    min="10"
                    max="60000"
                    value={frame?.durationMs ?? 100}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (value >= 10 && value <= 60000) entry.session.setFrameDuration(frameId, value);
                      workspace.touch();
                    }}
                  />
                </button>
              );
            })}
          </div>
          {[...entry.session.model.layerOrder].reverse().map((layerId) => (
            <div className="timeline-cel-row" style={{ gridTemplateColumns: gridColumns, width: order.length * cellWidth }} key={layerId}>
              <span />
              {frames.map((frameId, visibleIndex) => {
                const cel = getCel(entry.session.model, layerId, frameId),
                  linkedCount = cel === null ? 0 : (references.get(cel.imageId) ?? 0),
                  linked = linkedCount > 1,
                  index = visible.start + visibleIndex;
                return (
                  <button
                    data-testid={`cel-${entry.session.model.layerOrder.indexOf(layerId)}-${index + 1}`}
                    type="button"
                    style={{ gridColumn: visibleIndex + 2 }}
                    className={`${entry.view.activeFrameId === frameId && entry.view.activeLayerId === layerId ? "active" : ""} ${cel === null ? "empty" : "filled"} ${cel !== null && entry.view.timeline.selectedCels.has(cel.id) ? "selected" : ""}`}
                    aria-label={`${entry.session.model.layers[layerId]?.name}, ${t("frame.title")} ${index + 1}, ${cel === null ? t("cel.empty") : linked ? t("cel.linked") : t("cel.title")}`}
                    onClick={(event) => {
                      entry.view.activeLayerId = layerId;
                      entry.view.timeline.selectedCelId = cel?.id ?? null;
                      const anchor = entry.view.timeline.celSelectionAnchor;
                      if (event.shiftKey && anchor?.layerId === layerId) {
                        const from = order.indexOf(anchor.frameId),
                          to = order.indexOf(frameId),
                          [start, end] = from <= to ? [from, to] : [to, from];
                        entry.view.timeline.selectedCels = new Set(
                          order
                            .slice(start, end + 1)
                            .map((id) => getCel(entry.session.model, layerId, id)?.id)
                            .filter((id): id is string => id !== undefined),
                        );
                      } else if ((event.ctrlKey || event.metaKey) && cel !== null) {
                        if (entry.view.timeline.selectedCels.has(cel.id))
                          entry.view.timeline.selectedCels.delete(cel.id);
                        else entry.view.timeline.selectedCels.add(cel.id);
                        entry.view.timeline.celSelectionAnchor = { layerId, frameId };
                      } else {
                        entry.view.timeline.selectedCels = new Set(cel === null ? [] : [cel.id]);
                        entry.view.timeline.celSelectionAnchor = { layerId, frameId };
                      }
                      selectFrame(frameId, event);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      entry.view.activeLayerId = layerId;
                      entry.view.timeline.selectedCelId = cel?.id ?? null;
                      selectFrame(frameId);
                      setContextMenu({ x: event.clientX, y: event.clientY, kind: "cel" });
                    }}
                  >
                    {cel === null ? <span>·</span> : <CelThumbnail entry={entry} imageId={cel.imageId} />}
                    {linked && <span className="linked-indicator" aria-hidden="true">↗{linkedCount}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {contextMenu !== null && (
        <div
          className="timeline-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextItems.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              disabled={!commands.canExecute(id)}
              onClick={() => {
                setContextMenu(null);
                void commands.execute(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
