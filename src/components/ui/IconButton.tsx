import { forwardRef, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "radix-ui";

export type IconButtonVariant = "default" | "primary" | "danger" | "ghost";
export type IconButtonSize = "small" | "medium" | "large";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  tooltip?: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  children,
  variant = "default",
  size = "medium",
  loading = false,
  tooltip = label,
  tooltipSide = "bottom",
  className = "",
  disabled,
  onBlur,
  onKeyDown,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  ...props
}, forwardedRef) {
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
          className={`icon-button ui-icon-button ui-icon-button--${variant} ui-icon-button--${size} ${className}`.trim()}
          {...props}
          type="button"
          ref={forwardedRef}
          aria-label={label}
          aria-busy={loading || undefined}
          disabled={disabled || loading}
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
        >
          {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={tooltipSide} sideOffset={7}>
          {tooltip}
          <Tooltip.Arrow className="tooltip__arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});
