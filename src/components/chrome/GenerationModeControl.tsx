import { Layers3, Zap } from "lucide-react";
import { useBrowserStore } from "../../store/browser-store";

export function GenerationModeControl() {
  const strategy = useBrowserStore((state) => state.generationSettings.strategy);
  const patchGenerationSettings = useBrowserStore((state) => state.patchGenerationSettings);
  const turbo = strategy === "turbo";
  const label = turbo ? "Turbo" : "Full";

  return (
    <button
      className={`generation-mode-pill${turbo ? " is-turbo" : ""}`}
      type="button"
      aria-label={`Generation mode: ${label}. Click to use ${turbo ? "Full" : "Turbo"} mode.`}
      aria-pressed={turbo}
      title={turbo
        ? "Turbo: one short HTML request, 4K output cap, static host-sanitized page"
        : "Full: Director → Builder with the complete capability system"}
      onClick={() => patchGenerationSettings({ strategy: turbo ? "full" : "turbo" })}
    >
      {turbo ? <Zap aria-hidden="true" /> : <Layers3 aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
