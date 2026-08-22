import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { Check } from "lucide-react";
import { ContextMenu as RadixContextMenu } from "radix-ui";

export interface ContextMenuProps {
  children: ReactElement;
  content: ReactNode;
  ariaLabel?: string;
  modal?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function ContextMenu({ children, content, ariaLabel = "Context actions", modal = false, onOpenChange, className = "" }: ContextMenuProps) {
  return (
    <RadixContextMenu.Root modal={modal} onOpenChange={onOpenChange}>
      <RadixContextMenu.Trigger asChild>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={`menu ui-menu ${className}`.trim()} aria-label={ariaLabel} collisionPadding={8}>
          {content}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}

export interface ContextMenuItemProps extends ComponentPropsWithoutRef<typeof RadixContextMenu.Item> {
  shortcut?: ReactNode;
  destructive?: boolean;
}
export function ContextMenuItem({ children, shortcut, destructive = false, className = "", ...props }: ContextMenuItemProps) {
  return (
    <RadixContextMenu.Item className={`menu__item ui-menu__item${destructive ? " is-destructive" : ""} ${className}`.trim()} {...props}>
      {children}
      {shortcut && <span className="menu__value">{shortcut}</span>}
    </RadixContextMenu.Item>
  );
}

export type ContextMenuCheckboxItemProps = ComponentPropsWithoutRef<typeof RadixContextMenu.CheckboxItem>;
export function ContextMenuCheckboxItem({ children, className = "", ...props }: ContextMenuCheckboxItemProps) {
  return (
    <RadixContextMenu.CheckboxItem className={`menu__item ui-menu__item ui-menu__check-item ${className}`.trim()} {...props}>
      <span className="ui-menu__indicator"><RadixContextMenu.ItemIndicator><Check aria-hidden="true" /></RadixContextMenu.ItemIndicator></span>
      {children}
    </RadixContextMenu.CheckboxItem>
  );
}

export type ContextMenuLabelProps = ComponentPropsWithoutRef<typeof RadixContextMenu.Label>;
export function ContextMenuLabel({ className = "", ...props }: ContextMenuLabelProps) {
  return <RadixContextMenu.Label className={`menu__label ${className}`.trim()} {...props} />;
}

export type ContextMenuSeparatorProps = ComponentPropsWithoutRef<typeof RadixContextMenu.Separator>;
export function ContextMenuSeparator({ className = "", ...props }: ContextMenuSeparatorProps) {
  return <RadixContextMenu.Separator className={`menu__separator ${className}`.trim()} {...props} />;
}
