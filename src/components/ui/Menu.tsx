import {
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu } from "radix-ui";

export interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  ariaLabel?: string;
  showArrow?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  modal?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Menu({
  trigger,
  children,
  ariaLabel = "Actions",
  showArrow = false,
  side = "bottom",
  align = "end",
  sideOffset = 6,
  modal = false,
  className = "",
  ...rootProps
}: MenuProps) {
  return (
    <DropdownMenu.Root modal={modal} {...rootProps}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`menu ui-menu ${className}`.trim()}
          aria-label={ariaLabel}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          {children}
          {showArrow && <DropdownMenu.Arrow className="menu__arrow" />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface MenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Item> {
  shortcut?: ReactNode;
  destructive?: boolean;
}

export function MenuItem({ children, shortcut, destructive = false, className = "", ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={`menu__item ui-menu__item${destructive ? " is-destructive" : ""} ${className}`.trim()}
      {...props}
    >
      {children}
      {shortcut && <span className="menu__value">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export type MenuCheckboxItemProps = ComponentPropsWithoutRef<typeof DropdownMenu.CheckboxItem>;

export function MenuCheckboxItem({ children, className = "", ...props }: MenuCheckboxItemProps) {
  return (
    <DropdownMenu.CheckboxItem className={`menu__item ui-menu__item ui-menu__check-item ${className}`.trim()} {...props}>
      <span className="ui-menu__indicator"><DropdownMenu.ItemIndicator><Check aria-hidden="true" /></DropdownMenu.ItemIndicator></span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export type MenuRadioGroupProps = ComponentPropsWithoutRef<typeof DropdownMenu.RadioGroup>;
export function MenuRadioGroup(props: MenuRadioGroupProps) {
  return <DropdownMenu.RadioGroup {...props} />;
}

export type MenuRadioItemProps = ComponentPropsWithoutRef<typeof DropdownMenu.RadioItem>;
export function MenuRadioItem({ children, className = "", ...props }: MenuRadioItemProps) {
  return (
    <DropdownMenu.RadioItem className={`menu__item ui-menu__item ui-menu__check-item ${className}`.trim()} {...props}>
      <span className="ui-menu__indicator"><DropdownMenu.ItemIndicator><span className="ui-menu__radio-dot" /></DropdownMenu.ItemIndicator></span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export type MenuLabelProps = ComponentPropsWithoutRef<typeof DropdownMenu.Label>;
export function MenuLabel({ className = "", ...props }: MenuLabelProps) {
  return <DropdownMenu.Label className={`menu__label ${className}`.trim()} {...props} />;
}

export type MenuSeparatorProps = ComponentPropsWithoutRef<typeof DropdownMenu.Separator>;
export function MenuSeparator({ className = "", ...props }: MenuSeparatorProps) {
  return <DropdownMenu.Separator className={`menu__separator ${className}`.trim()} {...props} />;
}

export type MenuSubProps = ComponentPropsWithoutRef<typeof DropdownMenu.Sub>;
export function MenuSub(props: MenuSubProps) {
  return <DropdownMenu.Sub {...props} />;
}

export type MenuSubTriggerProps = ComponentPropsWithoutRef<typeof DropdownMenu.SubTrigger>;
export function MenuSubTrigger({ children, className = "", ...props }: MenuSubTriggerProps) {
  return (
    <DropdownMenu.SubTrigger className={`menu__item ui-menu__item ${className}`.trim()} {...props}>
      {children}<ChevronRight className="ui-menu__sub-chevron" aria-hidden="true" />
    </DropdownMenu.SubTrigger>
  );
}

export interface MenuSubContentProps extends ComponentPropsWithoutRef<typeof DropdownMenu.SubContent> {
  children: ReactNode;
}
export function MenuSubContent({ children, className = "", ...props }: MenuSubContentProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent className={`menu menu--sub ui-menu ${className}`.trim()} sideOffset={4} {...props}>
        {children}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  );
}

export interface PositionedMenuProps {
  open: boolean;
  left: number;
  top: number;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Menu presentation for application-owned virtual surfaces such as sandboxed
 * frames. It shares the same item styling and keyboard contract as Radix menus,
 * while accepting host coordinates instead of a DOM trigger.
 */
export function PositionedMenu({
  open,
  left,
  top,
  children,
  ariaLabel = "Actions",
  className = "",
  onOpenChange,
}: PositionedMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="ui-positioned-menu__backdrop"
        aria-hidden="true"
        onPointerDown={() => onOpenChange(false)}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenChange(false);
        }}
      />
      <div
        ref={menuRef}
        className={`menu ui-menu ui-positioned-menu ${className}`.trim()}
        role="menu"
        aria-label={ariaLabel}
        style={{ left, top }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          const items = menuItems(event.currentTarget);
          if (items.length === 0) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            items[(current + delta + items.length) % items.length]?.focus();
          } else if (event.key === "Home") {
            event.preventDefault();
            items[0]?.focus();
          } else if (event.key === "End") {
            event.preventDefault();
            items.at(-1)?.focus();
          } else if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export interface MenuActionItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  shortcut?: ReactNode;
  destructive?: boolean;
}

export function MenuActionItem({
  children,
  shortcut,
  destructive = false,
  className = "",
  type = "button",
  ...props
}: MenuActionItemProps) {
  return (
    <button
      {...props}
      className={`menu__item ui-menu__item${destructive ? " is-destructive" : ""} ${className}`.trim()}
      type={type}
      role="menuitem"
    >
      {children}
      {shortcut && <span className="menu__value">{shortcut}</span>}
    </button>
  );
}

export function MenuActionSeparator() {
  return <div className="menu__separator" role="separator" />;
}

function menuItems(container: HTMLElement | null): HTMLButtonElement[] {
  return container
    ? Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    : [];
}
