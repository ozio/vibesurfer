import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, CheckCircle2, CircleOff, FlaskConical, RotateCw } from "lucide-react";
import { compileGeneratedArtifactDocument } from "../../artifacts/document";
import { connectArtifactFrame, type ArtifactFrameConnection } from "../../artifacts/iframe-host";
import { buildGenerationDebugFixture } from "../../generation/debug-fixture";
import {
  GENERATION_CAPABILITY_OPTIONS,
  type UserConfigurableCapabilityId,
} from "../../generation/capability-settings";
import { useBrowserStore } from "../../store/browser-store";

export function GenerationDebugPage() {
  const settings = useBrowserStore((state) => state.generationSettings);
  const animationsEnabled = useBrowserStore((state) => state.preferences.animations);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const artifacts = useBrowserStore((state) => state.artifacts);
  const patchCapabilitySettings = useBrowserStore((state) => state.patchCapabilitySettings);
  const fixture = useMemo(
    () => buildGenerationDebugFixture(settings, animationsEnabled),
    [animationsEnabled, settings],
  );
  const latestArtifact = useMemo(() => Object.values(artifacts)
    .filter((artifact) => !artifact.profileId || artifact.profileId === activeProfileId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0], [activeProfileId, artifacts]);
  const directorPrompt = latestArtifact?.modelExchanges?.find((exchange) => exchange.purpose === "page-director")?.prompt ?? "";
  const builderPrompt = latestArtifact?.modelExchanges?.find((exchange) => exchange.purpose === "page-builder")?.prompt ?? "";
  const manifest = new Map(latestArtifact?.capabilityManifest?.map((entry) => [entry.id, entry]) ?? []);
  const turbo = settings.strategy === "turbo";

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
      </section>

      <section className="generation-debug-matrix" aria-labelledby="generation-debug-matrix-title">
        <header><div><h2 id="generation-debug-matrix-title">Capability contracts</h2><p>Prompt and manifest columns use the latest completed artifact in this profile.</p></div>{latestArtifact && <small>Evidence: {latestArtifact.title}</small>}</header>
        <div className="generation-debug-matrix__table" role="table" aria-label="Generation capability verification">
          <div className="generation-debug-matrix__row is-heading" role="row"><span role="columnheader">Capability</span><span role="columnheader">Setting</span><span role="columnheader">Director</span><span role="columnheader">Builder</span><span role="columnheader">Rendered</span></div>
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
                <span role="cell" className={usage ? "debug-evidence is-yes" : "debug-evidence"}>{usage ? `${usage.instances} × ${usage.execution}` : effective ? "not used" : "disabled"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="generation-debug-render" aria-labelledby="generation-debug-render-title">
        <header><div><h2 id="generation-debug-render-title"><FlaskConical aria-hidden="true" /> Sandbox rendering</h2><p>This is the same opaque-origin MessageChannel surface used by generated artifacts.</p></div><span>{fixture.enabledCapabilities.length} optional capabilities enabled</span></header>
        <DebugArtifactFrame html={fixture.html} allowGeneratedScripts={fixture.allowGeneratedScripts} />
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

function DebugArtifactFrame({ html, allowGeneratedScripts }: { html: string; allowGeneratedScripts: boolean }) {
  const theme = useBrowserStore((state) => state.preferences.theme);
  const voice = useBrowserStore((state) => state.generationSettings.voice);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const document = useMemo(() => compileGeneratedArtifactDocument({
    artifactId: `generation-debug-${crypto.randomUUID()}`,
    url: "https://debug.vibe.local/generation",
    title: "Generation debug fixture",
    html,
    allowGeneratedScripts,
    browserTheme: theme,
    voiceSettings: voice,
  }), [allowGeneratedScripts, html, theme, voice]);
  const frameUrl = `/artifact-frame.html#${new URLSearchParams({ artifactId: document.artifactId, nonce: document.nonce })}`;

  useEffect(() => {
    setStatus("connecting");
    let connection: ArtifactFrameConnection;
    connection = connectArtifactFrame({
      getIframe: () => frameRef.current,
      artifactId: document.artifactId,
      nonce: document.nonce,
      render: document.payload,
      onEvent: (event) => {
        if (event.type === "ready") setStatus("ready");
        if (event.type === "runtime-error") setStatus("error");
        if (event.type === "speech-request") connection.setSpeechState({ requestId: event.requestId, status: "completed" });
      },
      onProtocolError: () => setStatus("error"),
    });
    return () => {
      connection.disconnect();
    };
  }, [document]);

  return (
    <div className={`generation-debug-frame is-${status}`}>
      <div className="generation-debug-frame__status" role="status">{status === "ready" ? "Sandbox ready" : status === "error" ? "Sandbox failed" : "Connecting sandbox…"}{status === "error" && <RotateCw aria-hidden="true" />}</div>
      <iframe key={document.nonce} ref={frameRef} src={frameUrl} title="Generation capability rendering fixture" sandbox="allow-scripts" scrolling="auto" />
    </div>
  );
}
