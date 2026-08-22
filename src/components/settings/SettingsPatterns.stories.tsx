import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Bot,
  CircleUserRound,
  Columns3,
  Globe2,
  KeyRound,
  LockKeyhole,
  MonitorCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  SettingRow,
  SettingSwitchRow,
  SettingsArchitectureCard,
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
  type SettingsSectionItem,
} from "./SettingsPatterns";

const sections: readonly SettingsSectionItem[] = [
  { id: "general", label: "General", icon: Settings2, keywords: ["startup", "home"] },
  { id: "tabs", label: "Tabs", icon: Columns3, keywords: ["layout"] },
  { id: "generation", label: "Generation", icon: WandSparkles, keywords: ["capabilities"] },
  { id: "models", label: "Models & Codex", icon: Bot, keywords: ["credentials", "provider"] },
  { id: "profiles", label: "Profiles", icon: CircleUserRound, keywords: ["identity", "vibe"] },
  { id: "browser", label: "Web content", icon: Globe2, keywords: ["sandbox"] },
];

const sourceOpened = fn();
const dangerConfirmed = fn();
const providerVerified = fn();
const providerRemoved = fn();

const notices: SettingsLicenseNotice[] = [
  { id: "react", name: "React", version: "19.1.1", license: "MIT", source: "https://github.com/facebook/react", surfaces: ["frontend"] },
  { id: "radix", name: "Radix UI", version: "1.4.3", license: "MIT", source: "https://github.com/radix-ui/primitives", surfaces: ["frontend", "storybook"] },
  { id: "font", name: "Atkinson Hyperlegible", version: "1.0", license: "OFL-1.1", source: "https://brailleinstitute.org/freefont", surfaces: ["fonts"] },
];

const meta = {
  title: "Components/Settings/Patterns",
  component: SettingsShell,
  subcomponents: {
    SettingsHeading,
    SettingsGroup,
    SettingRow,
    SettingSwitchRow,
    SettingsLayoutOptions,
    SettingsModelCard,
    SettingsProfileCard,
    SettingsProviderCard,
    SettingsRuntimeCard,
    SettingsArchitectureCard,
    SettingsPrivacyCard,
    SettingsDangerAction,
    SettingsLicenses,
  },
  decorators: [(Story) => <div className="story-settings-frame"><Story /></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "Pure settings presentation patterns. Store access, host APIs, persistence, provider credentials, and destructive effects stay in connected application sections.",
      },
    },
  },
  args: {
    sections,
    activeSectionId: "general",
    query: "",
    onQueryChange: fn(),
    onSectionChange: fn(),
    children: <SettingsHeading eyebrow="VibeSurfer" title="General" />,
  },
} satisfies Meta<typeof SettingsShell>;

export default meta;
type Story = StoryObj<typeof meta>;

function ShellHarness({ initialQuery = "" }: { initialQuery?: string }) {
  const [activeSectionId, setActiveSectionId] = useState("general");
  const [query, setQuery] = useState(initialQuery);
  const current = sections.find((section) => section.id === activeSectionId) ?? sections[0]!;
  return (
    <SettingsShell
      sections={sections}
      activeSectionId={activeSectionId}
      query={query}
      onQueryChange={setQuery}
      onSectionChange={setActiveSectionId}
    >
      <SettingsHeading eyebrow="Browser settings" title={current.label} description={`Controlled ${current.label.toLocaleLowerCase()} section content.`} />
      <SettingsGroup title="Example group" description="The shell owns layout and navigation; connected sections own effects.">
        <SettingRow title="Reusable setting" description="Every row shares spacing, copy, actions, and theme tokens." action={<button className="button" type="button">Configure</button>} />
      </SettingsGroup>
    </SettingsShell>
  );
}

