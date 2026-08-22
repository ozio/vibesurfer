import {
  forwardRef,
  type HTMLAttributes,
  type IframeHTMLAttributes,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  ExternalLink,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import "../../artifacts/artifact-surface.css";
import { Button } from "../ui/Button";
import { CodeBlock } from "../ui/Code";
import { Dialog } from "../ui/Dialog";
import { Callout, EmptyState, Spinner } from "../ui/Feedback";
import {
  MenuActionItem,
  MenuActionSeparator,
  PositionedMenu,
} from "../ui/Menu";

export type SurfaceShellVariant = "default" | "remote" | "generated";

export interface SurfaceShellProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceShellVariant;
  children: ReactNode;
}

export function SurfaceShell({
  variant = "default",
  className = "",
  children,
  ...props
}: SurfaceShellProps) {
  return (
    <div className={`page-surface page-surface--${variant} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export interface RemoteBlockedStateProps {
  hostname: string;
  onOpenExternal: () => void;
  title?: string;
  actionLabel?: string;
}

export function RemoteBlockedState({
  hostname,
  onOpenExternal,
  title = "Live web stays outside vibesurfer",
  actionLabel = "Open live site externally",
}: RemoteBlockedStateProps) {
  return (
    <SurfaceShell variant="remote">
      <EmptyState
        className="surface-error"
        icon={<Info />}
        title={title}
        description={(
          <>This legacy tab will not contact <strong>{hostname}</strong>. Generate an imagined version from the address bar, or explicitly open the live site in your system browser.</>
        )}
        primaryAction={(
          <Button variant="primary" leadingIcon={<ExternalLink aria-hidden="true" />} onClick={onOpenExternal}>
            {actionLabel}
          </Button>
        )}
      />
    </SurfaceShell>
  );
}

export type FrameConnectionStatus = "connecting" | "ready" | "failed";

export interface FrameConnectionStateProps {
  status: FrameConnectionStatus;
  message?: string;
}

export function FrameConnectionState({ status, message }: FrameConnectionStateProps) {
  if (status === "ready") {
    return null;
  }

  if (status === "failed") {
    return (
      <Callout className="frame-connection-state frame-connection-state--failed" variant="danger" title="Safe page bridge unavailable">
        {message ?? "The generated document could not be connected."}
      </Callout>
    );
  }

  return (
    <div className="frame-connection-state frame-connection-state--connecting">
      <Spinner size="small" label="Connecting generated page" />
      <span>{message ?? "Connecting the safe page bridge…"}</span>
    </div>
  );
}

export interface ArtifactFrameShellProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "children" | "src" | "title"> {
  src: string;
  title: string;
  connectionStatus: FrameConnectionStatus;
  connectionMessage?: string;
  children?: ReactNode;
}

export const ArtifactFrameShell = forwardRef<HTMLIFrameElement, ArtifactFrameShellProps>(function ArtifactFrameShell({
  src,
  title,
  connectionStatus,
  connectionMessage,
  children,
  className = "",
  ...props
}, ref) {
  return (
    <SurfaceShell variant="generated">
      <iframe
        {...props}
        ref={ref}
        className={`page-frame artifact-frame--${connectionStatus} ${className}`.trim()}
        title={title}
        src={src}
        scrolling="auto"
        sandbox="allow-scripts"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
      <FrameConnectionState status={connectionStatus} message={connectionMessage} />
      {children}
    </SurfaceShell>
  );
});

export interface GenerationFailureNoticeProps {
  cancelled?: boolean;
  partial?: boolean;
  message: string;
  onRetry?: () => void;
  onChooseModel?: () => void;
}

export function GenerationFailureNotice({
  cancelled = false,
  partial = false,
  message,
  onRetry,
  onChooseModel,
}: GenerationFailureNoticeProps) {
  const actions = onRetry || onChooseModel ? (
    <>
      {onChooseModel && <Button size="small" variant="primary" onClick={onChooseModel}>Choose another model</Button>}
      {onRetry && <Button size="small" onClick={onRetry}>Try again</Button>}
    </>
  ) : undefined;

  return (
    <Callout
      className="generation-failure-notice"
      variant="danger"
      title={cancelled ? "Generation stopped" : "Generation failed"}
      actions={actions}
    >
      {message} {partial ? "The partial result is still shown." : "The last complete version is still shown."}
    </Callout>
  );
}

export interface ArtifactErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
  onChooseModel?: () => void;
}

export function ArtifactErrorState({
  title,
  message,
  onRetry,
  onChooseModel,
}: ArtifactErrorStateProps) {
  return (
    <SurfaceShell variant="generated">
      <div className="artifact-error" role="alert">
        <EmptyState
          className="artifact-error__card"
          icon={<TriangleAlert />}
          title={title}
          description={message}
          primaryAction={onChooseModel ? <Button variant="primary" onClick={onChooseModel}>Choose another model</Button> : onRetry ? <Button variant="primary" onClick={onRetry}>Try again</Button> : undefined}
          secondaryAction={onChooseModel && onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
        />
      </div>
    </SurfaceShell>
  );
}

export interface SourceViewerDialogProps {
  open: boolean;
  title: string;
  source: string;
  onOpenChange: (open: boolean) => void;
}

export function SourceViewerDialog({ open, title, source, onOpenChange }: SourceViewerDialogProps) {
  return (
    <Dialog
      className="source-dialog"
      size="large"
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="source-dialog__title"><Code2 aria-hidden="true" /> Source: {title}</span>}
      description="Page HTML displayed as inert text."
    >
      <CodeBlock className="source-dialog__code" code={source} language="html" label="Document source" wrap={false} />
    </Dialog>
  );
}

export type ArchivedWorldDialogKind = "navigation" | "dynamic-action";

export interface ArchivedWorldDialogProps {
  open: boolean;
  kind: ArchivedWorldDialogKind;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onRestore: () => void;
  onUseCurrent?: () => void;
}

export function ArchivedWorldDialog({
  open,
  kind,
  onOpenChange,
  onCancel,
  onRestore,
  onUseCurrent,
}: ArchivedWorldDialogProps) {
  const navigation = kind === "navigation";
  return (
    <Dialog
      className="archived-world-dialog"
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onCancel();
      }}
      title={navigation ? "Continue from an archived site?" : "Restore this archived site?"}
      description={navigation
        ? "This snapshot belongs to an archived SiteWorld. Choose which identity should own the next generated page."
        : "Live state and model actions require this SiteWorld identity to be active again. Nothing will update until you restore it."}
      footer={(
        <>
          {navigation && onUseCurrent && <Button variant="primary" onClick={onUseCurrent}>Use current identity</Button>}
          <Button variant={navigation ? "default" : "primary"} onClick={onRestore}>
            {navigation ? "Restore this identity" : "Restore and continue"}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      )}
    />
  );
}

export interface PageContextMenuState {
  left: number;
  top: number;
  href?: string;
  linkText?: string;
  ariaLabel?: string;
  linkContext?: string;
  context?: string;
}

export interface PageContextMenuProps {
  menu: PageContextMenuState;
  open?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onDismiss: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onViewSource: () => void;
  onOpenLink?: () => void;
}

export function PageContextMenu({
  menu,
  open = true,
  canGoBack,
  canGoForward,
  onDismiss,
  onBack,
  onForward,
  onReload,
  onViewSource,
  onOpenLink,
}: PageContextMenuProps) {
  const run = (action: () => void) => {
    onDismiss();
    action();
  };

  return (
    <PositionedMenu
      open={open}
      left={menu.left}
      top={menu.top}
      ariaLabel={menu.href ? "Link actions" : "Page actions"}
      className="page-context-menu"
      onOpenChange={(next) => { if (!next) onDismiss(); }}
    >
      {onOpenLink && (
        <>
          <MenuActionItem onClick={() => run(onOpenLink)}><ExternalLink aria-hidden="true" /><span>Open link in new tab</span></MenuActionItem>
          <MenuActionSeparator />
        </>
      )}
      <MenuActionItem disabled={!canGoBack} onClick={() => run(onBack)}><ArrowLeft aria-hidden="true" /><span>Back</span></MenuActionItem>
      <MenuActionItem disabled={!canGoForward} onClick={() => run(onForward)}><ArrowRight aria-hidden="true" /><span>Forward</span></MenuActionItem>
      <MenuActionItem onClick={() => run(onReload)}><RefreshCw aria-hidden="true" /><span>Reload</span></MenuActionItem>
      <MenuActionSeparator />
      <MenuActionItem onClick={() => run(onViewSource)}><Code2 aria-hidden="true" /><span>View source</span></MenuActionItem>
    </PositionedMenu>
  );
}
