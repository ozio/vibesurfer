import { useId, type ReactElement, type ReactNode } from "react";
import { Popover as RadixPopover } from "radix-ui";

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  modal?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Popover({
  trigger,
  children,
  title,
  description,
  footer,
  ariaLabel = "Popover",
  side = "bottom",
  align = "center",
  sideOffset = 8,
  modal = false,
  className = "",
  ...rootProps
}: PopoverProps) {
  const titleId = useId();

  return (
    <RadixPopover.Root modal={modal} {...rootProps}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          className={`popover ui-popover ${className}`.trim()}
          side={side}
          align={align}
          sideOffset={sideOffset}
          aria-label={title ? undefined : ariaLabel}
          aria-labelledby={title ? titleId : undefined}
        >
          {(title || description) && (
            <header className="ui-popover__header">
              {title && <strong id={titleId}>{title}</strong>}
              {description && <small>{description}</small>}
            </header>
          )}
          <div className="ui-popover__body">{children}</div>
          {footer && <footer className="ui-popover__footer">{footer}</footer>}
          <RadixPopover.Arrow className="popover__arrow" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
