import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";

export interface TooltipMetadata {
  readonly name: string;
  readonly shortcut?: string;
  readonly description: string;
  readonly disabledReason?: string;
}

export function Tooltip({ metadata, children }: { readonly metadata: TooltipMetadata; readonly children: (descriptionId: string) => ReactElement }) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLSpanElement>(null), timer = useRef<number | null>(null), [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0, above: false });
  const close = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };
  const show = (delayed: boolean): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const reveal = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const above = rect.bottom > window.innerHeight - 140;
      setPosition({
        left: Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2)),
        top: above ? rect.top - 8 : rect.bottom + 8,
        above,
      });
      setOpen(true);
    };
    if (delayed) timer.current = window.setTimeout(reveal, 350);
    else reveal();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("keydown", escape); if (timer.current !== null) window.clearTimeout(timer.current); };
  }, []);
  useLayoutEffect(() => {
    if (!open || popup.current === null) return;
    const rect = popup.current.getBoundingClientRect(), margin = 8;
    let adjustment = 0;
    if (rect.left < margin) adjustment = margin - rect.left;
    else if (rect.right > window.innerWidth - margin)
      adjustment = window.innerWidth - margin - rect.right;
    if (Math.abs(adjustment) > 0.5)
      setPosition((current) => ({ ...current, left: current.left + adjustment }));
  }, [open, position.left]);
  return (
    <span ref={anchor} className="tooltip-anchor" onMouseEnter={() => show(true)} onMouseLeave={close} onFocusCapture={() => show(false)} onBlurCapture={close}>
      {children(id)}
      {open && createPortal(
        <span ref={popup} id={id} className={`tooltip-popup ${position.above ? "tooltip-above" : ""}`} role="tooltip" style={{ left: position.left, top: position.top }}>
          <strong>{metadata.name}{metadata.shortcut === undefined ? "" : ` (${metadata.shortcut})`}</strong>
          <span>{metadata.description}</span>
          {metadata.disabledReason !== undefined && <span className="tooltip-disabled">{metadata.disabledReason}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
}
