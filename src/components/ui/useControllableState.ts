import { useState } from "react";

export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const currentValue = value === undefined ? uncontrolledValue : value;

  const setValue = (nextValue: T) => {
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.(nextValue);
  };

  return [currentValue, setValue] as const;
}
