import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { compileGeneratedArtifactDocument } from "../../artifacts/document";
import { connectArtifactFrame, type ArtifactFrameConnection } from "../../artifacts/iframe-host";
import { FrameMediaController } from "../../media/frame-media-controller";
import { useBrowserStore } from "../../store/browser-store";

export function ArtifactSandboxFrame({
  html,
  allowGeneratedScripts = false,
  title = "Artifact sandbox fixture",
  pageUrl = "https://debug.vibe.local/fixture",
  onStatusChange,
}: {
  html: string;
  allowGeneratedScripts?: boolean;
  title?: string;
  pageUrl?: string;
  onStatusChange?: (status: "connecting" | "ready" | "error") => void;
}) {
  const theme = useBrowserStore((state) => state.preferences.theme);
  const settings = useBrowserStore((state) => state.generationSettings);
  const profileId = useBrowserStore((state) => state.activeProfileId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const document = useMemo(() => compileGeneratedArtifactDocument({
    artifactId: `sandbox-fixture-${crypto.randomUUID()}`,
    url: pageUrl,
    title,
    html,
    allowGeneratedScripts,
    browserTheme: theme,
    voiceSettings: settings.voice,
    mediaPermissions: {
      narrationEnabled: settings.capabilities.audioSpeechEnabled,
      externalMediaEnabled: settings.capabilities.externalMediaEnabled,
    },
  }), [allowGeneratedScripts, html, pageUrl, settings.capabilities.audioSpeechEnabled, settings.capabilities.externalMediaEnabled, settings.voice, theme, title]);
  const frameUrl = `/artifact-frame.html#${new URLSearchParams({ artifactId: document.artifactId, nonce: document.nonce })}`;

  useEffect(() => onStatusChange?.(status), [onStatusChange, status]);

  useEffect(() => {
    setStatus("connecting");
    let connection: ArtifactFrameConnection | undefined;
    let media: FrameMediaController | undefined;
    connection = connectArtifactFrame({
      getIframe: () => frameRef.current,
      artifactId: document.artifactId,
      nonce: document.nonce,
      render: document.payload,
      onEvent: (event) => {
        if (event.type === "ready") setStatus("ready");
        if (event.type === "runtime-error") setStatus("error");
        if (event.type === "speech-request") connection?.setSpeechState({ requestId: event.requestId, status: "completed" });
        if (event.type === "media-prepare" || event.type === "media-command") media?.handle(event);
      },
      onProtocolError: () => setStatus("error"),
    });
    media = new FrameMediaController({
      profileId,
      voice: settings.voice,
      narrationEnabled: settings.capabilities.audioSpeechEnabled,
      externalMediaEnabled: settings.capabilities.externalMediaEnabled,
      getConnection: () => connection,
    });
    return () => {
      media?.dispose();
      connection?.disconnect();
    };
  }, [document, profileId, settings.capabilities.audioSpeechEnabled, settings.capabilities.externalMediaEnabled, settings.voice]);

  return (
    <div className={`generation-debug-frame is-${status}`}>
      <div className="generation-debug-frame__status" role="status">{status === "ready" ? "Sandbox ready" : status === "error" ? "Sandbox failed" : "Connecting sandbox…"}{status === "error" && <RotateCw aria-hidden="true" />}</div>
      <iframe
        key={document.nonce}
        ref={frameRef}
        src={frameUrl}
        title={title}
        sandbox="allow-scripts"
        scrolling="auto"
        allowFullScreen
      />
    </div>
  );
}
