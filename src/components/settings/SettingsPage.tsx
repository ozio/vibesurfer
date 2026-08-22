import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeInfo,
  Bot,
  Bug,
  Check,
  CircleUserRound,
  Columns3,
  Globe2,
  FlaskConical,
  KeyRound,
  LockKeyhole,
  MonitorCog,
  RefreshCw,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { useBrowserServices } from "../../browser/browser-services";
import { MODELS, PROFILE_PRESETS, THEME_LABELS } from "../../data/catalog";
import thirdPartyNotices from "../../generated/third-party-notices.json";
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
import { GENERATION_CAPABILITY_OPTIONS } from "../../generation/capability-settings";
import {
  listMediaConnections,
  removeMediaConnection,
  saveMediaConnection,
  verifyMediaConnection,
  type MediaConnection,
} from "../../media/media-host-api";
import { useBrowserStore } from "../../store/browser-store";
import type { Density, DynamicMode, ProviderConnection, ProviderKind, TabLayout, ThemeId } from "../../types/browser";
import {
  SettingSwitchRow,
  SettingsArchitectureCard,
  SettingsConnectionCard,
  SettingsDangerAction,
  SettingsGroup,
  SettingsHeading,
  SettingsLayoutOptions,
  SettingsLicenses,
  SettingsModelCard,
  SettingsPrivacyCard,
  SettingsProfileCard,
  SettingsProviderCard,
  SettingsProviderEmpty,
  SettingsRuntimeCard,
  SettingsShell,
  type SettingsLicenseNotice,
} from "./SettingsPatterns";
import { Button, ConfirmDialog, SegmentedControl } from "../ui";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: Settings2, keywords: ["startup", "home", "session"] },
  { id: "tabs", label: "Tabs", icon: Columns3, keywords: ["horizontal", "vertical", "layout"] },
  { id: "generation", label: "Generation", icon: WandSparkles, keywords: ["capabilities", "images", "voice", "dynamic"] },
  { id: "models", label: "Models & Codex", icon: Bot, keywords: ["provider", "credentials", "runtime", "key"] },
  { id: "profiles", label: "Profiles", icon: CircleUserRound, keywords: ["identity", "theme", "density", "vibe"] },
  { id: "browser", label: "Web content", icon: Globe2, keywords: ["sandbox", "iframe", "rendering"] },
  { id: "privacy", label: "Privacy", icon: ShieldCheck, keywords: ["security", "credentials", "isolation"] },
  { id: "about", label: "About & Licenses", icon: BadgeInfo, keywords: ["open source", "notices", "version"] },
] as const;

export function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const setSettingsSection = useBrowserStore((state) => state.setSettingsSection);
  const section = SETTINGS_SECTIONS.some((item) => item.id === params.section) ? params.section! : "general";

  const openSection = (id: string) => {
    setSettingsSection(id);
    navigate(`/settings/${id}`);
  };

  return (
    <SettingsShell
      sections={SETTINGS_SECTIONS}
      activeSectionId={section}
      query={searchQuery}
      onQueryChange={setSearchQuery}
      onSectionChange={openSection}
    >
      <SettingsSection section={section} />
    </SettingsShell>
  );
}

function SettingsSection({ section }: { section: string }) {
  if (section === "tabs") return <TabSettings />;
  if (section === "generation") return <GenerationSettings />;
  if (section === "models") return <ModelSettings />;
  if (section === "profiles") return <ProfileSettings />;
  if (section === "browser") return <WebContentSettings />;
  if (section === "privacy") return <PrivacySettings />;
  if (section === "about") return <AboutSettings />;
  return <GeneralSettings />;
}

function TabSettings() {
  const preferences = useBrowserStore((state) => state.preferences);
  const horizontalTabs = useBrowserCommand("horizontal-tabs");
  const verticalTabs = useBrowserCommand("vertical-tabs");
  return (
    <>
      <SettingsHeading eyebrow="Workspace" title="Tabs" description="Use a Chrome-like strip or an Arc-like sidebar. Your order and active page stay intact." />
      <SettingsGroup title="Tab layout">
        <SettingsLayoutOptions
          label="Tab layout"
          value={preferences.tabLayout}
          options={(["horizontal", "vertical"] as TabLayout[]).map((layout) => ({
            value: layout,
            title: layout === "horizontal" ? "Horizontal tabs" : "Vertical tabs",
            description: layout === "horizontal" ? "Familiar and space-efficient" : "Readable titles and quick scanning",
            preview: <span className={`layout-preview layout-preview--${layout}`}><i /><i /><i /></span>,
          }))}
          onValueChange={(layout) => (layout === "horizontal" ? horizontalTabs : verticalTabs).execute()}
        />
      </SettingsGroup>
      <PreferenceSwitchRow title="Restore the previous session" description="Reopen tabs and their order when vibesurfer starts." preference="reopenSession" />
    </>
  );
}

