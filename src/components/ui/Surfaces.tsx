import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "elevated" | "outlined";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  as?: "div" | "article" | "section";
  title?: ReactNode;
  description?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  variant?: CardVariant;
}

export function Card({
  as: Element = "div",
  title,
  description,
  headerAction,
  footer,
  variant = "default",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <Element className={`ui-card ui-card--${variant} ${className}`.trim()} {...props}>
      {(title || description || headerAction) && (
        <div className="ui-card__header">
          <span>{title && <strong>{title}</strong>}{description && <small>{description}</small>}</span>
          {headerAction}
        </div>
      )}
      <div className="ui-card__body">{children}</div>
      {footer && <div className="ui-card__footer">{footer}</div>}
    </Element>
  );
}

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

export function ListRow({
  title,
  description,
  leading,
  trailing,
  selected,
  className = "",
  type = "button",
  ...props
}: ListRowProps) {
  return (
    <button
      className={`ui-list-row${selected === true ? " is-selected" : ""} ${className}`.trim()}
      type={type}
      aria-pressed={selected}
      {...props}
    >
      {leading && <span className="ui-list-row__leading" aria-hidden="true">{leading}</span>}
      <span className="ui-list-row__copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      {trailing && <span className="ui-list-row__trailing">{trailing}</span>}
    </button>
  );
}
