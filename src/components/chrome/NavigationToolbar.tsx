import { ArrowLeft, ArrowRight, Home, LoaderCircle, RotateCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";
import { IconButton } from "../ui/IconButton";
import { AppMenu } from "./AppMenu";
import { DynamicBadge } from "./DynamicBadge";
import { GenerationModeControl } from "./GenerationModeControl";
import { ModelControl } from "./ModelControl";
import { ConnectedOmnibox } from "./Omnibox";
import { ProfileMenu } from "./ProfileMenu";
import type { BrowserNavigationRecipe } from "./navigation-recipes";

export type NavigationToolbarCommandId = "back" | "forward" | "reload" | "stop" | "home";

export interface NavigationToolbarAction {
  label: string;
  enabled: boolean;
  onExecute: () => void;
}

export interface NavigationToolbarProps {
  recipe: BrowserNavigationRecipe;
  loading: boolean;
  back: NavigationToolbarAction;
  forward: NavigationToolbarAction;
  reload: NavigationToolbarAction;
  stop: NavigationToolbarAction;
  home: NavigationToolbarAction;
  omnibox: ReactNode;
  endControls?: ReactNode;
  className?: string;
}

export function NavigationToolbar({
  recipe,
  loading,
  back,
  forward,
  reload,
  stop,
  home,
  omnibox,
  endControls,
  className = "",
}: NavigationToolbarProps) {
  const reloadOrStop = loading ? stop : reload;
  const reloadOrStopId: NavigationToolbarCommandId = loading ? "stop" : "reload";

  return (
    <nav
      className={`navigation-toolbar ${className}`.trim()}
      aria-label="Browser navigation"
      data-navigation-recipe={recipe.id}
      data-loading={loading || undefined}
    >
      <div className="navigation-toolbar__controls" role="toolbar" aria-label="Page navigation">
        <NavigationButton actionId="back" action={back}><ArrowLeft aria-hidden="true" /></NavigationButton>
        <NavigationButton actionId="forward" action={forward}><ArrowRight aria-hidden="true" /></NavigationButton>
        <NavigationButton actionId={reloadOrStopId} action={reloadOrStop}>
          {loading ? <X aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        </NavigationButton>
        <NavigationButton actionId="home" action={home}><Home aria-hidden="true" /></NavigationButton>
      </div>
      {omnibox}
      {endControls}
      {loading && (
        <span className="navigation-toolbar__activity" role="status" aria-label="Page loading">
          <LoaderCircle aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}

export interface ConnectedNavigationToolbarProps {
  tab: BrowserTab;
  recipe: BrowserNavigationRecipe;
}

export function ConnectedNavigationToolbar({ tab, recipe }: ConnectedNavigationToolbarProps) {
  const back = useBrowserCommand("back", { tabId: tab.id });
  const forward = useBrowserCommand("forward", { tabId: tab.id });
  const reload = useBrowserCommand("reload", { tabId: tab.id });
  const stop = useBrowserCommand("stop", { tabId: tab.id });
  const home = useBrowserCommand("home", { tabId: tab.id });
  const artifact = useBrowserStore((state) => {
    const id = tab.artifactId ?? tab.fallbackArtifactId;
    return id ? state.artifacts[id] : undefined;
  });

  return (
    <NavigationToolbar
      recipe={recipe}
      loading={tab.loadState === "loading"}
      back={commandAction(back)}
      forward={commandAction(forward)}
      reload={commandAction(reload)}
      stop={commandAction(stop)}
      home={commandAction(home)}
      omnibox={<ConnectedOmnibox tab={tab} recipe={recipe.omnibox} />}
      endControls={(
        <>
          <DynamicBadge tab={tab} artifact={artifact} />
          <GenerationModeControl />
          <ModelControl />
          <ProfileMenu />
          <AppMenu />
        </>
      )}
    />
  );
}

function NavigationButton({
  actionId,
  action,
  children,
}: {
  actionId: NavigationToolbarCommandId;
  action: NavigationToolbarAction;
  children: ReactNode;
}) {
  return (
    <IconButton
      className={`navigation-toolbar__button navigation-toolbar__button--${actionId}`}
      data-navigation-action={actionId}
      label={action.label}
      disabled={!action.enabled}
      onClick={action.onExecute}
    >
      {children}
    </IconButton>
  );
}

function commandAction(command: { label: string; enabled: boolean; execute: () => void }): NavigationToolbarAction {
  return {
    label: command.label,
    enabled: command.enabled,
    onExecute: command.execute,
  };
}
