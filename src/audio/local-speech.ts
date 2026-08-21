interface LocalSpeechRequest { id: string; text: string; voice: string; speed: number }

export class LocalSpeechPlayer {
  #worker?: Worker;
  #audio?: HTMLAudioElement;
  #pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  #cache = new Map<string, Blob>();
  #activeId?: string;

  async play(request: LocalSpeechRequest): Promise<void> {
    this.cancel();
    this.#activeId = request.id;
    const key = await speechCacheKey(request);
    let blob = this.#cache.get(key);
    if (!blob) {
      blob = await this.#generate(request);
      if (this.#activeId !== request.id) throw new DOMException("Speech cancelled", "AbortError");
      this.#cache.set(key, blob);
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.#audio = audio;
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("Local speech playback failed.")), { once: true });
      void audio.play().catch(reject);
    }).finally(() => {
      URL.revokeObjectURL(url);
      if (this.#audio === audio) this.#audio = undefined;
      if (this.#activeId === request.id) this.#activeId = undefined;
    });
  }

  cancel() {
    this.#activeId = undefined;
    if (this.#audio) {
      this.#audio.pause();
      this.#audio.src = "";
      this.#audio = undefined;
    }
    for (const pending of this.#pending.values()) pending.reject(new DOMException("Speech cancelled", "AbortError"));
    this.#pending.clear();
  }

  dispose() {
    this.cancel();
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  #generate(request: LocalSpeechRequest): Promise<Blob> {
    const worker = this.#worker ??= this.#createWorker();
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve: () => undefined, reject });
      const onMessage = (event: MessageEvent<{ id: string; ok: boolean; buffer?: ArrayBuffer; error?: string }>) => {
        if (event.data.id !== request.id) return;
        worker.removeEventListener("message", onMessage);
        this.#pending.delete(request.id);
        if (event.data.ok && event.data.buffer) resolve(new Blob([event.data.buffer], { type: "audio/wav" }));
        else reject(new Error(event.data.error ?? "Local speech generation failed."));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage(request);
    });
  }

  #createWorker() {
    return new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module", name: "vibesurfer-kokoro" });
  }
}

async function speechCacheKey(request: Omit<LocalSpeechRequest, "id">) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
