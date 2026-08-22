import { useEffect, useState } from "react";
import { Activity, Bug, FlaskConical, Globe2, History, Settings, Sparkles } from "lucide-react";
import { deterministicGlyphFavicon, isHostOwnedFaviconImage } from "../../lib/favicon";
import type { FaviconSource, GlyphFavicon } from "../../types/browser";

interface FaviconProps {
  source?: FaviconSource;
  title: string;
  generated?: boolean;
  seed?: string;
}

export function Favicon({ source, title, generated, seed }: FaviconProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  if (typeof source === "object" && source.kind === "glyph") {
    return <GlyphTile descriptor={source} />;
  }


  if (typeof source === "object" && source.kind === "system") {
    const Icon = {
      "new-tab": Sparkles,
      settings: Settings,
      history: History,
      activity: Activity,
      capabilities: FlaskConical,
      "generation-debug": Bug,
    }[source.icon];
    return <Icon className="favicon favicon--icon favicon--system" aria-hidden="true" />;
  }

  const imageSource = typeof source === "object" && source.kind === "image" ? source.src : source;
  if (typeof imageSource === "string" && isHostOwnedFaviconImage(imageSource) && !failed) {
    return <img className="favicon" src={imageSource} alt="" width="16" height="16" onError={() => setFailed(true)} />;
  }

  if (typeof source === "string" && source && source !== "✦" && [...source].length <= 4) {
    return <GlyphTile descriptor={deterministicGlyphFavicon(seed ?? title, source)} />;
  }

  if (generated || source === "✦") {
    return <Sparkles className="favicon favicon--icon" aria-hidden="true" />;
  }

  return title ? (
    <GlyphTile descriptor={deterministicGlyphFavicon(seed ?? title, title.slice(0, 1).toUpperCase())} />
  ) : (
    <Globe2 className="favicon favicon--icon" aria-hidden="true" />
  );
}

function GlyphTile({ descriptor }: { descriptor: GlyphFavicon }) {
  return (
    <span
      className={`favicon favicon--letter favicon--${descriptor.shape}`}
      style={{ color: descriptor.foreground, backgroundColor: descriptor.background }}
      aria-hidden="true"
    >
      {descriptor.glyph}
    </span>
  );
}
