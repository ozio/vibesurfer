import { Fragment, useId, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronRight, KeyRound, MonitorCog, RefreshCw, SearchX, Trash2, type LucideIcon } from "lucide-react";
import { RadioGroup, Switch as RadixSwitch } from "radix-ui";
import { Button, ConfirmDialog, EmptyState, IconButton, SearchField } from "../ui";

export interface SettingsSectionItem {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords?: readonly string[];
}

export function filterSettingsSections<T extends SettingsSectionItem>(sections: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...sections];
  return sections.filter((section) => [section.label, section.id, ...(section.keywords ?? [])]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery));
}

export interface SettingsShellProps {
  sections: readonly SettingsSectionItem[];
  activeSectionId: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSectionChange: (sectionId: string) => void;
  children: ReactNode;
  title?: string;
  searchPlaceholder?: string;
  className?: string;
}

export function SettingsShell({
  sections,
  activeSectionId,
  query,
  onQueryChange,
  onSectionChange,
  children,
  title = "Settings",
  searchPlaceholder = "Search settings",
  className = "",
}: SettingsShellProps) {
  return (
    <div className={`settings-page settings-shell ${className}`.trim()}>
      <SettingsSidebar
        title={title}
        sections={sections}
        activeSectionId={activeSectionId}
        query={query}
        searchPlaceholder={searchPlaceholder}
        onQueryChange={onQueryChange}
        onSectionChange={onSectionChange}
      />
      <main className="settings-content" aria-label={`${title} content`}>
        {children}
      </main>
    </div>
  );
}

export interface SettingsSidebarProps extends Omit<SettingsShellProps, "children" | "className"> {}

export function SettingsSidebar({
  title = "Settings",
  sections,
  activeSectionId,
  query,
  searchPlaceholder = "Search settings",
  onQueryChange,
  onSectionChange,
}: SettingsSidebarProps) {
  const visibleSections = filterSettingsSections(sections, query);
  const resultsId = useId();
  const openSection = (sectionId: string) => {
    onSectionChange(sectionId);
    onQueryChange("");
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      onQueryChange("");
    }
    if (event.key === "Enter" && visibleSections[0]) {
      event.preventDefault();
      openSection(visibleSections[0].id);
    }
  };

  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__title"><MonitorCog aria-hidden="true" /><strong>{title}</strong></div>
      <SearchField
        label={`Search ${title.toLocaleLowerCase()}`}
        hideLabel
        value={query}
        placeholder={searchPlaceholder}
        aria-controls={resultsId}
        className="settings-search"
        onValueChange={onQueryChange}
        onKeyDown={handleSearchKeyDown}
      />
      <nav aria-label={`${title} sections`}>
        <div id={resultsId} className="settings-section-results" aria-live="polite">
          {visibleSections.map((section) => {
            const Icon = section.icon;
            const active = section.id === activeSectionId;
            return (
              <a
                key={section.id}
                href={`/settings/${section.id}`}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  openSection(section.id);
                }}
              >
                <Icon aria-hidden="true" /><span>{section.label}</span><ChevronRight aria-hidden="true" />
              </a>
            );
          })}
          {visibleSections.length === 0 && <SettingsSearchEmpty query={query} />}
        </div>
      </nav>
    </aside>
  );
}

export interface SettingsSearchEmptyProps {
  query?: string;
  message?: string;
}

export function SettingsSearchEmpty({ query, message }: SettingsSearchEmptyProps) {
  return (
    <p className="settings-search__empty" role="status">
      {message ?? (query ? `No settings match “${query}”` : "No matching settings")}
    </p>
  );
}

export interface SettingsHeadingProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function SettingsHeading({ eyebrow, title, description, actions }: SettingsHeadingProps) {
  return (
    <header className="settings-heading">
      <span>{eyebrow}</span>
      <div className="settings-heading__title"><h1>{title}</h1>{actions}</div>
      {description && <p>{description}</p>}
    </header>
  );
}

export interface SettingsGroupProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsGroup({ title, description, actions, children, className = "" }: SettingsGroupProps) {
  return (
    <section className={`settings-group ${className}`.trim()}>
      {(title || description || actions) && (
        <header className="settings-group__heading">
          <span>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</span>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SettingRow({ title, description, action, children, disabled = false, className = "" }: SettingRowProps) {
  return (
    <div className={`setting-row${disabled ? " is-disabled" : ""} ${className}`.trim()}>
      <span className="setting-row__copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      {children}
      {action && <span className="setting-row__action">{action}</span>}
    </div>
  );
}

export interface SettingSwitchRowProps {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  showState?: boolean;
  className?: string;
}

export function SettingSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  showState = true,
  className = "",
}: SettingSwitchRowProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={`setting-row setting-switch-row${disabled ? " is-disabled" : ""} ${className}`.trim()}>
      <span className="setting-row__copy">
        <label htmlFor={id}><strong>{title}</strong></label>
        {description && <small id={descriptionId}>{description}</small>}
      </span>
      {showState && <span className="setting-row__state" aria-hidden="true">{checked ? "On" : "Off"}</span>}
      <RadixSwitch.Root
        id={id}
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId}
        onCheckedChange={onCheckedChange}
      >
        <RadixSwitch.Thumb className="switch__thumb" />
      </RadixSwitch.Root>
    </div>
  );
}

