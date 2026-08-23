import { useMemo, useState } from "react";
import { Bug, CheckCircle2, CircleOff, FlaskConical } from "lucide-react";
import { buildGenerationDebugFixture } from "../../generation/debug-fixture";
import {
  GENERATION_CAPABILITY_OPTIONS,
  type UserConfigurableCapabilityId,
} from "../../generation/capability-settings";
import { useBrowserStore } from "../../store/browser-store";
import { ArtifactSandboxFrame } from "./ArtifactSandboxFrame";

export function GenerationDebugPage() {
  const settings = useBrowserStore((state) => state.generationSettings);
  const animationsEnabled = useBrowserStore((state) => state.preferences.animations);
  const latestArtifactId = useBrowserStore((state) => Object.values(state.artifacts)
    .filter((artifact) => !artifact.profileId || artifact.profileId === state.activeProfileId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id);
  const latestArtifact = useBrowserStore((state) => latestArtifactId ? state.artifacts[latestArtifactId] : undefined);
  const patchCapabilitySettings = useBrowserStore((state) => state.patchCapabilitySettings);
  const [sandboxStatus, setSandboxStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const fixture = useMemo(
    () => buildGenerationDebugFixture(settings, animationsEnabled),
    [animationsEnabled, settings],
  );
  const directorPrompt = latestArtifact?.modelExchanges?.find((exchange) => exchange.purpose === "page-director")?.prompt ?? "";
  const builderPrompt = latestArtifact?.modelExchanges?.find((exchange) => exchange.purpose === "page-builder")?.prompt ?? "";
  const manifest = new Map(latestArtifact?.capabilityManifest?.map((entry) => [entry.id, entry]) ?? []);
  const compiledHtml = latestArtifact?.html ?? "";
  const turbo = settings.strategy === "turbo";
  const externalMediaReady = settings.capabilities.externalMediaEnabled
    && settings.voice.provider === "elevenlabs"
    && Boolean(settings.voice.mediaConnectionId)
    && settings.voice.availableVoiceIds.length > 0;

  const toggleCapability = (id: UserConfigurableCapabilityId, enabled: boolean) => {
    const needsAudio = id === "speech" || id === "sound";
    patchCapabilitySettings({
      ...(needsAudio && enabled ? { audioSpeechEnabled: true } : {}),
      enabled: { ...settings.capabilities.enabled, [id]: enabled },
    });
  };

  return (
    <main className="generation-debug-page">
      <header className="generation-debug-page__header">
        <span><Bug aria-hidden="true" /> vibe://generation-debug</span>
        <h1>Generation debug</h1>
        <p>Settings, real prompt evidence from the latest artifact, compiler manifest usage, and a production sandbox rendering fixture.</p>
      </header>

      <section className={`generation-debug-mode${turbo ? " is-turbo" : ""}`} aria-label="Current generation mode">
        <strong>{turbo ? "Turbo mode" : "Full mode"}</strong>
        <span>{turbo
          ? "Optional enrichment is intentionally bypassed and the fixture mirrors the static compact contract."
          : "Each enabled feature may be advertised to the Director and compiled only when selected."}</span>
      </section>

      <section className="generation-debug-summary" aria-label="Pipeline switches">
        <DebugSummary label="LoremFlickr" enabled={!turbo && settings.images.enabled && settings.images.allowExternalRequests} />
        <DebugSummary label="Icon library" enabled={!turbo && settings.capabilities.iconsEnabled} />
        <DebugSummary label="Tailwind" enabled={!turbo && settings.style.tailwindEnabled} />
        <DebugSummary label="Generated JavaScript" enabled={!turbo && settings.style.allowGeneratedScripts} />
        <DebugSummary label="Dynamic regions" enabled={!turbo && settings.dynamicMode !== "off"} />
        <DebugSummary label="Pseudo-video" enabled={!turbo && settings.capabilities.enabled["pseudo-video"] !== false} />
        <DebugSummary label="Narration" enabled={!turbo && settings.capabilities.audioSpeechEnabled} />
        <DebugSummary label={`Music: ${settings.voice.musicMode}`} enabled={!turbo && settings.voice.musicMode !== "off"} />
        <DebugSummary label="External media" enabled={!turbo && externalMediaReady} />
      </section>

      <section className="generation-debug-matrix" aria-labelledby="generation-debug-matrix-title">
        <header><div><h2 id="generation-debug-matrix-title">Capability contracts</h2><p>Director, Builder and compiled columns use the latest artifact; rendered state comes from the live reference sandbox below.</p></div>{latestArtifact && <small>Evidence: {latestArtifact.title}</small>}</header>
        <div className="generation-debug-matrix__table" role="table" aria-label="Generation capability verification">
          <div className="generation-debug-matrix__row is-heading" role="row"><span role="columnheader">Capability</span><span role="columnheader">Setting</span><span role="columnheader">Director</span><span role="columnheader">Builder</span><span role="columnheader">Compiled markup</span><span role="columnheader">Rendered state</span></div>
          {GENERATION_CAPABILITY_OPTIONS.map((option) => {
            const audioAvailable = option.id !== "speech" && option.id !== "sound" || settings.capabilities.audioSpeechEnabled;
            const configured = settings.capabilities.enabled[option.id] !== false && audioAvailable;
            const effective = !turbo && configured && (option.id !== "motion-presets" || animationsEnabled);
            const usage = manifest.get(option.id);
            return (
              <div className="generation-debug-matrix__row" role="row" key={option.id} data-capability-id={option.id}>
                <span role="cell"><strong>{option.title}</strong><code>{option.id}</code></span>
                <span role="cell"><button className={`debug-state-button${configured ? " is-on" : ""}`} type="button" aria-pressed={configured} onClick={() => toggleCapability(option.id, !configured)}>{configured ? "On" : "Off"}</button></span>
                <EvidenceState value={!latestArtifact ? "pending" : directorPrompt.includes(`\"${option.id}\"`) ? "yes" : "no"} />
                <EvidenceState value={!latestArtifact ? "pending" : builderPrompt.includes(`${option.id}:`) ? "yes" : "no"} />
                <span role="cell" className={usage || compiledCapabilityPresent(option.id, compiledHtml) ? "debug-evidence is-yes" : "debug-evidence"}>{usage ? `${usage.instances} × ${usage.execution}` : compiledCapabilityPresent(option.id, compiledHtml) ? "present" : effective ? "not used" : "disabled"}</span>
                <span role="cell" className={`debug-evidence is-${sandboxStatus === "ready" && fixture.enabledCapabilities.includes(option.id) ? "yes" : sandboxStatus === "error" ? "no" : "pending"}`}>{!effective ? "disabled" : sandboxStatus === "ready" ? fixture.enabledCapabilities.includes(option.id) ? "live" : "not in fixture" : sandboxStatus}</span>
              </div>
            );
          })}
          <MediaLayerRow id="video-narration" title="Video narration" setting={settings.capabilities.audioSpeechEnabled ? "On" : "Off"} latestArtifact={Boolean(latestArtifact)} director={directorPrompt.includes('"narration": "disabled"') ? "no" : directorPrompt.includes('"narration"') ? "yes" : "no"} builder={builderPrompt.includes("data-vibe-narration") ? "yes" : "no"} compiled={compiledHtml.includes("data-vibe-narration") ? "yes" : "no"} rendered={sandboxStatus === "ready" ? settings.capabilities.audioSpeechEnabled ? "yes" : "no" : sandboxStatus === "error" ? "no" : "pending"} />
          <MediaLayerRow id="video-music" title="Background music" setting={settings.voice.musicMode} latestArtifact={Boolean(latestArtifact)} director={directorPrompt.includes('"backgroundMusic"') ? "yes" : "no"} builder={builderPrompt.includes("data-music-track") ? "yes" : "no"} compiled={/data-music-track="(?!silence)/.test(compiledHtml) ? "yes" : "no"} rendered={sandboxStatus === "ready" ? settings.voice.musicMode !== "off" ? "yes" : "no" : sandboxStatus === "error" ? "no" : "pending"} />
          <MediaLayerRow id="external-media" title="External media" setting={externalMediaReady ? "On" : "Off"} latestArtifact={Boolean(latestArtifact)} director={directorPrompt.includes('"externalMedia": "enabled-with-verified-connection"') ? "yes" : "no"} builder={builderPrompt.includes("data-music-intent on") ? "yes" : "no"} compiled={compiledHtml.includes("data-music-intent") ? "yes" : "no"} rendered={sandboxStatus === "ready" ? externalMediaReady ? "yes" : "no" : sandboxStatus === "error" ? "no" : "pending"} />
        </div>
      </section>

      <section className="generation-debug-render" aria-labelledby="generation-debug-render-title">
        <header><div><h2 id="generation-debug-render-title"><FlaskConical aria-hidden="true" /> Sandbox rendering</h2><p>This is the same opaque-origin MessageChannel surface used by generated artifacts.</p></div><span>{fixture.enabledCapabilities.length} optional capabilities enabled</span></header>
        <ArtifactSandboxFrame html={fixture.html} allowGeneratedScripts={fixture.allowGeneratedScripts} title="Generation capability rendering fixture" pageUrl="https://debug.vibe.local/generation" onStatusChange={setSandboxStatus} />
      </section>
    </main>
  );
}

function DebugSummary({ label, enabled }: { label: string; enabled: boolean }) {
  return <article className={enabled ? "is-enabled" : ""}>{enabled ? <CheckCircle2 aria-hidden="true" /> : <CircleOff aria-hidden="true" />}<span><strong>{label}</strong><small>{enabled ? "Enabled" : "Disabled"}</small></span></article>;
}

function EvidenceState({ value }: { value: "yes" | "no" | "pending" }) {
  return <span role="cell" className={`debug-evidence is-${value}`}>{value === "yes" ? "present" : value === "no" ? "absent" : "pending"}</span>;
}

function MediaLayerRow({ id, title, setting, latestArtifact, director, builder, compiled, rendered }: {
  id: string;
  title: string;
  setting: string;
  latestArtifact: boolean;
  director: "yes" | "no";
  builder: "yes" | "no";
  compiled: "yes" | "no";
  rendered: "yes" | "no" | "pending";
}) {
  return <div className="generation-debug-matrix__row" role="row" data-capability-id={id}>
    <span role="cell"><strong>{title}</strong><code>{id}</code></span>
    <span role="cell" className="debug-evidence">{setting}</span>
    <EvidenceState value={latestArtifact ? director : "pending"} />
    <EvidenceState value={latestArtifact ? builder : "pending"} />
    <EvidenceState value={latestArtifact ? compiled : "pending"} />
    <EvidenceState value={rendered} />
  </div>;
}

function compiledCapabilityPresent(id: UserConfigurableCapabilityId, html: string): boolean {
  const markers: Partial<Record<UserConfigurableCapabilityId, string>> = {
    "pattern-background": "data-vibe-pattern",
    "motion-presets": "data-vibe-motion",
    "math": "data-vibe-capability=\"math\"",
    "code-highlight": "data-vibe-highlighted",
    "micro-widgets": "data-vibe-widget",
    carousel: "data-vibe-carousel",
    slideshow: "data-vibe-slideshow",
    "pseudo-video": "<vibe-video",
    speech: "data-vibe-speak",
    sound: "data-vibe-sound",
  };
  return html.includes(markers[id] ?? `data-vibe-capability=\"${id}\"`);
}
