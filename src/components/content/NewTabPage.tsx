import { FormEvent, useMemo, useState } from "react";
import { ArrowUp, Command, Layers3, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { motion } from "motion/react";
import { modelCatalog } from "../../data/catalog";
import { useBrowserStore } from "../../store/browser-store";

const starters = [
  "A field guide for tonight’s ideas",
  "A calm dashboard for planning a trip",
  "Compare three ways to learn something new",
];

export function NewTabPage() {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const navigate = useBrowserStore((state) => state.navigate);
  const [prompt, setPrompt] = useState("");
  const model = useMemo(() => {
    const models = modelCatalog(providerConnections, activeProfileId);
    return models.find((item) => item.id === activeModelId) ?? models[0];
  }, [activeModelId, activeProfileId, providerConnections]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (prompt.trim()) navigate(activeTabId, prompt);
  };

  return (
    <motion.section className="new-tab-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
      <div className="new-tab-page__aura" aria-hidden="true" />
      <div className="new-tab-page__content">
        <motion.div className="new-tab-page__mark" initial={{ scale: 0.92 }} animate={{ scale: 1 }}>
          <Sparkles aria-hidden="true" />
        </motion.div>
        <p className="new-tab-page__eyebrow">A model-native browser</p>
        <h1>The web, shaped<br />around an idea.</h1>
        <p className="new-tab-page__lede">Open an address, or describe the interface you wish existed.</p>
        <form className="generation-composer" onSubmit={submit}>
          <WandSparkles aria-hidden="true" />
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe a page, tool, or place to explore…"
            aria-label="Describe a page to generate"
          />
          <button type="button" className="generation-composer__model" onClick={() => window.dispatchEvent(new Event("vibesurfer:open-model-picker"))}>
            {model.name}
          </button>
          <button className="generation-composer__submit" type="submit" aria-label="Create page" disabled={!prompt.trim()}>
            <ArrowUp aria-hidden="true" />
          </button>
        </form>
        <div className="prompt-starters" aria-label="Prompt suggestions">
          {starters.map((starter) => (
            <button key={starter} type="button" onClick={() => navigate(activeTabId, starter)}>{starter}</button>
          ))}
        </div>
      </div>
      <div className="new-tab-page__principles">
        <span><Layers3 aria-hidden="true" /> Generated and traditional tabs</span>
        <span><ShieldCheck aria-hidden="true" /> Sandboxed artifacts</span>
        <span><Command aria-hidden="true" /> <kbd>⌘L</kbd> goes anywhere</span>
      </div>
    </motion.section>
  );
}
