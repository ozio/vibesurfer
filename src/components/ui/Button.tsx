import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";
export type ButtonSize = "small" | "medium" | "large";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "default",
  size = "medium",
  loading = false,
  leadingIcon,
  trailingIcon,
  className = "",
  disabled,
  children,
  type = "button",
  ...props
}, ref) {
  return (
    <button
      className={`button ui-button button--${variant} ui-button--${size} ${className}`.trim()}
      {...props}
      type={type}
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : leadingIcon}
      <span className="ui-button__label">{children}</span>
      {!loading && trailingIcon}
    </button>
  );
});
