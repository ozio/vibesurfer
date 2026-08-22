import type { BrowserCommandId } from "../../browser/browser-command-registry";

export interface BrowserControlAction {
  id: BrowserCommandId;
  label: string;
  enabled: boolean;
  checked?: boolean;
  shortcut?: string;
  onExecute: () => void;
}

export function browserControlAction(command: {
  id: BrowserCommandId;
  label: string;
  enabled: boolean;
  checked?: boolean;
  shortcut?: string;
  execute: () => void;
}): BrowserControlAction {
  return {
    id: command.id,
    label: command.label,
    enabled: command.enabled,
    checked: command.checked,
    shortcut: command.shortcut,
    onExecute: command.execute,
  };
}