export const ShellAndSearch: Story = {
  render: () => <ShellHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("searchbox", { name: "Search settings" });
    await userEvent.type(search, "credentials");
    await expect(canvas.getByRole("link", { name: /Models & Codex/ })).toBeVisible();
    await expect(canvas.queryByRole("link", { name: /General/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("heading", { name: "Models & Codex", level: 1 })).toBeVisible();
    await expect(search).toHaveValue("");
  },
};

export const EmptySearch: Story = {
  render: () => <ShellHarness initialQuery="telepathy" />,
  globals: { theme: "ie-classic" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("No settings match “telepathy”");
    const search = canvas.getByRole("searchbox", { name: "Search settings" });
    search.focus();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("link", { name: /General/ })).toBeVisible();
  },
};

function RowsHarness() {
  const [animations, setAnimations] = useState(true);
  const [layout, setLayout] = useState("horizontal");
  return (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="Reusable rows" title="Behavior and layout" description="Controlled examples expose native and Radix semantics." />
      <SettingsGroup title="Boolean settings">
        <SettingSwitchRow title="Interface animations" description="Animate browser chrome and generated pages." checked={animations} onCheckedChange={setAnimations} />
        <SettingSwitchRow title="Managed by your organization" description="Disabled settings remain legible and announced." checked disabled onCheckedChange={() => undefined} />
      </SettingsGroup>
      <SettingsGroup title="Tab layout">
        <SettingsLayoutOptions
          label="Tab layout"
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: "horizontal", title: "Horizontal tabs", description: "Familiar and space-efficient", preview: <span className="layout-preview layout-preview--horizontal"><i /><i /><i /></span> },
            { value: "vertical", title: "Vertical tabs", description: "Readable titles and quick scanning", preview: <span className="layout-preview layout-preview--vertical"><i /><i /><i /></span> },
          ]}
        />
      </SettingsGroup>
    </div>
  );
}

export const RowsAndLayout: Story = {
  render: () => <RowsHarness />,
  globals: { theme: "sedative" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const animationSwitch = canvas.getByRole("switch", { name: "Interface animations" });
    await expect(animationSwitch).toBeChecked();
    await userEvent.click(animationSwitch);
    await expect(animationSwitch).not.toBeChecked();
    await userEvent.tab();
    const horizontal = canvas.getByRole("radio", { name: /Horizontal tabs/ });
    await expect(horizontal).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    const vertical = canvas.getByRole("radio", { name: /Vertical tabs/ });
    await expect(vertical).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(vertical).toBeChecked();
  },
};

function CardsHarness() {
  const [model, setModel] = useState("codex");
  const [profile, setProfile] = useState("personal");
  const [mode, setMode] = useState<"compact" | "directed">("compact");
  return (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="Connected choices" title="Models, profiles, and providers" />
      <SettingsRuntimeCard state="ready" title="Worker ready" description="Rust host and generation worker are available." />
      <SettingsGroup title="Default model">
        <div className="settings-model-list">
          <SettingsModelCard icon={<Sparkles />} title="Codex" description="System ChatGPT session" selected={model === "codex"} onSelect={() => setModel("codex")} />
          <SettingsModelCard icon={<MonitorCog />} title="Local demo" description="Deterministic preview provider" selected={model === "local"} onSelect={() => setModel("local")} />
          <SettingsModelCard icon={<KeyRound />} title="Unconfigured model" description="Bring your own key" disabled trailing={<em>Not configured</em>} onSelect={() => undefined} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Browser profiles">
        <div className="profile-settings-list">
          <SettingsProfileCard avatar="O" title="Personal" description="Native · prompt r3" selected={profile === "personal"} onSelect={() => setProfile("personal")} />
          <SettingsProfileCard avatar="Q" title="Quiet" description="Sedative · prompt r2" selected={profile === "quiet"} onSelect={() => setProfile("quiet")} />
        </div>
      </SettingsGroup>
      <SettingsGroup title="Bring your own key">
        <div className="provider-list">
          <SettingsProviderCard
            name="Local llama.cpp"
            description="openai-compatible · llama-3.3"
            status="valid"
            mode={mode}
            onModeChange={setMode}
            onVerify={providerVerified}
            onRemove={providerRemoved}
          />
          <SettingsProviderCard name="Anthropic work" description="anthropic · claude-sonnet" status="invalid" busy onVerify={() => undefined} onRemove={() => undefined} />
          <SettingsProviderEmpty />
        </div>
      </SettingsGroup>
    </div>
  );
}

