import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "radix-ui";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export function IconButton({
  label,
  children,
  tooltipSide = "bottom",
  className = "",
  onBlur,
  onKeyDown,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  ...props
}: IconButtonProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressFocusTooltip = useRef(false);

  return (
    <Tooltip.Root
      open={tooltipOpen}
      onOpenChange={(open) => {
        if (open && suppressFocusTooltip.current) return;
        setTooltipOpen(open);
      }}
      delayDuration={500}
    >
      <Tooltip.Trigger asChild>
        <button
          className={`icon-button ${className}`}
          type="button"
          aria-label={label}
          onBlur={(event) => {
            setTooltipOpen(false);
            onBlur?.(event);
          }}
          onKeyDown={(event) => {
            suppressFocusTooltip.current = false;
            onKeyDown?.(event);
          }}
          onPointerDown={(event) => {
            suppressFocusTooltip.current = true;
            setTooltipOpen(false);
            onPointerDown?.(event);
          }}
          onPointerEnter={(event) => {
            suppressFocusTooltip.current = false;
            onPointerEnter?.(event);
          }}
          onPointerLeave={(event) => {
            setTooltipOpen(false);
            onPointerLeave?.(event);
          }}
          {...props}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={tooltipSide} sideOffset={7}>
          {label}
          <Tooltip.Arrow className="tooltip__arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
