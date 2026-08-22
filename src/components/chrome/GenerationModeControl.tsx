import { Layers3, Zap } from "lucide-react";
import { useBrowserStore } from "../../store/browser-store";
import type { GenerationStrategy } from "../../types/browser";

export interface GenerationModeControlProps {
  strategy: GenerationStrategy;
  onStrategyChange: (strategy: GenerationStrategy) => void;
  disabled?: boolean;
  className?: string;
}

export function GenerationModeControl({
  strategy,
  onStrategyChange,
  disabled = false,
  className = "",
}: GenerationModeControlProps) {
  const turbo = strategy === "turbo";
  const label = turbo ? "Turbo" : "Full";

  return (
    <button
      className={`generation-mode-pill${turbo ? " is-turbo" : ""} ${className}`.trim()}
      type="button"
      aria-label={`Generation mode: ${label}. Click to use ${turbo ? "Full" : "Turbo"} mode.`}
      aria-pressed={turbo}
      data-generation-strategy={strategy}
      disabled={disabled}
      title={turbo
        ? "Turbo: one short HTML request, 4K output cap, static host-sanitized page"
        : "Full: Director → Builder with the complete capability system"}
      onClick={() => onStrategyChange(turbo ? "full" : "turbo")}
    >
      {turbo ? <Zap aria-hidden="true" /> : <Layers3 aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}

export function ConnectedGenerationModeControl() {
  const strategy = useBrowserStore((state) => state.generationSettings.strategy);
  const patchGenerationSettings = useBrowserStore((state) => state.patchGenerationSettings);
  return (
    <GenerationModeControl
      strategy={strategy}
      onStrategyChange={(nextStrategy) => patchGenerationSettings({ strategy: nextStrategy })}
    />
  );
}
