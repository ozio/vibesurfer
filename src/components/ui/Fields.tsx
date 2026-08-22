import {
  useId,
  type ChangeEvent,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Minus, Plus, Search, X } from "lucide-react";
import { FormField } from "./FormField";
import { useControllableState } from "./useControllableState";

interface CommonFieldProps {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
}

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue">, CommonFieldProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  clearLabel?: string;
  onClear?: () => void;
}

export function SearchField({
  label,
  description,
  error,
  hideLabel = false,
  value,
  defaultValue = "",
  onValueChange,
  onChange,
  onClear,
  clearLabel = "Clear search",
  className = "",
  disabled,
  id,
  ...props
}: SearchFieldProps) {
  const [currentValue, setCurrentValue] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    setCurrentValue(event.currentTarget.value);
    onChange?.(event);
  };

  return (
    <FormField label={label} description={description} error={error} hideLabel={hideLabel} required={props.required} controlId={id} className="ui-search-field">
      {(controlProps) => (
        <div className={`ui-field__control ui-search-field__control ${className}`.trim()}>
          <Search aria-hidden="true" />
          <input type="search" value={currentValue} onChange={change} disabled={disabled} {...controlProps} {...props} />
          {currentValue && !disabled && (
            <button type="button" className="ui-search-field__clear" aria-label={clearLabel} onClick={() => { setCurrentValue(""); onClear?.(); }}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </FormField>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children">, CommonFieldProps {
  options: readonly SelectOption[];
  placeholder?: string;
}

export function Select({ label, description, error, hideLabel = false, options, placeholder, className = "", id, ...props }: SelectProps) {
  return (
    <FormField label={label} description={description} error={error} hideLabel={hideLabel} required={props.required} controlId={id}>
      {(controlProps) => (
        <div className="ui-field__control ui-select__control">
          <select className={`ui-select ${className}`.trim()} {...controlProps} {...props}>
            {placeholder && <option value="" disabled>{placeholder}</option>}
            {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
      )}
    </FormField>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, CommonFieldProps {
  showCount?: boolean;
}

export function TextArea({
  label,
  description,
  error,
  hideLabel = false,
  showCount = false,
  className = "",
  value,
  defaultValue,
  maxLength,
  id,
  ...props
}: TextAreaProps) {
  const initial = String(defaultValue ?? "");
  const [uncontrolledCount, setUncontrolledCount] = useControllableState({ value: value === undefined ? undefined : String(value), defaultValue: initial });
  const count = value === undefined ? uncontrolledCount.length : String(value).length;
  return (
    <FormField label={label} description={description} error={error} hideLabel={hideLabel} required={props.required} controlId={id} className="ui-textarea-field">
      {(controlProps) => (
        <>
          <textarea
            className={`ui-textarea ${className}`.trim()}
            value={value}
            defaultValue={defaultValue}
            maxLength={maxLength}
            {...controlProps}
            {...props}
            onChange={(event) => {
              setUncontrolledCount(event.currentTarget.value);
              props.onChange?.(event);
            }}
          />
          {showCount && <output className="ui-field__count" htmlFor={controlProps.id}>{count}{maxLength ? ` / ${maxLength}` : ""}</output>}
        </>
      )}
    </FormField>
  );
}

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange">, CommonFieldProps {
  value?: number | "";
  defaultValue?: number | "";
  onValueChange?: (value: number | "") => void;
  decrementLabel?: string;
  incrementLabel?: string;
}

export function NumberField({
  label,
  description,
  error,
  hideLabel = false,
  value,
  defaultValue = "",
  onValueChange,
  min,
  max,
  step = 1,
  disabled,
  readOnly,
  id,
  decrementLabel = "Decrease value",
  incrementLabel = "Increase value",
  className = "",
  ...props
}: NumberFieldProps) {
  const [currentValue, setCurrentValue] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const numericStep = Number(step) || 1;
  const setBoundedValue = (next: number | "") => {
    if (next === "") return setCurrentValue("");
    setCurrentValue(Math.min(Number(max ?? Infinity), Math.max(Number(min ?? -Infinity), next)));
  };
  const nudge = (direction: -1 | 1) => setBoundedValue((currentValue === "" ? Number(min ?? 0) : currentValue) + direction * numericStep);

  return (
    <FormField label={label} description={description} error={error} hideLabel={hideLabel} required={props.required} controlId={id} className="ui-number-field">
      {(controlProps) => (
        <div className={`ui-field__control ui-number-field__control ${className}`.trim()}>
          <button type="button" aria-label={decrementLabel} disabled={disabled || readOnly || currentValue !== "" && currentValue <= Number(min ?? -Infinity)} onClick={() => nudge(-1)}><Minus aria-hidden="true" /></button>
          <input
            type="number"
            value={currentValue}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            readOnly={readOnly}
            {...controlProps}
            {...props}
            onChange={(event) => setBoundedValue(event.currentTarget.value === "" ? "" : event.currentTarget.valueAsNumber)}
          />
          <button type="button" aria-label={incrementLabel} disabled={disabled || readOnly || currentValue !== "" && currentValue >= Number(max ?? Infinity)} onClick={() => nudge(1)}><Plus aria-hidden="true" /></button>
        </div>
      )}
    </FormField>
  );
}

export interface RangeFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange">, CommonFieldProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  formatValue?: (value: number) => string;
}

export function RangeField({
  label,
  description,
  error,
  hideLabel = false,
  value,
  defaultValue = 0,
  onValueChange,
  formatValue = String,
  min = 0,
  max = 100,
  step = 1,
  className = "",
  id,
  ...props
}: RangeFieldProps) {
  const [currentValue, setCurrentValue] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const percentage = ((currentValue - Number(min)) / Math.max(1, Number(max) - Number(min))) * 100;
  const outputId = useId();
  return (
    <FormField label={label} description={description} error={error} hideLabel={hideLabel} required={props.required} controlId={id} className="ui-range-field">
      {(controlProps) => (
        <div className="ui-range-field__row">
          <input
            type="range"
            className={`ui-range ${className}`.trim()}
            value={currentValue}
            min={min}
            max={max}
            step={step}
            style={{ "--ui-range-progress": `${percentage}%` } as CSSProperties}
            aria-valuetext={String(formatValue(currentValue))}
            aria-describedby={[controlProps["aria-describedby"], outputId].filter(Boolean).join(" ")}
            id={controlProps.id}
            aria-invalid={controlProps["aria-invalid"]}
            {...props}
            onChange={(event) => setCurrentValue(event.currentTarget.valueAsNumber)}
          />
          <output id={outputId} htmlFor={controlProps.id}>{formatValue(currentValue)}</output>
        </div>
      )}
    </FormField>
  );
}
