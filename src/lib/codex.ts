import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

export interface CodexAuthResult {
  available: boolean;
  healthy: boolean;
  authenticated: boolean;
  message: string;
}

export async function getCodexAuthStatus(): Promise<CodexAuthResult> {
  if (!isTauri()) {
    return {
      available: false,
      healthy: false,
      authenticated: false,
      message: "Codex connection is available in the Tauri app.",
    };
  }

  return invoke<CodexAuthResult>("codex_auth_status");
}

export async function startCodexLogin(): Promise<void> {
  if (!isTauri()) {
    throw new Error("Open the Tauri app to connect Codex.");
  }

  await invoke("start_codex_login");
}
