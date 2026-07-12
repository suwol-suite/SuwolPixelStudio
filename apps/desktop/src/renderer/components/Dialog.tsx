import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

interface DialogProps {
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Dialog({
  title,
  closeLabel,
  onClose,
  children,
  className = "",
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function handleBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose();
  }
  function handleKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current,
      items =
        root === null
          ? []
          : [
              ...root.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
              ),
            ];
    if (items.length === 0) return;
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={handleBackdrop}>
      <div
        className={`dialog ${className}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKey}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <Tooltip metadata={{ name: closeLabel, description: closeLabel }}>
            {(descriptionId) => (
              <button
                className="icon-button"
                type="button"
                aria-label={closeLabel}
                aria-describedby={descriptionId}
                onClick={onClose}
              >
                <Icon name="close" />
              </button>
            )}
          </Tooltip>
        </header>
        {children}
      </div>
    </div>
  );
}
