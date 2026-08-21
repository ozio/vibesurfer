import { BarChart3, Captions, ChevronLeft, ChevronRight, Pause, Play, Presentation, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

const scenes = [
  { title: "Calm documentary", image: "https://loremflickr.com/960/540/tram,city?lock=7101", className: "is-calm" },
  { title: "Melancholy memory", image: "https://loremflickr.com/960/540/rain,window?lock=7102", className: "is-sad" },
  { title: "Investigative tension", image: "https://loremflickr.com/960/540/night,railway?lock=7103", className: "is-tense" },
];

export function CapabilityLabPage() {
  const [playing, setPlaying] = useState(false);
  const [scene, setScene] = useState(0);
  const [slide, setSlide] = useState(0);
  const [motionKey, setMotionKey] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setScene((value) => (value + 1) % scenes.length), 3_000);
    return () => window.clearInterval(timer);
  }, [playing]);
  const current = scenes[scene];
  return (
    <main className="capability-lab">
      <header><span>vibe://capabilities</span><h1>Capability lab</h1><p>Deterministic examples for testing trusted renderers without relying on a particular generated link.</p></header>
      <div className="capability-lab__grid">
        <section className="capability-demo capability-demo--chart"><h2><BarChart3 aria-hidden="true" /> Data chart</h2><svg viewBox="0 0 480 210" role="img" aria-label="Hallunet traffic requests by hour"><path d="M45 15V175H465"/><g><rect x="75" y="111" width="44" height="64"/><rect x="145" y="73" width="44" height="102"/><rect x="215" y="34" width="44" height="141"/><rect x="285" y="91" width="44" height="84"/><rect x="355" y="55" width="44" height="120"/></g><polyline points="97,102 167,64 237,24 307,82 377,46"/><text x="45" y="200">08:00</text><text x="400" y="200">20:00</text></svg><p>Hallunet route activity · deterministic inline data</p></section>
        <section className="capability-demo capability-demo--diagram"><h2><Presentation aria-hidden="true" /> Diagram</h2><div className="lab-diagram"><span>Director</span><i>→</i><span>Builder</span><i>→</i><span>Trusted compiler</span></div><p>Only approved semantic contracts enter the generated page.</p></section>
        <section className="capability-demo capability-demo--motion"><h2><Sparkles aria-hidden="true" /> Motion</h2><div className="lab-motion" key={motionKey}><i/><i/><i/><span>New nodes animate once</span></div><button type="button" onClick={() => setMotionKey((value) => value + 1)}>Replay new element</button><p>Unchanged nodes keep their identity while streaming snapshots arrive.</p></section>
        <section className="capability-demo capability-demo--slideshow"><h2><Presentation aria-hidden="true" /> Slideshow</h2><div className="lab-slideshow"><img src={scenes[slide].image} alt={scenes[slide].title}/><span>{scenes[slide].title}</span><div><button type="button" aria-label="Previous slide" onClick={() => setSlide((value) => (value + scenes.length - 1) % scenes.length)}><ChevronLeft aria-hidden="true" /></button><em>{slide + 1} / {scenes.length}</em><button type="button" aria-label="Next slide" onClick={() => setSlide((value) => (value + 1) % scenes.length)}><ChevronRight aria-hidden="true" /></button></div></div><p>A lightweight gallery without narration, timeline or music.</p></section>
        <section className="capability-demo capability-demo--video"><h2><Volume2 aria-hidden="true" /> Pseudo-video</h2><div className={`lab-video ${current.className}`}><img src={current.image} alt="Capability demonstration scene"/><span>{current.title}</span><div><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? "Pause" : "Play"}</button><i><b style={{ width: `${((scene + 1) / scenes.length) * 100}%` }}/></i><em>{scene + 1} / {scenes.length}</em></div></div><p><Captions aria-hidden="true" /> Scene captions, pauses and changing music presets are controlled by the trusted runtime.</p></section>
      </div>
    </main>
  );
}
