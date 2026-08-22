import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { RadioGroup, Switch as RadixSwitch } from "radix-ui";

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  className?: string;
}

export function Switch({ label, description, className = "", ...props }: SwitchProps) {
  const id = useId();
  return (
    <div className={`ui-switch-field${props.disabled ? " is-disabled" : ""} ${className}`.trim()}>
      <span className="ui-switch-field__copy">
        <label htmlFor={id}>{label}</label>
        {description && <small id={`${id}-description`}>{description}</small>}
      </span>
      <RadixSwitch.Root className="switch ui-switch" id={id} aria-describedby={description ? `${id}-description` : undefined} {...props}>
        <RadixSwitch.Thumb className="switch__thumb" />
      </RadixSwitch.Root>
    </div>
  );
}

export interface SegmentedControlOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  label: string;
  options: readonly SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function SegmentedControl({ label, options, orientation = "horizontal", className = "", ...props }: SegmentedControlProps) {
  return (
    <RadioGroup.Root
      className={`segmented-control ui-segmented-control ui-segmented-control--${orientation} ${className}`.trim()}
      aria-label={label}
      orientation={orientation}
      {...props}
    >
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export interface RadioCardGroupProps {
  label: string;
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function RadioCardGroup({ label, orientation = "vertical", className = "", ...props }: RadioCardGroupProps) {
  return (
    <RadioGroup.Root
      className={`ui-radio-card-group ui-radio-card-group--${orientation} ${className}`.trim()}
      aria-label={label}
      orientation={orientation}
      {...props}
    />
  );
}

export interface RadioCardProps {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function RadioCard({ value, label, description, icon, badge, disabled, className = "" }: RadioCardProps) {
  return (
    <RadioGroup.Item value={value} disabled={disabled} className={`ui-radio-card ${className}`.trim()}>
      {icon && <span className="ui-radio-card__icon" aria-hidden="true">{icon}</span>}
      <span className="ui-radio-card__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      {badge}
      <span className="ui-radio-card__indicator" aria-hidden="true"><Check /></span>
    </RadioGroup.Item>
  );
}