export const ModelsProfilesAndProviders: Story = {
  render: () => <CardsHarness />,
  globals: { theme: "cyberpunk", scheme: "dark" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Local demo/ }));
    await expect(canvas.getByRole("button", { name: /Local demo/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: /Quiet/ }));
    await expect(canvas.getByRole("button", { name: /Quiet/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Compatibility check for Local llama.cpp" }), "directed");
    await expect(canvas.getByRole("combobox", { name: "Compatibility check for Local llama.cpp" })).toHaveValue("directed");
    await userEvent.click(canvas.getAllByRole("button", { name: "Verify" })[0]!);
    await expect(providerVerified).toHaveBeenCalled();
  },
};

export const RuntimeStates: Story = {
  render: () => (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="Host boundary" title="Runtime states" />
      <SettingsRuntimeCard state="ready" title="Worker ready" description="Generation is available." />
      <SettingsRuntimeCard state="checking" title="Checking worker…" description="The host is loading runtime status." />
      <SettingsRuntimeCard state="unavailable" title="Worker unavailable" description="Build the generation worker to enable providers." />
      <SettingsRuntimeCard state="preview" title="Browser preview runtime" description="Deterministic and network-free." />
    </div>
  ),
};

export const PrivacyAndArchitecture: Story = {
  render: () => (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="Boundaries" title="Web content and privacy" description="Architecture is documented as data, not theme-specific markup." />
      <SettingsArchitectureCard nodes={[
        { label: "React chrome", title: "Tabs, omnibox, menus" },
        { label: "Page surface", title: "Opaque sandboxed iframe" },
        { label: "Host bridge", title: "Validated messages only" },
      ]} />
      <div className="privacy-grid">
        <SettingsPrivacyCard icon={<ShieldCheck aria-hidden="true" />} title="Sandboxed artifacts" description="Generated pages cannot reach provider tokens." />
        <SettingsPrivacyCard icon={<LockKeyhole aria-hidden="true" />} title="Profile-scoped identity" description="Connections belong to a browser profile." />
      </div>
    </div>
  ),
  globals: { theme: "ie-classic" },
};

export const DangerActions: Story = {
  render: () => (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="Profile data" title="Danger zone" />
      <SettingsGroup title="Destructive actions">
        <SettingsDangerAction
          title="Start profile from scratch"
          description="Archives active SiteWorlds and closes every tab."
          actionLabel="Start from scratch"
          dialogTitle="Start this profile from scratch?"
          dialogDescription="History and static artifacts are preserved."
          confirmLabel="Archive and restart"
          onConfirm={dangerConfirmed}
        />
        <SettingsDangerAction
          title="Delete the last profile"
          description="The last profile cannot be deleted."
          actionLabel="Delete profile"
          dialogTitle="Delete profile?"
          dialogDescription="This action cannot be undone."
          disabled
          onConfirm={() => undefined}
        />
      </SettingsGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Delete profile" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Start from scratch" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("alertdialog", { name: "Start this profile from scratch?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Archive and restart" }));
    await expect(dangerConfirmed).toHaveBeenCalled();
  },
};

function LicensesHarness({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <div className="story-settings-patterns">
      <SettingsHeading eyebrow="VibeSurfer 0.1.0" title="About & Licenses" />
      <SettingsGroup title="Open-source software">
        <SettingsLicenses notices={notices} query={query} onQueryChange={setQuery} onOpenSource={sourceOpened} />
      </SettingsGroup>
    </div>
  );
}

export const Licenses: Story = {
  render: () => <LicensesHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("searchbox", { name: "Search open-source notices" });
    await userEvent.type(search, "OFL");
    await expect(canvas.getByText("Atkinson Hyperlegible")).toBeVisible();
    await expect(canvas.queryByText("React")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Source" }));
    await expect(sourceOpened).toHaveBeenCalledWith(expect.objectContaining({ id: "font" }));
  },
};

export const EmptyLicenses: Story = {
  render: () => <LicensesHarness initialQuery="proprietary" />,
  globals: { theme: "sedative" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No matching library or license")).toBeVisible();
  },
};
