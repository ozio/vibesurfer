import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  Columns3,
  Globe2,
  KeyRound,
  LockKeyhole,
  MonitorCog,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { Switch } from "radix-ui";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { MODELS, THEME_LABELS } from "../../data/catalog";
import {
  getRuntimeStatus,
  archivePersistedProfileSiteWorlds,
  deletePersistedProfileData,
  listProviderConnections,
  removeProviderConnection as removeHostProviderConnection,
  saveProviderConnection,
  updateProviderGenerationMode,
  verifyProviderConnection,
  type RuntimeStatus,
} from "../../generation/host-api";
import { isTauri } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { Density, ProviderConnection, ProviderKind, TabLayout } from "../../types/browser";

const sections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "tabs", label: "Tabs", icon: Columns3 },
  { id: "generation", label: "Generation", icon: WandSparkles },
  { id: "models", label: "Models & Codex", icon: Bot },
  { id: "profiles", label: "Profiles", icon: CircleUserRound },
  { id: "browser", label: "Web content", icon: Globe2 },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
] as const;

export function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const setSettingsSection = useBrowserStore((state) => state.setSettingsSection);
  const section = sections.some((item) => item.id === params.section) ? params.section! : "appearance";
  const visibleSections = searchQuery.trim()
    ? sections.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : sections;

  const openSection = (id: string) => {
    setSettingsSection(id);
    navigate(`/settings/${id}`);
  };

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__title"><MonitorCog aria-hidden="true" /><strong>Settings</strong></div>
        <label className="settings-search">
          <Search aria-hidden="true" />
          <input
            value={searchQuery}
            placeholder="Search settings"
            aria-label="Search settings"
            aria-controls="settings-section-results"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchQuery("");
              if (event.key === "Enter" && visibleSections[0]) {
                event.preventDefault();
                openSection(visibleSections[0].id);
                setSearchQuery("");
              }
            }}
          />
        </label>
        <nav aria-label="Settings sections">
          <div id="settings-section-results" className="settings-section-results" aria-live="polite">
            {visibleSections.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.id}
                  to={`/settings/${item.id}`}
                  className={section === item.id ? "is-active" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    openSection(item.id);
                    setSearchQuery("");
                  }}
                >
                  <Icon aria-hidden="true" /><span>{item.label}</span><ChevronRight aria-hidden="true" />
                </NavLink>
              );
            })}
            {visibleSections.length === 0 && (
              <p className="settings-search__empty">No matching settings</p>
            )}
          </div>
        </nav>
      </aside>
      <main className="settings-content">
        <SettingsSection section={section} />
      </main>
    </div>
  );
}

function SettingsSection({ section }: { section: string }) {
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "tabs") return <TabSettings />;
  if (section === "generation") return <GenerationSettings />;
  if (section === "models") return <ModelSettings />;
  if (section === "profiles") return <ProfileSettings />;
  if (section === "browser") return <WebContentSettings />;
  if (section === "privacy") return <PrivacySettings />;
  return <GeneralSettings />;
}

function SettingsHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <header className="settings-heading"><span>{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</header>;
}

function AppearanceSettings() {
  const preferences = useBrowserStore((state) => state.preferences);
  const setDensity = useBrowserStore((state) => state.setDensity);
  return (
    <>
      <SettingsHeading eyebrow="Personalize" title="Appearance" description="Browser chrome belongs to the current profile and is selected when that profile is created." />
      <section className="settings-group">
        <h2>Profile chrome</h2>
        <div className="theme-grid">
          <div className={`theme-card theme-card--${preferences.theme} is-active`}>
            <span className="theme-card__preview"><i /><b /><b /><b /><em /></span>
            <span className="theme-card__copy"><strong>{THEME_LABELS[preferences.theme].name}</strong><small>{THEME_LABELS[preferences.theme].caption} · fixed for this profile</small></span>
            <span className="theme-card__check"><Check aria-hidden="true" /></span>
          </div>
        </div>
      </section>
      <section className="settings-group">
        <h2>Interface density</h2>
        <div className="segmented-control">
          {(["comfortable", "compact"] as Density[]).map((density) => (
            <button key={density} className={preferences.density === density ? "is-active" : ""} type="button" onClick={() => setDensity(density)}>{density}</button>
          ))}
        </div>
      </section>
      <ToggleRow title="Interface animations" description="Animate menus, layout changes and drag feedback." preference="animations" />
    </>
  );
}

