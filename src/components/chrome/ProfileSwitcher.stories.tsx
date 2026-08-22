import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PROFILES } from "../../data/catalog";
import type { BrowserProfile } from "../../types/browser";
import type { BrowserControlAction } from "./browser-control-contracts";
import { ProfileSwitcher } from "./ProfileSwitcher";

const QUIET_PROFILE: BrowserProfile = {
  id: "quiet",
  name: "Quiet",
  avatar: "Q",
  caption: "Calm research workspace",
  chromeSkin: "sedative",
  worldPrompt: { revision: 2, vibe: "Quiet and focused", prompt: "Prefer calm editorial surfaces." },
  createdAt: "2026-08-20T00:00:00.000Z",
};
const switchProfile = fn();
const openProfiles = fn();
const openSettings = fn();

const action = (
  id: BrowserControlAction["id"],
  label: string,
  onExecute: () => void,
  shortcut?: string,
): BrowserControlAction => ({ id, label, enabled: true, shortcut, onExecute });

const meta = {
  title: "Components/Browser controls/ProfileSwitcher",
  component: ProfileSwitcher,
  decorators: [(Story) => <div className="story-surface story-surface--controls"><div className="story-control-frame story-control-frame--compact"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Controlled profile switcher. Profile state and settings navigation remain host-owned browser actions." } },
  },
  args: {
    profiles: [...PROFILES, QUIET_PROFILE],
    activeProfileId: "personal",
    profileSettings: action("open-profiles", "Profiles", openProfiles),
    browserSettings: action("open-settings", "Settings", openSettings, "⌘,"),
    onProfileChange: switchProfile,
  },
} satisfies Meta<typeof ProfileSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Profile: Personal" }));
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "Profile: Personal" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Quiet/ }));
    await expect(args.onProfileChange).toHaveBeenCalledWith("quiet");
  },
};

export const OpenMenu: Story = {
  args: { defaultOpen: true },
  globals: { theme: "sedative" },
};

export const SettingsCommands: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement, args }) => {
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "Profile: Personal" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Settings ⌘," }));
    await expect(args.browserSettings.onExecute).toHaveBeenCalledOnce();
  },
};

export const SingleProfile: Story = {
  args: { profiles: PROFILES, defaultOpen: true },
  globals: { theme: "ie-classic" },
};
