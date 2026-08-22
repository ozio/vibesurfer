import { ShieldCheck, ShieldEllipsis } from "lucide-react";
import type { ReactElement } from "react";
import { Popover } from "../ui/Popover";
import type { SiteInformation } from "./omnibox-model";

export interface SiteInfoPopoverProps {
  information: SiteInformation;
  trigger: ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function SiteInfoPopover({
  information,
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  side = "bottom",
  align = "start",
}: SiteInfoPopoverProps) {
  return (
    <Popover
      className="site-info-popover"
      trigger={trigger}
      title={(
        <span className="site-info-popover__title">
          <span aria-hidden="true"><ShieldEllipsis /></span>
          <span>{information.title}</span>
        </span>
      )}
      description={information.status}
      side={side}
      align={align}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <div className="site-info-popover__location" title={information.location}>
        {information.location}
      </div>
      <p className="site-info-popover__note">
        <ShieldCheck aria-hidden="true" />
        <span>{information.note}</span>
      </p>
    </Popover>
  );
}