function TabSettings() {
  const preferences = useBrowserStore((state) => state.preferences);
  const setTabLayout = useBrowserStore((state) => state.setTabLayout);
  return (
    <>
      <SettingsHeading eyebrow="Workspace" title="Tabs" description="Use a Chrome-like strip or an Arc-like sidebar. Your order and active page stay intact." />
      <section className="settings-group">
        <h2>Tab layout</h2>
        <div className="layout-options">
          {(["horizontal", "vertical"] as TabLayout[]).map((layout) => (
            <button key={layout} type="button" className={preferences.tabLayout === layout ? "is-active" : ""} onClick={() => setTabLayout(layout)}>
              <span className={`layout-preview layout-preview--${layout}`}><i /><i /><i /></span>
              <span><strong>{layout === "horizontal" ? "Horizontal tabs" : "Vertical tabs"}</strong><small>{layout === "horizontal" ? "Familiar and space-efficient" : "Readable titles and quick scanning"}</small></span>
              {preferences.tabLayout === layout && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      </section>
      <ToggleRow title="Restore the previous session" description="Reopen tabs and their order when vibesurfer starts." preference="reopenSession" />
    </>
  );
}

function GenerationSettings() {
  const settings = useBrowserStore((state) => state.generationSettings);
  const patchGenerationSettings = useBrowserStore((state) => state.patchGenerationSettings);
  const patchStyleSettings = useBrowserStore((state) => state.patchStyleSettings);
  const patchImageSettings = useBrowserStore((state) => state.patchImageSettings);
  const patchPrivacySettings = useBrowserStore((state) => state.patchPrivacySettings);

  return (
    <>
      <SettingsHeading
        eyebrow="Page synthesis"
        title="Generation"
      />
      <section className="settings-group">
        <h2>Artifact styling</h2>
        <GenerationToggle
          title="Compile Tailwind utilities"
          description="Give the model the full stock Tailwind utility set, then compile only the classes used by each page."
          checked={settings.style.tailwindEnabled}
          onCheckedChange={(tailwindEnabled) => patchStyleSettings({ tailwindEnabled })}
        />
        <GenerationToggle
          title="Allow generated JavaScript"
          description="Let the model add inline JavaScript for menus, tabs, filters, dialogs, and other page interactions. Applies only to newly generated pages."
          checked={settings.style.allowGeneratedScripts}
          onCheckedChange={(allowGeneratedScripts) => patchStyleSettings({ allowGeneratedScripts })}
        />
        <div className={`settings-callout settings-callout--compact${settings.style.allowGeneratedScripts ? " is-enabled" : ""}`} role="note">
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>Security warning</strong>
            <small>Generated JavaScript is untrusted code. It runs only inside the isolated page sandbox with network APIs, storage, popups, direct parent access, and native APIs blocked, but it can still alter the page, capture interactions inside it, consume CPU, or freeze the tab.</small>
          </span>
        </div>
      </section>
      <section className="settings-group">
        <h2>Images</h2>
        <GenerationToggle
          title="Use LoremFlickr images"
          description="Resolve generated image intents into relevant LoremFlickr photos that load after the HTML."
          checked={settings.images.enabled
            && settings.images.provider === "tag-placeholder"
            && settings.images.allowExternalRequests}
          onCheckedChange={(enabled) => patchImageSettings({
            enabled,
            provider: enabled ? "tag-placeholder" : "off",
            allowExternalRequests: enabled,
            safeContent: true,
          })}
        />
      </section>
      <section className="settings-group">
        <h2>Continuity</h2>
        <GenerationToggle
          title="Include same-site navigation history"
          description="Give the model bounded summaries of previously generated pages so the imagined site stays coherent."
          checked={settings.privacy.includeNavigationHistory}
          onCheckedChange={(includeNavigationHistory) => patchPrivacySettings({ includeNavigationHistory })}
        />
      </section>
      <section className="settings-group generation-limits">
        <h2>Budgets</h2>
        <label className="settings-field">
          <span><strong>Maximum output tokens</strong><small>Provider limits may be lower.</small></span>
          <input
            type="number"
            min={512}
            max={100_000}
            step={512}
            value={settings.maxOutputTokens}
            onChange={(event) => patchGenerationSettings({ maxOutputTokens: clampNumber(event.target.value, 512, 100_000) })}
          />
        </label>
      </section>
    </>
  );
}

function ModelSettings() {
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const setModel = useBrowserStore((state) => state.setModel);
  const codex = useBrowserStore((state) => state.codex);
  const codexModels = useBrowserStore((state) => state.codexModels);
  const codexSelection = useBrowserStore((state) => state.codexSelection);
  const allProviderConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const upsertProviderConnection = useBrowserStore((state) => state.upsertProviderConnection);
  const removeProviderConnection = useBrowserStore((state) => state.removeProviderConnection);
  const [runtime, setRuntime] = useState<RuntimeStatus>();
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const providerConnections = useMemo(
    () => allProviderConnections.filter((connection) => connection.profileId === activeProfileId),
    [activeProfileId, allProviderConnections],
  );

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    setLoadingProviders(true);
    void Promise.all([getRuntimeStatus(), listProviderConnections(activeProfileId)])
      .then(([nextRuntime, connections]) => {
        if (cancelled) return;
        setRuntime(nextRuntime);
        connections.forEach(upsertProviderConnection);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProviderMessage(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, upsertProviderConnection]);

  const customModels = useMemo(
    () => providerConnections.flatMap((connection) => connection.modelIds.map((id) => ({ id, connection }))),
    [providerConnections],
  );
  const selectedCodexModel = codexModels.find(
    (model) => model.id === codexSelection.modelId || model.model === codexSelection.modelId,
  ) ?? codexModels.find((model) => model.isDefault) ?? codexModels[0];
  const codexSummary = selectedCodexModel
    ? [
        selectedCodexModel.displayName,
        selectedCodexModel.serviceTiers.find((tier) => tier.id === codexSelection.serviceTier)?.name ?? "Standard",
        codexSelection.reasoningEffort ? `${displayEffort(codexSelection.reasoningEffort)} effort` : "Default effort",
      ].join(" · ")
    : "Choose a model, speed, and reasoning effort";

  return (
    <>
      <SettingsHeading eyebrow="Inference" title="Models & credentials" description="Choose a generation source, use your system ChatGPT session, or keep your own provider key in the operating-system credential vault." />
      <section className="connection-card">
        <span className="connection-card__mark"><Sparkles aria-hidden="true" /></span>
        <span><strong>Codex (ChatGPT)</strong><small>{codex.state === "signed-in" ? `System ChatGPT session · ${codexSummary}` : "Use the ChatGPT session already available on this Mac."}</small></span>
        <button className="button" type="button" onClick={() => window.dispatchEvent(new Event("vibesurfer:open-codex"))}>{codex.state === "signed-in" ? "Configure" : "Check sign-in"}</button>
      </section>
      <div className="runtime-strip" aria-label="Generation runtime status">
        <span className={runtime?.workerAvailable || !isTauri() ? "is-ready" : undefined} />
        <strong>{isTauri() ? (runtime?.workerAvailable ? "Worker ready" : loadingProviders ? "Checking worker…" : "Worker unavailable") : "Browser preview runtime"}</strong>
        <small>{runtime?.workerDescription ?? (isTauri() ? "Build the generation worker to enable providers." : "Uses a deterministic, network-free mock provider.")}</small>
      </div>
      <section className="settings-group">
        <h2>Default model</h2>
        <div className="settings-model-list">
          {MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              disabled={!model.available}
              className={activeModelId === model.id ? "is-active" : ""}
              onClick={() => model.requiresCodex ? window.dispatchEvent(new Event("vibesurfer:open-codex")) : setModel(model.id)}
            >
              <span className="settings-model-list__icon">{model.group === "local" ? <MonitorCog aria-hidden="true" /> : <Sparkles aria-hidden="true" />}</span>
              <span><strong>{model.name}</strong><small>{model.provider} · {model.description}</small></span>
              {!model.available ? <em>Not configured</em> : activeModelId === model.id ? <Check aria-hidden="true" /> : model.requiresCodex ? <em>Configure</em> : null}
            </button>
          ))}
          {customModels.map(({ id, connection }) => (
            <button
              key={`${connection.id}:${id}`}
              type="button"
              className={activeModelId === id ? "is-active" : ""}
              onClick={() => setModel(id)}
            >
              <span className="settings-model-list__icon"><KeyRound aria-hidden="true" /></span>
              <span><strong>{displayModelId(id)}</strong><small>{connection.displayName} · bring your own key</small></span>
              {activeModelId === id ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </section>
      <ProviderConnections
        profileId={activeProfileId}
        connections={providerConnections}
        onUpsert={upsertProviderConnection}
        onRemove={removeProviderConnection}
        message={providerMessage}
        setMessage={setProviderMessage}
      />
    </>
  );
}

function ProviderConnections({
  profileId,
  connections,
  onUpsert,
  onRemove,
  message,
  setMessage,
}: {
  profileId: string;
  connections: ProviderConnection[];
  onUpsert: (connection: ProviderConnection) => void;
  onRemove: (id: string) => void;
  message: string;
  setMessage: (message: string) => void;
}) {
  const [kind, setKind] = useState<Exclude<ProviderKind, "codex" | "local">>("openai");
  const [displayName, setDisplayName] = useState("OpenAI personal");
  const [modelId, setModelId] = useState("gpt-5.4");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [generationMode, setGenerationMode] = useState<"compact" | "directed">("compact");
  const [busyId, setBusyId] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (!isTauri()) {
      setMessage("Open the desktop app to store a provider key in the operating-system credential vault.");
      return;
    }
    if (!displayName.trim() || !modelId.trim() || (kind !== "openai-compatible" && !apiKey.trim())) {
      setMessage("Display name, model ID and API key are required.");
      return;
    }
    if (kind === "openai-compatible" && !safeProviderBaseUrl(baseUrl)) {
      setMessage("Use HTTPS, or HTTP only for localhost/127.0.0.1/[::1].");
      return;
    }
    const id = `provider-${crypto.randomUUID()}`;
    const prefixedModelId = `${kind}:${modelId.trim()}`;
    setBusyId(id);
    try {
      const connection = await saveProviderConnection({
        id,
        profileId,
        kind,
        displayName: displayName.trim(),
        modelIds: [prefixedModelId],
        apiKey: apiKey.trim() || "vibesurfer-local-no-key",
        baseUrl: kind === "openai-compatible" ? baseUrl.trim() : undefined,
        generationMode: kind === "openai-compatible" ? generationMode : "directed",
      });
      onUpsert(connection);
      setApiKey("");
      setMessage(`${connection.displayName} was saved. Verify it before using the model.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId(undefined);
    }
  };

  const changeGenerationMode = async (connection: ProviderConnection, nextMode: "compact" | "directed") => {
    setBusyId(connection.id);
    setMessage("");
    try {
      const updated = await updateProviderGenerationMode(connection, nextMode);
      onUpsert(updated);
      setMessage(nextMode === "compact"
        ? `${connection.displayName} will use one compact HTML request for local and smaller models.`
        : `${connection.displayName} will use the full Director → Builder structured pipeline.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId(undefined);
    }
  };

  const verify = async (connection: ProviderConnection) => {
    setBusyId(connection.id);
    setMessage("");
    try {
      const verified = await verifyProviderConnection(profileId, connection);
      onUpsert(verified);
      setMessage(connection.kind === "openai-compatible" && (connection.generationMode ?? "compact") === "compact"
        ? `${connection.displayName} is reachable and compact text generation passed.`
        : `${connection.displayName} is reachable and structured generation passed.`);
    } catch (error) {
      onUpsert({ ...connection, status: "invalid" });
      setMessage(errorMessage(error));
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = async (connection: ProviderConnection) => {
    setBusyId(connection.id);
    setMessage("");
    try {
      await removeHostProviderConnection(profileId, connection);
      onRemove(connection.id);
      setMessage(`${connection.displayName} and its credential were removed.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="settings-group provider-settings">
      <h2>Bring your own key</h2>
      <div className="provider-list">
        {connections.length === 0 ? (
          <div className="provider-list__empty"><KeyRound aria-hidden="true" /><span><strong>No provider keys in this profile</strong><small>Keys are stored in Keychain, Credential Manager, or the platform secret service—not localStorage.</small></span></div>
        ) : connections.map((connection) => (
          <article key={connection.id} className="provider-row">
            <span className={`provider-row__status provider-row__status--${connection.status}`} />
            <span><strong>{connection.displayName}</strong><small>{connection.kind} · {connection.modelIds.map(displayModelId).join(", ") || "No models"}</small></span>
            {connection.kind === "openai-compatible" && (
              <select
                className="provider-row__mode"
                aria-label={`Generation mode for ${connection.displayName}`}
                value={connection.generationMode ?? "compact"}
                disabled={Boolean(busyId)}
                onChange={(event) => void changeGenerationMode(connection, event.target.value as "compact" | "directed")}
              >
                <option value="compact">Compact local</option>
                <option value="directed">Director → Builder</option>
              </select>
            )}
            <button className="button" type="button" disabled={Boolean(busyId)} onClick={() => void verify(connection)}><RefreshCw aria-hidden="true" /> Verify</button>
            <button className="icon-danger" type="button" aria-label={`Remove ${connection.displayName}`} disabled={Boolean(busyId)} onClick={() => void remove(connection)}><Trash2 aria-hidden="true" /></button>
          </article>
        ))}
      </div>
      <form className="provider-form" onSubmit={(event) => void submit(event)}>
        <div className="provider-form__grid">
          <label><span>Provider</span><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
          <label><span>Display name</span><input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label><span>Model ID</span><input value={modelId} maxLength={200} autoCapitalize="none" spellCheck={false} onChange={(event) => setModelId(event.target.value)} /></label>
          <label><span>{kind === "openai-compatible" ? "API key (optional for local)" : "API key"}</span><input value={apiKey} type="password" maxLength={16_384} autoComplete="off" spellCheck={false} placeholder={kind === "openai-compatible" ? "Leave empty if the local server needs none" : "Stored only after Save"} onChange={(event) => setApiKey(event.target.value)} /></label>
          {kind === "openai-compatible" && <><label className="provider-form__wide"><span>Base URL</span><input value={baseUrl} type="url" autoCapitalize="none" spellCheck={false} placeholder="http://127.0.0.1:8080/v1" onChange={(event) => setBaseUrl(event.target.value)} /></label><label className="provider-form__wide"><span>Generation mode</span><select value={generationMode} onChange={(event) => setGenerationMode(event.target.value as "compact" | "directed")}><option value="compact">Compact local — one plain HTML request (recommended)</option><option value="directed">Director → Builder — complex structured output</option></select></label></>}
        </div>
        <div className="provider-form__footer"><small>{message || "The raw key is sent to the Rust host once and never enters persisted browser state."}</small><button className="button button--primary" type="submit" disabled={Boolean(busyId)}><KeyRound aria-hidden="true" /> Save connection</button></div>
      </form>
    </section>
  );
}

function ProfileSettings() {
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const profiles = useBrowserStore((state) => state.profiles);
  const setProfile = useBrowserStore((state) => state.setProfile);
  const createProfile = useBrowserStore((state) => state.createProfile);
  const updateProfile = useBrowserStore((state) => state.updateProfile);
  const updateWorldPrompt = useBrowserStore((state) => state.updateWorldPrompt);
  const deleteProfile = useBrowserStore((state) => state.deleteProfile);
  const startProfileFromScratch = useBrowserStore((state) => state.startProfileFromScratch);
  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0]!;
  const [promptDraft, setPromptDraft] = useState(profile.worldPrompt.prompt);
  const [customName, setCustomName] = useState("Custom world");
  const [customSkin, setCustomSkin] = useState<"native" | "sedative" | "ie-classic" | "cyberpunk">("native");
  const [customWorldPrompt, setCustomWorldPrompt] = useState("");
  useEffect(() => setPromptDraft(profile.worldPrompt.prompt), [profile.id, profile.worldPrompt.prompt]);
  return (
    <>
      <SettingsHeading eyebrow="Identity" title="Profiles" description="Each profile is a complete browser workspace with its own tabs, chrome, world prompt, model settings, history, sites, and connections." />
      <div className="profile-settings-list">
        {profiles.map((item) => (
          <button key={item.id} type="button" className={item.id === activeProfileId ? "is-active" : ""} onClick={() => setProfile(item.id)}>
            <span className="avatar avatar--large">{item.avatar}</span><span><strong>{item.name}</strong><small>{THEME_LABELS[item.chromeSkin].name} · prompt r{item.worldPrompt.revision}</small></span>
            {item.id === activeProfileId && <Check aria-hidden="true" />}
          </button>
        ))}
      </div>
      <section className="settings-group">
        <h2>Current profile</h2>
        <div className="provider-form__grid">
          <label><span>Name</span><input value={profile.name} maxLength={80} onChange={(event) => updateProfile(profile.id, { name: event.target.value })} /></label>
          <label><span>Avatar</span><input value={profile.avatar} maxLength={4} onChange={(event) => updateProfile(profile.id, { avatar: event.target.value })} /></label>
          <label className="provider-form__wide"><span>Chrome skin</span><input value={THEME_LABELS[profile.chromeSkin].name} readOnly /></label>
        </div>
      </section>
      <section className="settings-group">
        <h2>World prompt</h2>
        <label className="settings-textarea">
          <textarea value={promptDraft} maxLength={20_000} rows={8} placeholder="Describe the universe-level rules for newly imagined sites." onChange={(event) => setPromptDraft(event.target.value)} />
          <small>{promptDraft.length.toLocaleString()} / 20,000 · Saving creates revision {profile.worldPrompt.revision + 1}. Existing SiteWorlds keep their frozen snapshot.</small>
        </label>
        {promptDraft !== profile.worldPrompt.prompt && (
          <div className="settings-callout settings-callout--compact" role="note">
            <TriangleAlert aria-hidden="true" />
            <span><strong>New identities only</strong><small>This revision will affect only SiteWorlds created afterward. Existing and restored incarnations keep their saved prompt snapshot.</small></span>
          </div>
        )}
        <div className="provider-form__footer"><span /><button className="button button--primary" type="button" disabled={promptDraft === profile.worldPrompt.prompt} onClick={() => updateWorldPrompt(promptDraft)}>Save new revision</button></div>
      </section>
      <section className="settings-group">
        <h2>Create profile</h2>
        <div className="segmented-control">
          <button type="button" onClick={() => createProfile({ preset: "native" })}>Native</button>
          <button type="button" onClick={() => createProfile({ preset: "quiet" })}>Quiet Web</button>
          <button type="button" onClick={() => createProfile({ preset: "explorer" })}>Internet Explorer</button>
          <button type="button" onClick={() => createProfile({ preset: "cyberpunk" })}>Cyberpunk</button>
        </div>
        <div className="provider-form__grid">
          <label><span>Custom name</span><input value={customName} onChange={(event) => setCustomName(event.target.value)} /></label>
          <label><span>Chrome skin</span><select value={customSkin} onChange={(event) => setCustomSkin(event.target.value as typeof customSkin)}>{Object.entries(THEME_LABELS).map(([id, label]) => <option key={id} value={id}>{label.name}</option>)}</select></label>
          <label className="provider-form__wide"><span>Custom world prompt</span><textarea value={customWorldPrompt} maxLength={20_000} rows={4} placeholder="Describe the world this profile should browse." onChange={(event) => setCustomWorldPrompt(event.target.value)} /></label>
        </div>
        <button className="button" type="button" disabled={!customName.trim()} onClick={() => createProfile({ name: customName, chromeSkin: customSkin, worldPrompt: customWorldPrompt })}>Create custom profile</button>
      </section>
      <section className="settings-group">
        <h2>Danger zone</h2>
        <div className="setting-row"><span><strong>Start profile from scratch</strong><small>Closes all tabs and archives every active SiteWorld. History and static artifacts are preserved.</small></span><button className="button icon-danger" type="button" onClick={() => { if (window.confirm("Archive active sites and close every tab in this profile?")) void archivePersistedProfileSiteWorlds(profile.id).then(startProfileFromScratch).catch((error) => window.alert(errorMessage(error))); }}>Start from scratch</button></div>
        <div className="setting-row"><span><strong>Delete profile</strong><small>Removes its workspace, sites, artifacts, jobs, and provider connections. The last profile cannot be deleted.</small></span><button className="button icon-danger" type="button" disabled={profiles.length <= 1} onClick={() => { if (window.confirm(`Delete ${profile.name}?`)) void deletePersistedProfileData(profile.id).then(() => deleteProfile(profile.id)).catch((error) => window.alert(errorMessage(error))); }}>Delete profile</button></div>
      </section>
    </>
  );
}

function WebContentSettings() {
  return (
    <>
      <SettingsHeading eyebrow="Rendering" title="Web content" description="Pages and arbitrary web content use separate rendering boundaries." />
      <section className="architecture-card">
        <div><span>React chrome</span><strong>Tabs, omnibox, menus</strong></div>
        <ChevronRight aria-hidden="true" />
        <div><span>Page surface</span><strong>Opaque sandboxed iframe</strong></div>
      </section>
      <div className="settings-callout"><LockKeyhole aria-hidden="true" /><span><strong>Isolated page runtime</strong><small>Links and forms navigate through the browser while page content stays separate from application data and native APIs.</small></span></div>
      <div className="settings-callout"><Globe2 aria-hidden="true" /><span><strong>Live web is explicit</strong><small>Addresses generate artifacts without contacting their origin. The live site opens only when you choose the external-browser command.</small></span></div>
    </>
  );
}

function PrivacySettings() {
  return (
    <>
      <SettingsHeading eyebrow="Boundaries" title="Privacy" description="Page content never receives browser capabilities or model credentials." />
      <div className="privacy-grid">
        <article><ShieldCheck aria-hidden="true" /><h2>Sandboxed artifacts</h2><p>Generated pages run without Tauri IPC and cannot reach provider tokens.</p></article>
        <article><LockKeyhole aria-hidden="true" /><h2>Profile-scoped identity</h2><p>Codex and provider connections belong to a browser profile, not an individual tab.</p></article>
      </div>
    </>
  );
}

function GeneralSettings() {
  return (
    <>
      <SettingsHeading eyebrow="vibesurfer" title="General" description="Startup and everyday browser behavior." />
      <ToggleRow title="Restore the previous session" description="Continue with the same tabs after restart." preference="reopenSession" />
      <section className="settings-group"><h2>Home page</h2><div className="readonly-field">vibe://new-tab</div></section>
    </>
  );
}

function GenerationToggle({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <Switch.Root className="switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={title}>
        <Switch.Thumb className="switch__thumb" />
      </Switch.Root>
    </div>
  );
}

function clampNumber(value: string, minimum: number, maximum: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function displayModelId(modelId: string): string {
  const separator = modelId.indexOf(":");
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}

function displayEffort(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function safeProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "The operation failed.";
}

function ToggleRow({ title, description, preference }: { title: string; description: string; preference: "animations" | "reopenSession" }) {
  const value = useBrowserStore((state) => state.preferences[preference]);
  const patchPreferences = useBrowserStore((state) => state.patchPreferences);
  return (
    <div className="setting-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <Switch.Root className="switch" checked={value} onCheckedChange={(checked) => patchPreferences({ [preference]: checked })} aria-label={title}>
        <Switch.Thumb className="switch__thumb" />
      </Switch.Root>
    </div>
  );
}
