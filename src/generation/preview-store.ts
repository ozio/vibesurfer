import { create } from "zustand";

export interface GenerationPreviewFrame {
  html: string;
  revision: number;
}

interface GenerationPreviewState {
  previews: Record<string, GenerationPreviewFrame>;
  setPreview: (jobId: string, html: string, revision?: number) => void;
  clearPreview: (jobId: string) => void;
}

export const useGenerationPreviewStore = create<GenerationPreviewState>()((set, get) => ({
  previews: {},
  setPreview: (jobId, html, revision) => {
    const current = get().previews[jobId];
    const nextRevision = revision ?? (current?.revision ?? 0) + 1;
    if (current && nextRevision <= current.revision) return;
    set((state) => ({
      previews: {
        ...state.previews,
        [jobId]: { html, revision: nextRevision },
      },
    }));
  },
  clearPreview: (jobId) => set((state) => {
    if (!state.previews[jobId]) return state;
    const previews = { ...state.previews };
    delete previews[jobId];
    return { previews };
  }),
}));

export function setGenerationPreviewFrame(jobId: string, html: string, revision?: number): void {
  useGenerationPreviewStore.getState().setPreview(jobId, html, revision);
}

export function clearGenerationPreviewFrame(jobId: string): void {
  useGenerationPreviewStore.getState().clearPreview(jobId);
}

export function resetGenerationPreviews(): void {
  useGenerationPreviewStore.setState({ previews: {} });
}
