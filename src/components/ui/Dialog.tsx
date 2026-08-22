import { useId, type ReactElement, type ReactNode } from "react";
import { X } from "lucide-react";
import { AlertDialog, Dialog as RadixDialog } from "radix-ui";

export type DialogSize = "small" | "medium" | "large";

export interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  trigger?: ReactElement;
  closeLabel?: string;
  size?: DialogSize;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Dialog({
  title,
  description,
  children,
  footer,
  trigger,
  closeLabel = "Close dialog",
  size = "medium",
  className = "",
  ...rootProps
}: DialogProps) {
  const descriptionId = useId();
  return (
    <RadixDialog.Root {...rootProps}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content
          className={`dialog ui-dialog ui-dialog--${size} ${className}`.trim()}
          aria-describedby={description ? descriptionId : undefined}
        >
          <header className="ui-dialog__header">
            <RadixDialog.Title>{title}</RadixDialog.Title>
            {description && <RadixDialog.Description id={descriptionId}>{description}</RadixDialog.Description>}
          </header>
          {children && <div className="ui-dialog__body">{children}</div>}
          {footer && <footer className="dialog__actions ui-dialog__footer">{footer}</footer>}
          <RadixDialog.Close className="dialog__close" aria-label={closeLabel}><X aria-hidden="true" /></RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  trigger: ReactElement;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  disabled = false,
  onConfirm,
  ...rootProps
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root {...rootProps}>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog ui-dialog ui-confirm-dialog">
          <header className="ui-dialog__header">
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
          </header>
          <footer className="dialog__actions ui-dialog__footer">
            <AlertDialog.Cancel className="button ui-button">{cancelLabel}</AlertDialog.Cancel>
            <AlertDialog.Action
              className={`button ui-button button--${destructive ? "danger" : "primary"}`}
              disabled={disabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </footer>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
