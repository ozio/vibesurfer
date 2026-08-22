import { useDynamicRuntime } from "../dynamic/use-dynamic-runtime";
import { useGenerationRuntime } from "../generation/use-generation-runtime";
import { BrowserShell } from "./BrowserShell";

export function BrowserApp() {
  useGenerationRuntime();
  useDynamicRuntime();

  return <BrowserShell />;
}