function GenerationSettings() {
  const services = useBrowserServices();
  const isDesktop = services.runtime === "tauri";
  const settings = useBrowserStore((state) => state.generationSettings);
  const patchGenerationSettings = useBrowserStore((state) => state.patchGenerationSettings);
  const patchStyleSettings = useBrowserStore((state) => state.patchStyleSettings);
  const patchImageSettings = useBrowserStore((state) => state.patchImageSettings);
  const patchCapabilitySettings = useBrowserStore((state) => state.patchCapabilitySettings);
  const patchVoiceSettings = useBrowserStore((state) => state.patchVoiceSettings);
  const patchPrivacySettings = useBrowserStore((state) => state.patchPrivacySettings);
  const openCapabilities = useBrowserStore((state) => state.openCapabilities);
  const openGenerationDebug = useBrowserStore((state) => state.openGenerationDebug);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const [mediaConnections, setMediaConnections] = useState<MediaConnection[]>([]);
  const [mediaName, setMediaName] = useState("ElevenLabs media");
  const [mediaKey, setMediaKey] = useState("");
  const [mediaBusy, setMediaBusy] = useState("");
  const [mediaMessage, setMediaMessage] = useState("");
  const [confirmAlwaysOpen, setConfirmAlwaysOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listMediaConnections(activeProfileId)
      .then((connections) => {
        if (cancelled) return;
        setMediaConnections(connections);
        if (settings.voice.mediaConnectionId
            && !connections.some((connection) => connection.id === settings.voice.mediaConnectionId && connection.status === "valid")) {
          patchVoiceSettings({ mediaConnectionId: undefined, voice: "", availableVoiceIds: [] });
        }
      })
      .catch((error) => { if (!cancelled) setMediaMessage(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [activeProfileId, patchVoiceSettings, settings.voice.mediaConnectionId]);

  const connectMedia = async (event: FormEvent) => {
    event.preventDefault();
    if (!mediaKey.trim() || mediaBusy) return;
    const id = `elevenlabs-media-${crypto.randomUUID()}`;
    setMediaBusy("new");
    setMediaMessage("Checking the key and loading voices…");
    try {
      const connection = await saveMediaConnection({ id, profileId: activeProfileId, displayName: mediaName.trim() || "ElevenLabs media", apiKey: mediaKey });
      setMediaConnections((current) => [...current.filter((candidate) => candidate.id !== connection.id), connection]);
      setMediaKey("");
      patchVoiceSettings({ engine: "cloud", provider: "elevenlabs", mediaConnectionId: connection.id, model: "eleven_multilingual_v2", voice: connection.voices[0]?.id ?? "", availableVoiceIds: connection.voices.map((voice) => voice.id) });
      setMediaMessage(`${connection.displayName} is verified; ${connection.voices.length} voices are available.`);
    } catch (error) {
      setMediaMessage(errorMessage(error));
    } finally {
      setMediaBusy("");
    }
  };

  const verifyMedia = async (connection: MediaConnection) => {
    setMediaBusy(connection.id);
    try {
      const verified = await verifyMediaConnection(activeProfileId, connection.id);
      setMediaConnections((current) => current.map((candidate) => candidate.id === verified.id ? verified : candidate));
      if (settings.voice.mediaConnectionId === verified.id) patchVoiceSettings({ availableVoiceIds: verified.voices.map((voice) => voice.id) });
      setMediaMessage(`${verified.displayName} is valid; ${verified.voices.length} voices refreshed.`);
    } catch (error) {
      setMediaConnections((current) => current.map((candidate) => candidate.id === connection.id ? { ...candidate, status: "invalid" } : candidate));
      if (settings.voice.mediaConnectionId === connection.id) patchVoiceSettings({ mediaConnectionId: undefined, voice: "", availableVoiceIds: [] });
      setMediaMessage(errorMessage(error));
    } finally {
      setMediaBusy("");
    }
  };

  const deleteMedia = async (connection: MediaConnection) => {
    setMediaBusy(connection.id);
    try {
      await removeMediaConnection(activeProfileId, connection.id);
      setMediaConnections((current) => current.filter((candidate) => candidate.id !== connection.id));
      if (settings.voice.mediaConnectionId === connection.id) patchVoiceSettings({ mediaConnectionId: undefined, voice: "", availableVoiceIds: [] });
      setMediaMessage(`${connection.displayName} and its Keychain credential were removed.`);
    } catch (error) {
      setMediaMessage(errorMessage(error));
    } finally {
      setMediaBusy("");
    }
  };

  const selectedMedia = mediaConnections.find((connection) => connection.id === settings.voice.mediaConnectionId);

  return (
    <>
      <SettingsHeading
        eyebrow="Page synthesis"
        title="Generation"
      />
      <section className="settings-group">
        <h2>Generation mode</h2>
        <SegmentedControl
          label="Page generation mode"
          value={settings.strategy}
          options={[{ value: "full", label: "Full" }, { value: "turbo", label: "Turbo" }]}
          onValueChange={(strategy) => patchGenerationSettings({ strategy: strategy as "full" | "turbo" })}
        />
        <div className={`settings-callout settings-callout--compact${settings.strategy === "turbo" ? " is-turbo" : ""}`} role="note">
          {settings.strategy === "turbo" ? <Zap aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
          <span>
            <strong>{settings.strategy === "turbo" ? "One compact HTML request" : "Director → Builder"}</strong>
            <small>{settings.strategy === "turbo"
              ? "Uses a bounded context and 4K output ceiling. Dynamic regions, generated JavaScript, images and optional capabilities are disabled for newly generated pages."
              : "Uses the complete site direction, identity, capabilities and rendering contracts for higher-fidelity pages."}</small>
          </span>
        </div>
      </section>
      <section className="settings-group">
        <h2>Live regions</h2>
        <SegmentedControl
          label="Dynamic update mode"
          value={settings.dynamicMode}
          options={[
            { value: "off", label: "Off" },
            { value: "active", label: "Active tab" },
            { value: "always", label: "Always" },
          ]}
          onValueChange={(value) => {
            const mode = value as DynamicMode;
            if (mode === "always" && settings.dynamicMode !== "always") setConfirmAlwaysOpen(true);
            else patchGenerationSettings({ dynamicMode: mode });
          }}
        />
        <div className="settings-callout settings-callout--compact" role="note">
          <RefreshCw aria-hidden="true" />
          <span><strong>Host-mediated updates</strong><small>Manual cart, wishlist, chat, and refresh actions stay inside the private page bridge. Active tab pauses timers when VibeSurfer loses focus; Always keeps generated tabs current while the app runs.</small></span>
        </div>
      </section>
      <ConfirmDialog
        open={confirmAlwaysOpen}
        onOpenChange={setConfirmAlwaysOpen}
        title="Enable always-on live regions?"
        description="Background tabs can continue making model requests and consuming tokens while VibeSurfer is open."
        confirmLabel="Enable always-on"
        onConfirm={() => patchGenerationSettings({ dynamicMode: "always" })}
      />
      <section className="settings-group">
        <h2>Artifact styling</h2>
        <SettingSwitchRow
          title="Compile Tailwind utilities"
          description="Require utility-first styling with the stock Tailwind set, then compile only classes used by the page. Exact inline CSS remains available for exceptional selectors and effects."
          checked={settings.style.tailwindEnabled}
          onCheckedChange={(tailwindEnabled) => patchStyleSettings({ tailwindEnabled })}
        />
        <SettingSwitchRow
          title="Allow generated JavaScript"
          description="Let calculators, converters, menus, tabs, filters, and dialogs work locally without generating another page. Applies only to newly generated pages."
          checked={settings.style.allowGeneratedScripts}
          onCheckedChange={(allowGeneratedScripts) => patchStyleSettings({ allowGeneratedScripts })}
        />
        <div className={`settings-callout settings-callout--compact security-note${settings.style.allowGeneratedScripts ? " is-enabled" : ""}`} role="note">
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>Security warning</strong>
            <small>Generated JavaScript is untrusted code. It runs only inside the isolated page sandbox with network APIs, storage, popups, direct parent access, and native APIs blocked, but it can still alter the page, capture interactions inside it, consume CPU, or freeze the tab.</small>
          </span>
        </div>
      </section>
      <section className="settings-group">
        <h2>Built-in capabilities</h2>
        <details className="settings-details capability-explainer">
          <summary>How built-in capabilities work</summary>
          <p>Generated pages request small semantic features. VibeSurfer validates them and compiles trusted local implementations for charts, diagrams, slideshows, pseudo-video, speech and restrained patterns.</p>
          <p>The page itself cannot contact an origin, load scripts from a CDN, read credentials or call native APIs. These choices affect newly generated pages; existing artifacts remain unchanged until regenerated.</p>
        </details>
        <SettingSwitchRow
          title="Icon library"
          description="Let the Director choose one allowlisted local Iconify set. Selected icons are compiled to inline SVG before display."
          checked={settings.capabilities.iconsEnabled}
          onCheckedChange={(iconsEnabled) => patchCapabilitySettings({ iconsEnabled })}
        />
        {GENERATION_CAPABILITY_OPTIONS.map((option) => {
          const needsAudio = option.id === "speech" || option.id === "sound";
          const checked = settings.capabilities.enabled[option.id] !== false
            && (!needsAudio || settings.capabilities.audioSpeechEnabled);
          return (
            <SettingSwitchRow
              key={option.id}
              title={option.title}
              description={`${option.description} ${option.execution === "compiler" ? "Compiled locally." : "Runs in the trusted page runtime."}`}
              checked={checked}
              onCheckedChange={(enabled) => patchCapabilitySettings({
                ...(needsAudio && enabled ? { audioSpeechEnabled: true } : {}),
                enabled: { ...settings.capabilities.enabled, [option.id]: enabled },
              })}
            />
          );
        })}
        <SettingSwitchRow
          title="Allow configured external media providers"
          description="Permit licensed stock media only after a provider and credential are configured. Built-in capabilities remain fully offline."
          checked={settings.capabilities.externalMediaEnabled}
          onCheckedChange={(externalMediaEnabled) => patchCapabilitySettings({ externalMediaEnabled })}
        />
        <SettingSwitchRow
          title="Allow experimental capabilities"
          description="Permit explicitly configured experiments such as copyright-sensitive archives or real maps. No provider is enabled automatically."
          checked={settings.capabilities.experimentalEnabled}
          onCheckedChange={(experimentalEnabled) => patchCapabilitySettings({ experimentalEnabled })}
        />
        <button className="button capability-lab-link" type="button" onClick={openCapabilities}>
          <FlaskConical aria-hidden="true" /> Open capability lab
        </button>
        <button className="button capability-lab-link" type="button" onClick={openGenerationDebug}>
          <Bug aria-hidden="true" /> Open generation debug
        </button>
      </section>
      <section className="settings-group">
        <h2>Images</h2>
        <SettingSwitchRow
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
      <section className="settings-group voice-audio-settings">
        <h2>Voice &amp; Audio</h2>
        <SettingSwitchRow title="Narration" description="Allow pseudo-video scenes to turn their visible narration text into seekable speech, captions, and transcript." checked={settings.capabilities.audioSpeechEnabled} onCheckedChange={(audioSpeechEnabled) => patchCapabilitySettings({ audioSpeechEnabled })} />
        <label className="settings-field">
          <span><strong>Speech engine</strong><small>Russian automatically uses the macOS system voice because Kokoro has no Russian voice.</small></span>
          <select value={settings.voice.engine} onChange={(event) => {
            const engine = event.target.value as "local" | "system" | "cloud";
            if (engine === "local") patchVoiceSettings({ engine, model: "kokoro-82m-q8", voice: "af_heart" });
            else if (engine === "system") patchVoiceSettings({ engine, model: "macos-system", voice: "default" });
            else {
              const connection = mediaConnections.find((candidate) => candidate.id === settings.voice.mediaConnectionId && candidate.status === "valid");
              patchVoiceSettings({ engine, provider: "elevenlabs", voice: connection?.voices[0]?.id ?? "", availableVoiceIds: connection?.voices.map((voice) => voice.id) ?? [] });
            }
          }}>
            <option value="local">Local Kokoro</option><option value="system">macOS system</option><option value="cloud">Cloud provider</option>
          </select>
        </label>
        {settings.voice.engine === "cloud" && <>
          <label className="settings-field"><span><strong>Provider</strong><small>ElevenLabs media uses a separate profile-scoped Keychain connection.</small></span><select value={settings.voice.provider} onChange={(event) => patchVoiceSettings({ provider: event.target.value as "openai" | "elevenlabs" | "deepgram" })}><option value="elevenlabs">ElevenLabs</option><option value="openai" disabled>OpenAI (not available for video)</option><option value="deepgram" disabled>Deepgram (not available for video)</option></select></label>
          <label className="settings-field"><span><strong>Media connection</strong><small>Only verified connections are offered to the Builder.</small></span><select value={settings.voice.mediaConnectionId ?? ""} onChange={(event) => {
            const connection = mediaConnections.find((candidate) => candidate.id === event.target.value);
            patchVoiceSettings({ mediaConnectionId: connection?.id, provider: "elevenlabs", voice: connection?.voices[0]?.id ?? "", availableVoiceIds: connection?.voices.map((voice) => voice.id) ?? [] });
          }}><option value="">No external media</option>{mediaConnections.map((connection) => <option key={connection.id} value={connection.id} disabled={connection.status !== "valid"}>{connection.displayName} · {connection.status}</option>)}</select></label>
          <label className="settings-field"><span><strong>Model</strong><small>Provider model identifier.</small></span><input value={settings.voice.model} onChange={(event) => patchVoiceSettings({ model: event.target.value.slice(0, 120) })} /></label>
        </>}
        {settings.voice.engine === "cloud" && selectedMedia ? <label className="settings-field"><span><strong>Voice</strong><small>Verified ElevenLabs voice ID.</small></span><select value={settings.voice.voice} onChange={(event) => patchVoiceSettings({ voice: event.target.value })}>{selectedMedia.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.category ? ` · ${voice.category}` : ""}</option>)}</select></label>
          : <label className="settings-field"><span><strong>Voice</strong><small>Local asset or macOS system voice name.</small></span><input value={settings.voice.voice} onChange={(event) => patchVoiceSettings({ voice: event.target.value.slice(0, 120) })} /></label>}
        <label className="settings-field"><span><strong>Speed</strong><small>{settings.voice.speed.toFixed(2)}×</small></span><input type="range" min="0.6" max="1.5" step="0.05" value={settings.voice.speed} onChange={(event) => patchVoiceSettings({ speed: Number(event.target.value) })} /></label>
        <label className="settings-field">
          <span><strong>Background music</strong><small>Built-in MIDI stays offline. External generation is requested only when both this setting and External media permit it.</small></span>
          <select value={settings.voice.musicMode} onChange={(event) => patchVoiceSettings({ musicMode: event.target.value as "off" | "built-in" | "generate-if-requested" })}>
            <option value="off">Off</option><option value="built-in">Built-in MIDI</option><option value="generate-if-requested">Generate if requested</option>
          </select>
        </label>
        <label className="settings-field"><span><strong>Music volume</strong><small>{Math.round(settings.voice.musicVolume * 100)}%, automatically ducked under narration.</small></span><input type="range" min="0" max="1" step="0.01" value={settings.voice.musicVolume} onChange={(event) => patchVoiceSettings({ musicVolume: Number(event.target.value) })} /></label>
        <button className="button voice-test-button" type="button" onClick={() => testSystemVoice(settings.voice.speed)}><Play aria-hidden="true" /> Test Voice</button>
        <p className="settings-inline-note" role="note">Narration is rendered on first Play. The page receives only timeline state; keys and audio bytes never enter the sandbox bridge.</p>
        <details className="settings-details">
          <summary>ElevenLabs media connections</summary>
          <div className="provider-list">
            {mediaConnections.map((connection) => (
              <SettingsProviderCard
                key={connection.id}
                name={connection.displayName}
                description={`${connection.voices.length} voices · profile scoped`}
                status={connection.status}
                busy={Boolean(mediaBusy)}
                onVerify={() => void verifyMedia(connection)}
                onRemove={() => void deleteMedia(connection)}
              />
            ))}
          </div>
          <form className="provider-form" onSubmit={(event) => void connectMedia(event)}>
            <div className="provider-form__grid"><label><span>Connection name</span><input value={mediaName} maxLength={120} onChange={(event) => setMediaName(event.target.value)} /></label><label><span>ElevenLabs API key</span><input type="password" value={mediaKey} autoComplete="off" onChange={(event) => setMediaKey(event.target.value)} /></label></div>
            <div className="provider-form__footer"><small>{mediaMessage || (isDesktop ? "The key is verified by Rust, then stored in Keychain." : "Connections are available in the packaged desktop app.")}</small><button className="button button--primary" type="submit" disabled={!isDesktop || !mediaKey.trim() || Boolean(mediaBusy)}><KeyRound aria-hidden="true" /> Verify &amp; save</button></div>
          </form>
        </details>
      </section>
      <section className="settings-group">
        <h2>Continuity</h2>
        <SettingSwitchRow
          title="Include same-site navigation history"
          description="Give the model bounded summaries of previously generated pages so the imagined site stays coherent."
          checked={settings.privacy.includeNavigationHistory}
          onCheckedChange={(includeNavigationHistory) => patchPrivacySettings({ includeNavigationHistory })}
        />
      </section>
      <section className="settings-group generation-limits">
        <h2>Budgets</h2>
        <label className="settings-field">
          <span><strong>Maximum output tokens</strong><small>{settings.strategy === "turbo" ? "Turbo uses at most 4,096." : "Provider limits may be lower."}</small></span>
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
  const services = useBrowserServices();
  const isDesktop = services.runtime === "tauri";
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
    if (!isDesktop) return;
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
  }, [activeProfileId, isDesktop, upsertProviderConnection]);

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
      <SettingsConnectionCard
        icon={<Sparkles />}
        title="Codex (ChatGPT)"
        description={codex.state === "signed-in" ? `System ChatGPT session · ${codexSummary}` : "Use the ChatGPT session already available on this Mac."}
        action={<Button size="small" onClick={() => window.dispatchEvent(new Event("vibesurfer:open-codex"))}>{codex.state === "signed-in" ? "Configure" : "Check sign-in"}</Button>}
      />
      <SettingsRuntimeCard
        state={!isDesktop ? "preview" : runtime?.workerAvailable ? "ready" : loadingProviders ? "checking" : "unavailable"}
        title={isDesktop ? (runtime?.workerAvailable ? "Worker ready" : loadingProviders ? "Checking worker…" : "Worker unavailable") : "Browser preview runtime"}
        description={runtime?.workerDescription ?? (isDesktop ? "Build the generation worker to enable providers." : "Uses a deterministic, network-free mock provider.")}
      />
      <SettingsGroup title="Default model">
        <div className="settings-model-list">
          {MODELS.map((model) => (
            <SettingsModelCard
              key={model.id}
              icon={model.group === "local" ? <MonitorCog aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              title={model.name}
              description={`${model.provider} · ${model.description}`}
              disabled={!model.available}
              selected={activeModelId === model.id}
              trailing={!model.available ? <em>Not configured</em> : activeModelId === model.id ? undefined : model.requiresCodex ? <em>Configure</em> : null}
              onSelect={() => model.requiresCodex ? window.dispatchEvent(new Event("vibesurfer:open-codex")) : setModel(model.id)}
            />
          ))}
          {customModels.map(({ id, connection }) => (
            <SettingsModelCard
              key={`${connection.id}:${id}`}
              icon={<KeyRound aria-hidden="true" />}
              title={displayModelId(id)}
              description={`${connection.displayName} · bring your own key`}
              selected={activeModelId === id}
              onSelect={() => setModel(id)}
            />
          ))}
        </div>
      </SettingsGroup>
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
  const isDesktop = useBrowserServices().runtime === "tauri";
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
    if (!isDesktop) {
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
        ? `${connection.displayName} will use plain text for compatibility checks. Page mode is selected separately.`
        : `${connection.displayName} will verify structured-output compatibility. Page mode is selected separately.`);
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
        {connections.length === 0 ? <SettingsProviderEmpty /> : connections.map((connection) => (
          <SettingsProviderCard
            key={connection.id}
            name={connection.displayName}
            description={`${connection.kind} · ${connection.modelIds.map(displayModelId).join(", ") || "No models"}`}
            status={connection.status}
            busy={Boolean(busyId)}
            mode={connection.kind === "openai-compatible" ? connection.generationMode ?? "compact" : undefined}
            onModeChange={connection.kind === "openai-compatible" ? (nextMode) => void changeGenerationMode(connection, nextMode) : undefined}
            onVerify={() => void verify(connection)}
            onRemove={() => void remove(connection)}
          />
        ))}
      </div>
      <form className="provider-form" onSubmit={(event) => void submit(event)}>
        <div className="provider-form__grid">
          <label><span>Provider</span><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
          <label><span>Display name</span><input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label><span>Model ID</span><input value={modelId} maxLength={200} autoCapitalize="none" spellCheck={false} onChange={(event) => setModelId(event.target.value)} /></label>
          <label><span>{kind === "openai-compatible" ? "API key (optional for local)" : "API key"}</span><input value={apiKey} type="password" maxLength={16_384} autoComplete="off" spellCheck={false} placeholder={kind === "openai-compatible" ? "Leave empty if the local server needs none" : "Stored only after Save"} onChange={(event) => setApiKey(event.target.value)} /></label>
          {kind === "openai-compatible" && <><label className="provider-form__wide"><span>Base URL</span><input value={baseUrl} type="url" autoCapitalize="none" spellCheck={false} placeholder="http://127.0.0.1:8080/v1" onChange={(event) => setBaseUrl(event.target.value)} /></label><label className="provider-form__wide"><span>Compatibility check</span><select value={generationMode} onChange={(event) => setGenerationMode(event.target.value as "compact" | "directed")}><option value="compact">Plain text — recommended for local and smaller models</option><option value="directed">Structured output — provider supports strict schemas</option></select></label></>}
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
  const preferences = useBrowserStore((state) => state.preferences);
  const setDensity = useBrowserStore((state) => state.setDensity);
  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0]!;
  const [vibeDraft, setVibeDraft] = useState(profile.worldPrompt.vibe);
  const [promptDraft, setPromptDraft] = useState(profile.worldPrompt.prompt);
  const [newPreset, setNewPreset] = useState<keyof typeof PROFILE_PRESETS>("native");
  const [newName, setNewName] = useState<string>(PROFILE_PRESETS.native.name);
  const [newAvatar, setNewAvatar] = useState<string>(PROFILE_PRESETS.native.avatar);
  const [newSkin, setNewSkin] = useState<ThemeId>(PROFILE_PRESETS.native.chromeSkin);
  const [newVibe, setNewVibe] = useState<string>(PROFILE_PRESETS.native.vibe);
  const [newWorldPrompt, setNewWorldPrompt] = useState<string>(PROFILE_PRESETS.native.prompt);
  const [profileActionError, setProfileActionError] = useState("");
  useEffect(() => {
    setVibeDraft(profile.worldPrompt.vibe);
    setPromptDraft(profile.worldPrompt.prompt);
  }, [profile.id, profile.worldPrompt.prompt, profile.worldPrompt.vibe]);

  const selectPreset = (id: keyof typeof PROFILE_PRESETS) => {
    const preset = PROFILE_PRESETS[id];
    setNewPreset(id);
    setNewName(preset.name);
    setNewAvatar(preset.avatar);
    setNewSkin(preset.chromeSkin);
    setNewVibe(preset.vibe);
    setNewWorldPrompt(preset.prompt);
  };
  const promptChanged = vibeDraft !== profile.worldPrompt.vibe || promptDraft !== profile.worldPrompt.prompt;
  const resetCurrentProfile = async () => {
    setProfileActionError("");
    try {
      await archivePersistedProfileSiteWorlds(profile.id);
      startProfileFromScratch();
    } catch (error) {
      setProfileActionError(errorMessage(error));
    }
  };
  const removeCurrentProfile = async () => {
    setProfileActionError("");
    try {
      await deletePersistedProfileData(profile.id);
      deleteProfile(profile.id);
    } catch (error) {
      setProfileActionError(errorMessage(error));
    }
  };
  return (
    <>
      <SettingsHeading eyebrow="Identity" title="Profiles" description="Each profile is a complete browser workspace with its own appearance, vibe, tabs, model settings, history, sites, and connections." />
      <div className="profile-settings-list">
        {profiles.map((item) => (
          <SettingsProfileCard
            key={item.id}
            avatar={item.avatar}
            title={item.name}
            description={`${THEME_LABELS[item.chromeSkin].name} · prompt r${item.worldPrompt.revision}`}
            selected={item.id === activeProfileId}
            onSelect={() => {
              setProfile(item.id);
              useBrowserStore.getState().openSettings("profiles");
            }}
          />
        ))}
      </div>
      <section className="settings-group">
        <h2>Current profile</h2>
        <div className="provider-form__grid">
          <label><span>Name</span><input value={profile.name} maxLength={80} onChange={(event) => updateProfile(profile.id, { name: event.target.value })} /></label>
          <label><span>Avatar</span><input value={profile.avatar} maxLength={4} onChange={(event) => updateProfile(profile.id, { avatar: event.target.value })} /></label>
          <label className="provider-form__wide"><span>Chrome skin</span><select value={profile.chromeSkin} onChange={(event) => updateProfile(profile.id, { chromeSkin: event.target.value as ThemeId })}>{Object.entries(THEME_LABELS).map(([id, label]) => <option key={id} value={id}>{label.name} — {label.caption}</option>)}</select></label>
        </div>
      </section>
      <section className="settings-group">
        <h2>Appearance</h2>
        <SegmentedControl
          label="Interface density"
          value={preferences.density}
          options={(["comfortable", "compact"] as Density[]).map((density) => ({ value: density, label: density }))}
          onValueChange={(density) => setDensity(density as Density)}
        />
        <PreferenceSwitchRow title="Interface animations" description="Animate browser chrome and allow suitable motion in newly generated pages." preference="animations" />
      </section>
      <section className="settings-group">
        <h2>Vibe</h2>
        <label className="settings-textarea">
          <textarea value={vibeDraft} maxLength={1_000} rows={3} placeholder="For example: a living 2000s internet, handmade and optimistic." onChange={(event) => setVibeDraft(event.target.value)} />
          <small>{vibeDraft.length.toLocaleString()} / 1,000 · A short visual and cultural direction for new sites.</small>
        </label>
        <details className="settings-details">
          <summary>Advanced world rules</summary>
          <label className="settings-textarea">
            <textarea value={promptDraft} maxLength={20_000} rows={8} placeholder="Describe universe-level rules, constraints, history, or writing style." onChange={(event) => setPromptDraft(event.target.value)} />
            <small>{promptDraft.length.toLocaleString()} / 20,000</small>
          </label>
        </details>
        {promptChanged && (
          <div className="settings-callout settings-callout--compact" role="note">
            <TriangleAlert aria-hidden="true" />
            <span><strong>New identities only</strong><small>This revision will affect only SiteWorlds created afterward. Existing and restored incarnations keep their saved prompt snapshot.</small></span>
          </div>
        )}
        <div className="provider-form__footer"><small>Saving creates revision {profile.worldPrompt.revision + 1}.</small><button className="button button--primary" type="button" disabled={!promptChanged} onClick={() => updateWorldPrompt({ vibe: vibeDraft, prompt: promptDraft })}>Save new revision</button></div>
      </section>
      <section className="settings-group">
        <h2>Create profile</h2>
        <div className="profile-preset-grid" role="radiogroup" aria-label="Profile preset">
          {(Object.entries(PROFILE_PRESETS) as Array<[keyof typeof PROFILE_PRESETS, (typeof PROFILE_PRESETS)[keyof typeof PROFILE_PRESETS]]>).map(([id, preset]) => (
            <label key={id} className={`profile-preset-card${newPreset === id ? " is-active" : ""}`}>
              <input type="radio" name="profile-preset" value={id} checked={newPreset === id} onChange={() => selectPreset(id)} />
              <span className="avatar">{preset.avatar}</span>
              <span><strong>{preset.name}</strong><small>{THEME_LABELS[preset.chromeSkin].name}</small></span>
              {newPreset === id && <Check aria-hidden="true" />}
            </label>
          ))}
        </div>
        <div className="provider-form__grid">
          <label><span>Name</span><input value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} /></label>
          <label><span>Avatar</span><input value={newAvatar} maxLength={4} onChange={(event) => setNewAvatar(event.target.value)} /></label>
          <label className="provider-form__wide"><span>Chrome skin</span><select value={newSkin} onChange={(event) => setNewSkin(event.target.value as ThemeId)}>{Object.entries(THEME_LABELS).map(([id, label]) => <option key={id} value={id}>{label.name}</option>)}</select></label>
          <label className="provider-form__wide"><span>Vibe</span><textarea value={newVibe} maxLength={1_000} rows={3} placeholder="A short visual and cultural direction." onChange={(event) => setNewVibe(event.target.value)} /></label>
        </div>
        <details className="settings-details"><summary>Advanced world rules</summary><label className="settings-textarea"><textarea value={newWorldPrompt} maxLength={20_000} rows={5} onChange={(event) => setNewWorldPrompt(event.target.value)} /></label></details>
        <button className="button button--primary" type="button" disabled={!newName.trim()} onClick={() => createProfile({ name: newName, avatar: newAvatar, chromeSkin: newSkin, vibe: newVibe, worldPrompt: newWorldPrompt })}>Create profile</button>
      </section>
      <section className="settings-group">
        <h2>Danger zone</h2>
        {profileActionError && (
          <div className="settings-callout settings-callout--compact" role="alert">
            <TriangleAlert aria-hidden="true" /><span><strong>Profile action failed</strong><small>{profileActionError}</small></span>
          </div>
        )}
        <SettingsDangerAction
          title="Start profile from scratch"
          description="Closes all tabs and archives every active SiteWorld. History and static artifacts are preserved."
          actionLabel="Start from scratch"
          dialogTitle="Start this profile from scratch?"
          dialogDescription="Every active SiteWorld will be archived and all tabs will close. History and static artifacts are preserved."
          confirmLabel="Archive and restart"
          onConfirm={() => void resetCurrentProfile()}
        />
        <SettingsDangerAction
          title="Delete profile"
          description="Removes its workspace, sites, artifacts, jobs, provider and media connections, and cached media. The last profile cannot be deleted."
          actionLabel="Delete profile"
          dialogTitle={`Delete ${profile.name}?`}
          dialogDescription="This removes the profile workspace, sites, artifacts, jobs, connections, and cached media. This action cannot be undone."
          disabled={profiles.length <= 1}
          onConfirm={() => void removeCurrentProfile()}
        />
      </section>
    </>
  );
}

