import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export type ResizeHandleOrientation = "horizontal" | "vertical";

export interface ResizeHandleProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  orientation?: ResizeHandleOrientation;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function ResizeHandle({
  value,
  onValueChange,
  min = 160,
  max = 480,
  step = 10,
  orientation = "vertical",
  label = "Resize panel",
  disabled = false,
  className = "",
}: ResizeHandleProps) {
  const dragStart = useRef<{ coordinate: number; value: number } | undefined>(undefined);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const coordinate = (event: PointerEvent) => orientation === "vertical" ? event.clientX : event.clientY;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increase = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let next = value;
    if (event.key === decrease) next = value - step;
    else if (event.key === increase) next = value + step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    onValueChange(clamp(next));
  };

  return (
    <div
      className={`ui-resize-handle ui-resize-handle--${orientation} ${className}`.trim()}
      role="separator"
      tabIndex={disabled ? undefined : 0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKeyDown}
      onPointerDown={disabled ? undefined : (event) => {
        dragStart.current = { coordinate: coordinate(event), value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={disabled ? undefined : (event) => {
        if (!dragStart.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onValueChange(clamp(dragStart.current.value + coordinate(event) - dragStart.current.coordinate));
      }}
      onPointerUp={(event) => {
        dragStart.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { dragStart.current = undefined; }}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export interface ShortcutProps {
  keys: string | readonly string[];
  label?: string;
  separator?: ReactNode;
  className?: string;
}

export function Shortcut({ keys, label, separator = "+", className = "" }: ShortcutProps) {
  const parts = typeof keys === "string" ? keys.split("+") : keys;
  return (
    <span className={`ui-shortcut ${className}`.trim()} role="img" aria-label={label ?? parts.join(" plus ")}>
      {parts.map((key, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 && <span className="ui-shortcut__separator" aria-hidden="true">{separator}</span>}
          <kbd aria-hidden="true">{key.trim()}</kbd>
        </span>
      ))}
    </span>
  );
}
