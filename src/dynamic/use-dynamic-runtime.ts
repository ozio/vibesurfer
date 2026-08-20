import { useEffect } from "react";

import { startDynamicRuntime } from "./runtime";

export function useDynamicRuntime(): void {
  useEffect(() => startDynamicRuntime(), []);
}
