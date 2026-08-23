import { BarChart3, ChevronLeft, ChevronRight, Presentation, Sparkles, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { buildReferenceVideoMarkup } from "../../generation/debug-fixture";
import { useBrowserStore } from "../../store/browser-store";
import { ArtifactSandboxFrame } from "./ArtifactSandboxFrame";

const scenes = [
  { title: "Calm documentary", image: "https://loremflickr.com/960/540/tram,city?lock=7101", className: "is-calm" },
  { title: "Melancholy memory", image: "https://loremflickr.com/960/540/rain,window?lock=7102", className: "is-sad" },
  { title: "Investigative tension", image: "https://loremflickr.com/960/540/night,railway?lock=7103", className: "is-tense" },
];

export function CapabilityLabPage() {
  const [slide, setSlide] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  const settings = useBrowserStore((state) => state.generationSettings);
  const videoDocument = useMemo(() => {
    const video = buildReferenceVideoMarkup({
      imagesEnabled: settings.images.enabled && settings.images.allowExternalRequests,
      narrationEnabled: settings.capabilities.audioSpeechEnabled,
      musicMode: settings.voice.musicMode,
      externalMediaEnabled: settings.capabilities.externalMediaEnabled,
    });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Real media runtime</title><style>*{box-sizing:border-box}body{margin:0;background:#070a10;color:#f6f8fc;font:14px/1.45 Arial,sans-serif}vibe-video{display:block;overflow:hidden;background:radial-gradient(circle at 20% 10%,#24334d,#080b11 55%)}vibe-video>[data-vibe-scene]{padding:36px;display:grid;align-content:center;gap:12px;position:relative}vibe-video>[data-vibe-scene][hidden]{display:none}vibe-video img{display:block;width:100%;height:300px;object-fit:cover;border-radius:12px}vibe-video [data-kind="split"]{grid-template-columns:1.15fr .85fr;align-items:center}h2{margin:0;font-size:clamp(32px,5vw,64px);line-height:1}.video-kicker{color:#9eb2d5;letter-spacing:.16em;text-transform:uppercase}.video-stat{font-size:72px}[data-vibe-narration]{max-width:58ch;color:#d7deeb}[data-vibe-video-caption]{block-size:3.25em;margin:0;padding:8px 16px;overflow:hidden;background:#0c111a;color:#e8edf7}[data-vibe-video-controls]{display:flex;align-items:center;gap:9px;min-block-size:58px;padding:10px 16px;overflow:hidden;background:#111722ee;white-space:nowrap;backdrop-filter:blur(14px)}button{padding:8px 12px;border:1px solid #64748b;border-radius:8px;background:#1f2937;color:white}label{display:flex;align-items:center;gap:8px}input{min-width:72px}.video-seek{flex:1}.video-seek input{width:100%}.video-state-button{inline-size:76px}.video-time{min-inline-size:90px;font-variant-numeric:tabular-nums}.video-volume input{inline-size:90px}@media(max-width:650px){vibe-video [data-kind="split"]{grid-template-columns:1fr}vibe-video>[data-vibe-scene]{padding:22px}.video-volume{display:none}}</style></head><body>${video}</body></html>`;
  }, [settings.capabilities.audioSpeechEnabled, settings.capabilities.externalMediaEnabled, settings.images.allowExternalRequests, settings.images.enabled, settings.voice.musicMode]);
  return (
    <main className="capability-lab">
      <header><span>vibe://capabilities</span><h1>Capability lab</h1><p>Deterministic examples for testing trusted renderers without relying on a particular generated link.</p></header>
      <div className="capability-lab__grid">
        <section className="capability-demo capability-demo--chart"><h2><BarChart3 aria-hidden="true" /> Data chart</h2><svg viewBox="0 0 480 210" role="img" aria-label="Hallunet traffic requests by hour"><path d="M45 15V175H465"/><g><rect x="75" y="111" width="44" height="64"/><rect x="145" y="73" width="44" height="102"/><rect x="215" y="34" width="44" height="141"/><rect x="285" y="91" width="44" height="84"/><rect x="355" y="55" width="44" height="120"/></g><polyline points="97,102 167,64 237,24 307,82 377,46"/><text x="45" y="200">08:00</text><text x="400" y="200">20:00</text></svg><p>Hallunet route activity · deterministic inline data</p></section>
        <section className="capability-demo capability-demo--diagram"><h2><Presentation aria-hidden="true" /> Diagram</h2><div className="lab-diagram"><span>Director</span><i>→</i><span>Builder</span><i>→</i><span>Trusted compiler</span></div><p>Only approved semantic contracts enter the generated page.</p></section>
        <section className="capability-demo capability-demo--motion"><h2><Sparkles aria-hidden="true" /> Motion</h2><div className="lab-motion" key={motionKey}><i className="lab-motion__particle lab-motion__particle--one"/><i className="lab-motion__particle lab-motion__particle--two"/><i className="lab-motion__particle lab-motion__particle--three"/><span>New nodes animate once</span></div><button type="button" onClick={() => setMotionKey((value) => value + 1)}>Replay new element</button><p>Unchanged nodes keep their identity while streaming snapshots arrive.</p></section>
        <section className="capability-demo capability-demo--slideshow"><h2><Presentation aria-hidden="true" /> Slideshow</h2><div className="lab-slideshow"><img src={scenes[slide].image} alt={scenes[slide].title}/><span>{scenes[slide].title}</span><div><button type="button" aria-label="Previous slide" onClick={() => setSlide((value) => (value + scenes.length - 1) % scenes.length)}><ChevronLeft aria-hidden="true" /></button><em>{slide + 1} / {scenes.length}</em><button type="button" aria-label="Next slide" onClick={() => setSlide((value) => (value + 1) % scenes.length)}><ChevronRight aria-hidden="true" /></button></div></div><p>A lightweight gallery without narration, timeline or music.</p></section>
        <section className="capability-demo capability-demo--video"><h2><Volume2 aria-hidden="true" /> Pseudo-video media engine</h2><ArtifactSandboxFrame html={videoDocument} title="Real pseudo-video capability" pageUrl="https://capabilities.vibe.local/video" /><p>The exact same sandbox, bridge v4, narration preparation, MIDI transport, captions and media controls used by generated pages.</p></section>
      </div>
    </main>
  );
}
