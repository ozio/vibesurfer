import { Check, ChevronDown, Settings, UserRoundCog } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useBrowserStore } from "../../store/browser-store";

export function ProfileMenu() {
  const profileId = useBrowserStore((state) => state.activeProfileId);
  const profiles = useBrowserStore((state) => state.profiles);
  const setProfile = useBrowserStore((state) => state.setProfile);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]!;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="profile-trigger" type="button" aria-label={`Profile: ${profile.name}`}>
          <span className="avatar">{profile.avatar}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu profile-menu" align="end" sideOffset={8} collisionPadding={10}>
          <div className="profile-menu__current">
            <span className="avatar avatar--large">{profile.avatar}</span>
            <span><strong>{profile.name}</strong><small>{profile.caption}</small></span>
          </div>
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Label className="menu__label">Browser profiles</DropdownMenu.Label>
          {profiles.map((item) => (
            <DropdownMenu.Item key={item.id} className="menu__item" onSelect={() => setProfile(item.id)}>
              <span className="avatar avatar--small">{item.avatar}</span>
              <span className="menu__item-copy"><strong>{item.name}</strong><small>{item.caption}</small></span>
              {item.id === profileId && <Check aria-hidden="true" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" onSelect={() => openSettings("profiles")}>
            <UserRoundCog aria-hidden="true" /><span>Profile settings…</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu__item" onSelect={() => openSettings("general")}>
            <Settings aria-hidden="true" /><span>Browser settings</span>
          </DropdownMenu.Item>
          <DropdownMenu.Arrow className="menu__arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
