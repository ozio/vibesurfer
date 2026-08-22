import type { FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CircleDot,
  Compass,
  Radio,
  Search,
  Sparkles,
  Terminal,
  Waves,
} from "lucide-react";
import { motion } from "motion/react";
import type {
  BrowserExperienceDefinition,
  BrowserPortalIcon,
  BrowserPortalRoute,
} from "../../browser/browser-experience-registry";

const PORTAL_ICONS = {
  compass: Compass,
  waves: Waves,
  search: Search,
  terminal: Terminal,
} as const;

export type NewTabLuckyStatus = "idle" | "busy" | "failed" | "empty";

export interface NewTabCopy {
  luckyIdle: string;
  luckyBusy: string;
  luckyRetry: string;
  openActivity: string;
  failedFallback: string;
  emptyFallback: string;
}

export const DEFAULT_NEW_TAB_COPY: NewTabCopy = {
  luckyIdle: "I’m Feeling Lucky",
  luckyBusy: "Finding a route…",
  luckyRetry: "Try again",
  openActivity: "Open activity",
  failedFallback: "A route could not be found.",
  emptyFallback: "No safe destinations were returned this time.",
};

export interface NewTabComposerProps {
  icon: BrowserPortalIcon;
  value: string;
  placeholder: string;
  inputLabel: string;
  luckyStatus: NewTabLuckyStatus;
  copy?: NewTabCopy;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onLucky: () => void;
}

export function NewTabComposer({
  icon,
  value,
  placeholder,
  inputLabel,
  luckyStatus,
  copy = DEFAULT_NEW_TAB_COPY,
  onValueChange,
  onSubmit,
  onLucky,
}: NewTabComposerProps) {
  const PortalIcon = PORTAL_ICONS[icon];
  const busy = luckyStatus === "busy";
  const luckyLabel = busy
    ? copy.luckyBusy
    : luckyStatus === "failed" || luckyStatus === "empty"
      ? copy.luckyRetry
      : copy.luckyIdle;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = value.trim();
    if (input) onSubmit(input);
  };

  return (
    <form className="generation-composer" onSubmit={submit}>
      <PortalIcon aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={inputLabel}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button className="generation-composer__lucky" type="button" onClick={onLucky} disabled={busy}>
        <Sparkles aria-hidden="true" />
        <span>{luckyLabel}</span>
      </button>
      <button className="generation-composer__submit" type="submit" aria-label="Open address" disabled={!value.trim()}>
        <ArrowRight aria-hidden="true" />
      </button>
    </form>
  );
}

export interface NewTabLuckyOutcomeProps {
  status: NewTabLuckyStatus;
  message?: string;
  copy?: NewTabCopy;
  onOpenActivity: () => void;
}

export function NewTabLuckyOutcome({
  status,
  message,
  copy = DEFAULT_NEW_TAB_COPY,
  onOpenActivity,
}: NewTabLuckyOutcomeProps) {
  if (status !== "failed" && status !== "empty") return null;
  return (
    <div className="lucky-outcome" role="status">
      <span>{message ?? (status === "failed" ? copy.failedFallback : copy.emptyFallback)}</span>
      <button type="button" onClick={onOpenActivity}>{copy.openActivity}</button>
    </div>
  );
}

export interface NewTabRouteCardProps {
  route: BrowserPortalRoute;
  index: number;
  onOpen: (address: string) => void;
}

export function NewTabRouteCard({ route, index, onOpen }: NewTabRouteCardProps) {
  return (
    <button type="button" onClick={() => onOpen(route.address)}>
      <span className="hallunet-route__index">{String(index + 1).padStart(2, "0")}</span>
      <span className="hallunet-route__copy">
        <strong>{route.label}</strong>
        <code>{route.address}</code>
        <small>{route.note}</small>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

export interface NewTabFooterProps {
  status?: string;
  footer?: string;
}

export function NewTabFooter({ status, footer }: NewTabFooterProps) {
  if (!status && !footer) return null;
  return (
    <footer className="new-tab-page__principles">
      {status && <span><CircleDot aria-hidden="true" />{status}</span>}
      {footer && <span>{footer}</span>}
    </footer>
  );
}

export interface NewTabSurfaceProps {
  portal: BrowserExperienceDefinition["portal"];
  searchName: string;
  address: string;
  luckyStatus?: NewTabLuckyStatus;
  luckyMessage?: string;
  animations?: boolean;
  copy?: NewTabCopy;
  onAddressChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onLucky: () => void;
  onOpenActivity: () => void;
  onOpenRoute: (address: string) => void;
}

export function NewTabSurface({
  portal,
  searchName,
  address,
  luckyStatus = "idle",
  luckyMessage,
  animations = false,
  copy = DEFAULT_NEW_TAB_COPY,
  onAddressChange,
  onSubmit,
  onLucky,
  onOpenActivity,
  onOpenRoute,
}: NewTabSurfaceProps) {
  return (
    <motion.section
      className="new-tab-page"
      initial={animations ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: animations ? 0.28 : 0 }}
    >
      <div className="new-tab-page__aura" aria-hidden="true" />
      <div className="new-tab-page__field" aria-hidden="true"><i /><i /><i /></div>
      <div className="new-tab-page__content">
        <header className="new-tab-page__masthead">
          <motion.div className="new-tab-page__mark" initial={animations ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: animations ? 0.28 : 0 }}>
            <img src="/brand/vibesurfer-logo.png" alt="vibesurfer" />
          </motion.div>
          {portal.signal && <span className="new-tab-page__signal"><Radio aria-hidden="true" />{portal.signal}</span>}
        </header>

        <div className="new-tab-page__hero">
          {portal.eyebrow && <p className="new-tab-page__eyebrow">{portal.eyebrow}</p>}
          <h1>{portal.title[0]}<span>{portal.title[1]}</span></h1>
          {portal.lede && <p className="new-tab-page__lede">{portal.lede}</p>}
        </div>

        <NewTabComposer
          icon={portal.icon}
          value={address}
          placeholder={`${portal.placeholder} · ${searchName}`}
          inputLabel={portal.inputLabel}
          luckyStatus={luckyStatus}
          copy={copy}
          onValueChange={onAddressChange}
          onSubmit={onSubmit}
          onLucky={onLucky}
        />
        <NewTabLuckyOutcome status={luckyStatus} message={luckyMessage} copy={copy} onOpenActivity={onOpenActivity} />

        <section className="hallunet-routes" aria-label={portal.routesLabel}>
          <div className="hallunet-routes__heading"><span>{portal.routesLabel}</span><i /></div>
          <div className="hallunet-routes__grid">
            {portal.routes.map((route, index) => (
              <NewTabRouteCard key={route.address} route={route} index={index} onOpen={onOpenRoute} />
            ))}
          </div>
        </section>
      </div>
      <NewTabFooter status={portal.status} footer={portal.footer} />
    </motion.section>
  );
}
