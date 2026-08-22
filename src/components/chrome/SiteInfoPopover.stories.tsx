import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "../ui/Button";
import { SiteInfoPopover } from "./SiteInfoPopover";

const meta = {
  title: "Components/Chrome/SiteInfoPopover",
  component: SiteInfoPopover,
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A store-free explanation of the current browser coordinate and its isolation boundary. It reuses the shared Popover primitive, including its controlled/open API and unique accessible title ID.",
      },
    },
  },
  args: {
    information: {
      title: "Hallunet address",
      status: "Discovered route · isolated locally",
      location: "https://quiet.vibe/ideas",
      note: "This route continues inside the Hallunet and cannot contact the live web.",
    },
    trigger: <Button>Site information</Button>,
    onOpenChange: fn(),
  },
  decorators: [(Story) => <div className="story-site-info-frame"><Story /></div>],
} satisfies Meta<typeof SiteInfoPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GeneratedLocalRoute: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Site information" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Hallunet address" });
    await expect(dialog).toHaveTextContent("isolated locally");
    await expect(args.onOpenChange).toHaveBeenCalledWith(true);
  },
};

export const UnresolvedExternalAddress: Story = {
  args: {
    information: {
      title: "Unresolved address",
      status: "Outside network · not connected",
      location: "https://example.com/",
      note: "This coordinate remains isolated. External sites open only in your system browser.",
    },
    defaultOpen: true,
  },
};

export const LocalSettings: Story = {
  args: {
    information: {
      title: "Local settings",
      status: "vibesurfer · local interface",
      location: "vibe://settings/profiles",
      note: "This gateway is local and does not contact the live web.",
    },
    defaultOpen: true,
  },
};