function WebContentSettings() {
  return (
    <>
      <SettingsHeading eyebrow="Rendering" title="Web content" description="Pages and arbitrary web content use separate rendering boundaries." />
      <SettingsArchitectureCard nodes={[
        { label: "React chrome", title: "Tabs, omnibox, menus" },
        { label: "Page surface", title: "Opaque sandboxed iframe" },
      ]} />
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
        <SettingsPrivacyCard icon={<ShieldCheck aria-hidden="true" />} title="Sandboxed artifacts" description="Generated pages run without Tauri IPC and cannot reach provider tokens." />
        <SettingsPrivacyCard icon={<LockKeyhole aria-hidden="true" />} title="Profile-scoped identity" description="Codex and provider connections belong to a browser profile, not an individual tab." />
      </div>
    </>
  );
}

function AboutSettings() {
  const services = useBrowserServices();
  const [query, setQuery] = useState("");
  return (
    <>
      <SettingsHeading eyebrow={`VibeSurfer ${thirdPartyNotices.appVersion}`} title="About & Licenses" description="The browser, generation sidecar, packaged fonts, icon collections, and built-in capability renderers are distributed with the notices below." />
      <SettingsGroup title="Open-source software">
        <SettingsLicenses
          notices={thirdPartyNotices.notices}
          query={query}
          onQueryChange={setQuery}
          summary={(visibleCount, totalCount) => `Showing ${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} packaged notices. Font files are distributed under the SIL Open Font License 1.1.`}
          onOpenSource={(notice: SettingsLicenseNotice) => void services.external.open(notice.source)}
        />
      </SettingsGroup>
    </>
  );
}

function GeneralSettings() {
  return (
    <>
      <SettingsHeading eyebrow="vibesurfer" title="General" description="Startup and everyday browser behavior." />
      <PreferenceSwitchRow title="Restore the previous session" description="Continue with the same tabs after restart." preference="reopenSession" />
      <SettingsGroup title="Home page"><div className="readonly-field">vibe://new-tab</div></SettingsGroup>
    </>
  );
}

function testSystemVoice(speed: number) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance("Hallunet voice preview. Playback begins only after you press Play.");
  utterance.rate = speed;
  window.speechSynthesis.speak(utterance);
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

function PreferenceSwitchRow({ title, description, preference }: { title: string; description: string; preference: "animations" | "reopenSession" }) {
  const value = useBrowserStore((state) => state.preferences[preference]);
  const patchPreferences = useBrowserStore((state) => state.patchPreferences);
  return (
    <SettingSwitchRow
      title={title}
      description={description}
      checked={value}
      onCheckedChange={(checked) => patchPreferences({ [preference]: checked })}
    />
  );
}
