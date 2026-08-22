import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Progress as RadixProgress } from "radix-ui";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}

export function Badge({ children, variant = "neutral", dot = false, className = "" }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${variant} ${className}`.trim()}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export interface SpinnerProps {
  label?: string;
  size?: "small" | "medium" | "large";
  className?: string;
}

export function Spinner({ label = "Loading", size = "medium", className = "" }: SpinnerProps) {
  return (
    <span className={`ui-spinner ui-spinner--${size} ${className}`.trim()} role="status" aria-label={label}>
      <span aria-hidden="true" />
    </span>
  );
}

export interface ProgressProps {
  label: string;
  value?: number | null;
  max?: number;
  showValue?: boolean;
  formatValue?: (value: number, max: number) => string;
  className?: string;
}

export function Progress({
  label,
  value = null,
  max = 100,
  showValue = true,
  formatValue = (current, total) => `${Math.round((current / total) * 100)}%`,
  className = "",
}: ProgressProps) {
  const normalizedMax = Math.max(1, max);
  const boundedValue = value === null ? null : Math.max(0, Math.min(normalizedMax, value));
  const valueLabel = boundedValue === null ? "In progress" : formatValue(boundedValue, normalizedMax);
  return (
    <div className={`ui-progress-field ${className}`.trim()}>
      <div className="ui-progress-field__label">
        <span>{label}</span>
        {showValue && <output>{valueLabel}</output>}
      </div>
      <RadixProgress.Root className="ui-progress" value={boundedValue} max={normalizedMax} aria-label={label} aria-valuetext={valueLabel}>
        <RadixProgress.Indicator
          className="ui-progress__indicator"
          style={{ transform: boundedValue === null ? undefined : `translateX(-${100 - (boundedValue / normalizedMax) * 100}%)` }}
        />
      </RadixProgress.Root>
    </div>
  );
}

export type CalloutVariant = "info" | "success" | "warning" | "danger";

export interface CalloutProps {
  title: ReactNode;
  children?: ReactNode;
  variant?: CalloutVariant;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const calloutIcons = {
  info: <Info aria-hidden="true" />,
  success: <CheckCircle2 aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  danger: <AlertCircle aria-hidden="true" />,
} satisfies Record<CalloutVariant, ReactNode>;

export function Callout({ title, children, variant = "info", icon = calloutIcons[variant], actions, className = "" }: CalloutProps) {
  return (
    <div className={`ui-callout ui-callout--${variant} ${className}`.trim()} role={variant === "danger" ? "alert" : "note"}>
      <span className="ui-callout__icon">{icon}</span>
      <span className="ui-callout__copy"><strong>{title}</strong>{children && <span>{children}</span>}</span>
      {actions && <span className="ui-callout__actions">{actions}</span>}
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, primaryAction, secondaryAction, className = "" }: EmptyStateProps) {
  return (
    <div className={`ui-empty-state ${className}`.trim()}>
      {icon && <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {(primaryAction || secondaryAction) && <div className="ui-empty-state__actions">{primaryAction}{secondaryAction}</div>}
    </div>
  );
}
