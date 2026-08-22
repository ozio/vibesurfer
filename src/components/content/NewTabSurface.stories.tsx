import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BROWSER_EXPERIENCE_REGISTRY } from "../../browser/browser-experience-registry";
import {
  NewTabComposer,
  NewTabFooter,
  NewTabLuckyOutcome,
  NewTabRouteCard,
  NewTabSurface,
  type NewTabSurfaceProps,
} from "./NewTabSurface";

const submit = fn();
const lucky = fn();
const openActivity = fn();
const openRoute = fn();

const meta = {
  title: "Components/Content surfaces/New tab",
  component: NewTabSurface,
  subcomponents: { NewTabComposer, NewTabLuckyOutcome, NewTabRouteCard, NewTabFooter },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      story: { inline: false, height: "720px" },
      description: { component: "Controlled New Tab composition split into a single-purpose composer, lucky-result feedback, reusable route cards and footer. Theme-specific copy and routes come from the browser experience registry." },
    },
  },
  args: {
    portal: BROWSER_EXPERIENCE_REGISTRY.native.portal,
    searchName: "Google",
    address: "",
    animations: false,
    onAddressChange: fn(),
    onSubmit: submit,
    onLucky: lucky,
    onOpenActivity: openActivity,
    onOpenRoute: openRoute,
  },
  render: (args) => <ControlledNewTabStory {...args} />,
} satisfies Meta<typeof NewTabSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Native: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Enter a Hallunet address or search" });
    await userEvent.click(input);
    await userEvent.paste("impossible gardens");
    await expect(input).toHaveValue("impossible gardens");
    await userEvent.click(canvas.getByRole("button", { name: "Open address" }));
    await expect(args.onSubmit).toHaveBeenCalledWith("impossible gardens");
    await userEvent.click(canvas.getByRole("button", { name: /Door zero/ }));
    await expect(args.onOpenRoute).toHaveBeenCalledWith("library.atlas/rooms/door-zero");
  },
};

export const LuckyBusy: Story = {
  args: { luckyStatus: "busy" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Finding a route…" })).toBeDisabled();
  },
};

export const LuckyFailed: Story = {
  args: { luckyStatus: "failed", luckyMessage: "The discovery model returned an invalid route list." },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("invalid route list");
    await userEvent.click(canvas.getByRole("button", { name: "Open activity" }));
    await expect(args.onOpenActivity).toHaveBeenCalledOnce();
  },
};

export const Sedative: Story = {
  args: { portal: BROWSER_EXPERIENCE_REGISTRY.sedative.portal, searchName: "Quiet Search" },
  globals: { theme: "sedative" },
};

export const IEClassic: Story = {
  args: { portal: BROWSER_EXPERIENCE_REGISTRY["ie-classic"].portal, searchName: "MSN Search" },
  globals: { theme: "ie-classic" },
};

export const Cyberpunk: Story = {
  args: { portal: BROWSER_EXPERIENCE_REGISTRY.cyberpunk.portal, searchName: "Null Search", luckyStatus: "empty" },
  globals: { theme: "cyberpunk", scheme: "dark" },
};

function ControlledNewTabStory({ address: initialAddress, onAddressChange, onSubmit, onOpenRoute, ...args }: NewTabSurfaceProps) {
  const [address, setAddress] = useState(initialAddress);
  return (
    <NewTabSurface
      {...args}
      address={address}
      onAddressChange={(value) => { setAddress(value); onAddressChange(value); }}
      onSubmit={onSubmit}
      onOpenRoute={onOpenRoute}
    />
  );
}
