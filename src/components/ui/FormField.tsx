import { useId, type ReactNode } from "react";

export interface FormFieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

export interface FormFieldProps {
  label: ReactNode;
  children: (controlProps: FormFieldControlProps) => ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  controlId?: string;
  className?: string;
}

export function FormField({
  label,
  children,
  description,
  error,
  required = false,
  hideLabel = false,
  controlId,
  className = "",
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? `field-${generatedId}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`ui-field${error ? " is-invalid" : ""} ${className}`.trim()}>
      <label className={`ui-field__label${hideLabel ? " sr-only" : ""}`} htmlFor={id}>
        {label}{required && <span className="ui-field__required" aria-hidden="true"> *</span>}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || undefined,
      })}
      {description && <small className="ui-field__description" id={descriptionId}>{description}</small>}
      {error && <small className="ui-field__error" id={errorId}>{error}</small>}
    </div>
  );
}
