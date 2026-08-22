import type { ArtifactFrameConnection } from "../artifacts/iframe-host";
import type { ArtifactMediaCommandEvent, ArtifactMediaPrepareEvent } from "../artifacts/bridge-protocol";
import type { VoiceAudioSettings } from "../types/browser";
import { VideoMediaSession } from "./video-media-session";

export interface FrameMediaControllerOptions {
  profileId: string;
  voice: VoiceAudioSettings;
  narrationEnabled: boolean;
  externalMediaEnabled: boolean;
  getConnection: () => ArtifactFrameConnection | undefined;
}

export class FrameMediaController {
  readonly #options: FrameMediaControllerOptions;
  #session?: VideoMediaSession;
  #videoId = "";

  constructor(options: FrameMediaControllerOptions) {
    this.#options = options;
  }

  handle(event: ArtifactMediaPrepareEvent | ArtifactMediaCommandEvent): void {
    if (event.type === "media-prepare") {
      this.#session?.dispose();
      this.#videoId = event.plan.videoId;
      this.#session = new VideoMediaSession({
        profileId: this.#options.profileId,
        voice: this.#options.voice,
        permissions: {
          narrationEnabled: this.#options.narrationEnabled,
          externalMediaEnabled: this.#options.externalMediaEnabled,
        },
        onTimeline: (requestId, timeline) => this.#options.getConnection()?.setMediaTimeline(requestId, timeline),
        onState: (state) => this.#options.getConnection()?.setMediaState(state),
      });
      void this.#session.prepare(event.requestId, event.plan).catch((error: unknown) => {
        this.#options.getConnection()?.setMediaState({
          videoId: event.plan.videoId,
          status: "error",
          currentTimeMs: 0,
          durationMs: 0,
          paused: true,
          muted: false,
          volume: 1,
          activeSceneIndex: 0,
          message: error instanceof Error ? error.message : "Video preparation failed.",
        });
      });
      return;
    }
    if (!this.#session || event.videoId !== this.#videoId) return;
    if (event.action === "play") void this.#session.play().catch(() => undefined);
    else if (event.action === "pause") this.#session.pause();
    else if (event.action === "stop") this.#session.stop();
    else if (event.action === "seek" && event.currentTimeMs !== undefined) this.#session.seek(event.currentTimeMs);
    else if (event.action === "set-volume" && event.volume !== undefined) this.#session.setVolume(event.volume);
    else if (event.action === "set-muted" && event.muted !== undefined) this.#session.setMuted(event.muted);
    else if (event.action === "skip-music") void this.#session.skipMusic().catch(() => undefined);
  }

  dispose(): void {
    this.#session?.dispose();
    this.#session = undefined;
    this.#videoId = "";
  }
}
