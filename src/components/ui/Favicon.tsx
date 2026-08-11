import { useEffect, useState } from "react";
import { Globe2, Sparkles } from "lucide-react";

interface FaviconProps {
  source?: string;
  title: string;
  generated?: boolean;
}

export function Favicon({ source, title, generated }: FaviconProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  if (source?.startsWith("data:image/") && !failed) {
    return <img className="favicon" src={source} alt="" width="16" height="16" onError={() => setFailed(true)} />;
  }

  if (source && source !== "✦" && source.length <= 4) {
    return <span className="favicon favicon--letter">{source}</span>;
  }

  if (generated || source === "✦") {
    return <Sparkles className="favicon favicon--icon" aria-hidden="true" />;
  }

  return title ? (
    <span className="favicon favicon--letter">{title.slice(0, 1).toUpperCase()}</span>
  ) : (
    <Globe2 className="favicon favicon--icon" aria-hidden="true" />
  );
}