export interface SettingsLayoutOption {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  preview?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SettingsLayoutOptionsProps {
  label: string;
  options: readonly SettingsLayoutOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SettingsLayoutOptions({ label, options, value, onValueChange, className = "" }: SettingsLayoutOptionsProps) {
  return (
    <RadioGroup.Root
      className={`layout-options ${className}`.trim()}
      aria-label={label}
      value={value}
      orientation="horizontal"
      onValueChange={onValueChange}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={option.value === value ? "is-active" : undefined}
        >
          {option.preview ?? option.icon}
          <span><strong>{option.title}</strong>{option.description && <small>{option.description}</small>}</span>
          {option.value === value && <Check aria-hidden="true" />}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export interface SettingsConnectionCardProps {
  title: ReactNode;
  description: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SettingsConnectionCard({ title, description, icon, action, className = "" }: SettingsConnectionCardProps) {
  return (
    <section className={`connection-card settings-connection-card ${className}`.trim()}>
      <span className="connection-card__mark" aria-hidden="true">{icon}</span>
      <span><strong>{title}</strong><small>{description}</small></span>
      {action}
    </section>
  );
}

export type SettingsRuntimeState = "ready" | "checking" | "unavailable" | "preview";

export interface SettingsRuntimeCardProps {
  state: SettingsRuntimeState;
  title: ReactNode;
  description: ReactNode;
}

export function SettingsRuntimeCard({ state, title, description }: SettingsRuntimeCardProps) {
  return (
    <div className={`runtime-strip settings-runtime-card settings-runtime-card--${state}`} aria-label="Generation runtime status">
      <span className={state === "ready" || state === "preview" ? "is-ready" : undefined} />
      <strong>{title}</strong>
      <small>{description}</small>
    </div>
  );
}

export interface SettingsChoiceCardProps {
  title: ReactNode;
  description?: ReactNode;
  leading: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  className?: string;
}

function SettingsChoiceCard({ title, description, leading, trailing, selected = false, disabled = false, onSelect, className = "" }: SettingsChoiceCardProps) {
  return (
    <button
      type="button"
      className={`${selected ? "is-active " : ""}${className}`.trim()}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {leading}
      <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
      {trailing ?? (selected ? <Check aria-hidden="true" /> : null)}
    </button>
  );
}

export interface SettingsModelCardProps extends Omit<SettingsChoiceCardProps, "leading"> {
  icon: ReactNode;
}

export function SettingsModelCard({ icon, ...props }: SettingsModelCardProps) {
  return <SettingsChoiceCard {...props} className={`settings-model-card ${props.className ?? ""}`.trim()} leading={<span className="settings-model-list__icon">{icon}</span>} />;
}

export interface SettingsProfileCardProps extends Omit<SettingsChoiceCardProps, "leading"> {
  avatar: ReactNode;
}

export function SettingsProfileCard({ avatar, ...props }: SettingsProfileCardProps) {
  return <SettingsChoiceCard {...props} className={`settings-profile-card ${props.className ?? ""}`.trim()} leading={<span className="avatar avatar--large">{avatar}</span>} />;
}

export type SettingsProviderStatus = "valid" | "invalid" | "unreachable" | "unknown";

export interface SettingsProviderCardProps {
  name: string;
  description: ReactNode;
  status: SettingsProviderStatus;
  busy?: boolean;
  mode?: "compact" | "directed";
  modeLabel?: string;
  onModeChange?: (mode: "compact" | "directed") => void;
  onVerify: () => void;
  onRemove: () => void;
}

export function SettingsProviderCard({
  name,
  description,
  status,
  busy = false,
  mode,
  modeLabel = `Compatibility check for ${name}`,
  onModeChange,
  onVerify,
  onRemove,
}: SettingsProviderCardProps) {
  return (
    <article className="provider-row settings-provider-card">
      <span className={`provider-row__status provider-row__status--${status}`} aria-hidden="true" />
      <span><strong>{name}</strong><small>{description}<span className="sr-only"> Connection status: {status}.</span></small></span>
      {mode && onModeChange && (
        <select
          className="provider-row__mode"
          aria-label={modeLabel}
          value={mode}
          disabled={busy}
          onChange={(event) => onModeChange(event.currentTarget.value as "compact" | "directed")}
        >
          <option value="compact">Plain text verify</option>
          <option value="directed">Structured verify</option>
        </select>
      )}
      <Button size="small" leadingIcon={<RefreshCw aria-hidden="true" />} loading={busy} onClick={onVerify}>Verify</Button>
      <IconButton size="small" variant="danger" label={`Remove ${name}`} disabled={busy} onClick={onRemove}><Trash2 aria-hidden="true" /></IconButton>
    </article>
  );
}

export interface SettingsProviderEmptyProps {
  title?: ReactNode;
  description?: ReactNode;
}

export function SettingsProviderEmpty({
  title = "No provider keys in this profile",
  description = "Keys are stored in the operating-system credential vault—not localStorage.",
}: SettingsProviderEmptyProps) {
  return <div className="provider-list__empty"><KeyRound aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span></div>;
}

export interface SettingsArchitectureNode {
  label: ReactNode;
  title: ReactNode;
}

export interface SettingsArchitectureCardProps {
  nodes: readonly SettingsArchitectureNode[];
  connector?: ReactNode;
  label?: string;
}

export function SettingsArchitectureCard({ nodes, connector = <ChevronRight aria-hidden="true" />, label = "Browser architecture" }: SettingsArchitectureCardProps) {
  return (
    <section className="architecture-card settings-architecture-card" aria-label={label}>
      {nodes.map((node, index) => (
        <Fragment key={`${String(node.label)}-${index}`}>
          {index > 0 && connector}
          <div><span>{node.label}</span><strong>{node.title}</strong></div>
        </Fragment>
      ))}
    </section>
  );
}

export interface SettingsPrivacyCardProps {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}

export function SettingsPrivacyCard({ icon, title, description }: SettingsPrivacyCardProps) {
  return <article className="settings-privacy-card">{icon}<h2>{title}</h2><p>{description}</p></article>;
}

export interface SettingsDangerActionProps {
  title: string;
  description: ReactNode;
  actionLabel: string;
  dialogTitle: ReactNode;
  dialogDescription: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

export function SettingsDangerAction({
  title,
  description,
  actionLabel,
  dialogTitle,
  dialogDescription,
  confirmLabel = actionLabel,
  disabled = false,
  onConfirm,
}: SettingsDangerActionProps) {
  return (
    <SettingRow
      title={title}
      description={description}
      disabled={disabled}
      action={(
        <ConfirmDialog
          trigger={<Button variant="danger" size="small" disabled={disabled}>{actionLabel}</Button>}
          title={dialogTitle}
          description={dialogDescription}
          confirmLabel={confirmLabel}
          destructive
          disabled={disabled}
          onConfirm={onConfirm}
        />
      )}
    />
  );
}

export interface SettingsLicenseNotice {
  id: string;
  name: string;
  version: string;
  license: string;
  source: string;
  surfaces: readonly string[];
}

export function filterSettingsLicenses<T extends SettingsLicenseNotice>(notices: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...notices];
  return notices.filter((notice) => [notice.name, notice.version, notice.license, ...notice.surfaces]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery));
}

export interface SettingsLicensesProps {
  notices: readonly SettingsLicenseNotice[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenSource: (notice: SettingsLicenseNotice) => void;
  summary?: ReactNode | ((visibleCount: number, totalCount: number) => ReactNode);
}

export function SettingsLicenses({ notices, query, onQueryChange, onOpenSource, summary }: SettingsLicensesProps) {
  const visibleNotices = filterSettingsLicenses(notices, query);
  return (
    <div className="settings-licenses">
      <SearchField
        label="Search open-source notices"
        hideLabel
        value={query}
        placeholder={`Search ${notices.length.toLocaleString()} notices`}
        className="license-search"
        onValueChange={onQueryChange}
      />
      <p className="license-summary">
        {typeof summary === "function"
          ? summary(visibleNotices.length, notices.length)
          : summary ?? `Showing ${visibleNotices.length.toLocaleString()} of ${notices.length.toLocaleString()} packaged notices.`}
      </p>
      <div className="license-list">
        {visibleNotices.map((notice) => (
          <article key={notice.id} className="license-row">
            <span><strong>{notice.name}</strong><small>{notice.version} · {notice.surfaces.join(" · ")}</small></span>
            <span className="license-row__meta"><code>{notice.license}</code><button type="button" onClick={() => onOpenSource(notice)}>Source</button></span>
          </article>
        ))}
        {visibleNotices.length === 0 && (
          <EmptyState
            className="settings-license-empty"
            icon={<SearchX aria-hidden="true" />}
            title="No matching library or license"
            description="Try a package name, version, license identifier, or packaged surface."
          />
        )}
      </div>
    </div>
  );
}
