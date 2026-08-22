import type { ReactElement, ReactNode } from "react";
import { Tooltip as RadixTooltip } from "radix-ui";

export interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delayDuration = 450,
  disabled = false,
  ...rootProps
}: TooltipProps) {
  if (disabled) return children;

  return (
    <RadixTooltip.Root delayDuration={delayDuration} {...rootProps}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltip ui-tooltip" side={side} align={align} sideOffset={7}>
          {content}
          <RadixTooltip.Arrow className="tooltip__arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
