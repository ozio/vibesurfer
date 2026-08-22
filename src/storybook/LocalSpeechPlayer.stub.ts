interface LocalSpeechRequest {
  id: string;
  text: string;
  voice: string;
  speed: number;
}

export class SpeechAssetRenderer {
  async render(_request: LocalSpeechRequest): Promise<never> {
    throw new Error("Local speech is not available in the Storybook preview runtime.");
  }

  async play(_request: LocalSpeechRequest): Promise<void> {
    throw new Error("Local speech is not available in the Storybook preview runtime.");
  }

  cancel() {}

  dispose() {}
}
export { SpeechAssetRenderer as LocalSpeechPlayer };
