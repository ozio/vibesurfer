import { Check, ChevronDown, Settings, UserRoundCog } from "lucide-react";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserProfile } from "../../types/browser";
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from "../ui/Menu";
import {
  browserControlAction,
  type BrowserControlAction,
} from "./browser-control-contracts";

export interface ProfileSwitcherProps {
  profiles: readonly BrowserProfile[];
  activeProfileId: string;
  profileSettings: BrowserControlAction;
  browserSettings: BrowserControlAction;
  onProfileChange: (profileId: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProfileSwitcher({
  profiles,
  activeProfileId,
  profileSettings,
  browserSettings,
  onProfileChange,
  ...menuProps
}: ProfileSwitcherProps) {
  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0];
  if (!profile) return null;

  return (
    <Menu
      {...menuProps}
      ariaLabel="Browser profiles"
      sideOffset={8}
      className="profile-menu"
      trigger={(
        <button className="profile-trigger" type="button" aria-label={`Profile: ${profile.name}`}>
          <span className="avatar">{profile.avatar}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      )}
    >
      <div className="profile-menu__current">
        <span className="avatar avatar--large">{profile.avatar}</span>
        <span><strong>{profile.name}</strong><small>{profile.caption}</small></span>
      </div>
      <MenuSeparator />
      <MenuLabel>Browser profiles</MenuLabel>
      {profiles.map((item) => (
        <MenuItem key={item.id} onSelect={() => onProfileChange(item.id)}>
          <span className="avatar avatar--small">{item.avatar}</span>
          <span className="menu__item-copy"><strong>{item.name}</strong><small>{item.caption}</small></span>
          {item.id === activeProfileId && <Check aria-hidden="true" />}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem disabled={!profileSettings.enabled} onSelect={profileSettings.onExecute}>
        <UserRoundCog aria-hidden="true" /><span>{profileSettings.label}</span>
      </MenuItem>
      <MenuItem
        disabled={!browserSettings.enabled}
        shortcut={browserSettings.shortcut}
        onSelect={browserSettings.onExecute}
      >
        <Settings aria-hidden="true" /><span>{browserSettings.label}</span>
      </MenuItem>
    </Menu>
  );
}

export function ConnectedProfileSwitcher() {
  const profileId = useBrowserStore((state) => state.activeProfileId);
  const profiles = useBrowserStore((state) => state.profiles);
  const setProfile = useBrowserStore((state) => state.setProfile);
  const openProfiles = useBrowserCommand("open-profiles");
  const openSettings = useBrowserCommand("open-settings");

  return (
    <ProfileSwitcher
      profiles={profiles}
      activeProfileId={profileId}
      profileSettings={browserControlAction(openProfiles)}
      browserSettings={browserControlAction(openSettings)}
      onProfileChange={setProfile}
    />
  );
}
