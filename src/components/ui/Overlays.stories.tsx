import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, MoreHorizontal, Pencil, Settings, Trash2 } from "lucide-react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "./Button";
import { ContextMenu as UiContextMenu, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "./ContextMenu";
import { ConfirmDialog as UiConfirmDialog, Dialog as UiDialog } from "./Dialog";
import { Menu as UiMenu, MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { Popover as UiPopover } from "./Popover";
import { Tooltip as UiTooltip } from "./Tooltip";

const menuAction = fn();
const contextAction = fn();
const confirmAction = fn();

const meta = {
  title: "Components/UI/Overlays",
  component: UiTooltip,
  subcomponents: { Popover: UiPopover, Menu: UiMenu, ContextMenu: UiContextMenu, Dialog: UiDialog, ConfirmDialog: UiConfirmDialog },
  decorators: [(Story) => <div className="story-surface story-surface--column"><Story /></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Shared floating surfaces delegate focus trapping, dismissal, collision handling, menu navigation, and alert-dialog semantics to Radix while preserving the browser theme token contract." } },
  },
  args: { content: "Keyboard shortcut", children: <button type="button">Hover me</button> },
} satisfies Meta<typeof UiTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tooltip: Story = {
  render: () => (
    <div className="story-component-row">
      <UiTooltip content="Open settings"><Button leadingIcon={<Settings aria-hidden="true" />}>Hover or focus</Button></UiTooltip>
      <UiTooltip content="Always visible" defaultOpen><Button>Open state</Button></UiTooltip>
      <UiTooltip content="Never shown" disabled><Button disabled>Disabled</Button></UiTooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByRole("button", { name: "Hover or focus" }));
    await expect(await within(canvasElement.ownerDocument.body).findByRole("tooltip", { name: "Open settings" })).toHaveTextContent("Open settings");
  },
};

export const Popover: Story = {
  render: () => (
    <UiPopover
      trigger={<Button>Site details</Button>}
      title="Generated locally"
      description="This page cannot access the network."
      footer={<Button size="small" variant="primary">Got it</Button>}
    >
      The content is rendered inside an isolated browser surface and inherits no application credentials.
    </UiPopover>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Site details" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Generated locally")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByText("Generated locally")).not.toBeInTheDocument());
  },
};

export const Menu: Story = {
  render: () => (
    <UiMenu trigger={<Button trailingIcon={<MoreHorizontal aria-hidden="true" />}>Page actions</Button>} ariaLabel="Page actions">
      <MenuLabel>Page</MenuLabel>
      <MenuItem onSelect={menuAction}><Pencil aria-hidden="true" /><span>Rename</span></MenuItem>
      <MenuItem shortcut="⌘D"><Copy aria-hidden="true" /><span>Duplicate</span></MenuItem>
      <MenuCheckboxItem checked>Show status bar</MenuCheckboxItem>
      <MenuSeparator />
      <MenuItem destructive><Trash2 aria-hidden="true" /><span>Delete</span></MenuItem>
    </UiMenu>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "Page actions" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const item = await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "Rename" });
    await expect(item).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(menuAction).toHaveBeenCalledOnce();
  },
};

export const ContextMenu: Story = {
  render: () => (
    <UiContextMenu
      content={(
        <>
          <ContextMenuLabel>Tab</ContextMenuLabel>
          <ContextMenuItem onSelect={contextAction}>Reload</ContextMenuItem>
          <ContextMenuItem shortcut="⌘L">Copy address</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive>Close tab</ContextMenuItem>
        </>
      )}
    >
      <div className="story-context-target" tabIndex={0}>Right-click this browser tab</div>
    </UiContextMenu>
  ),
  play: async ({ canvasElement }) => {
    const target = within(canvasElement).getByText("Right-click this browser tab");
    await userEvent.pointer({ target, keys: "[MouseRight]" });
    const reload = await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "Reload" });
    await userEvent.click(reload);
    await expect(contextAction).toHaveBeenCalledOnce();
  },
};

export const Dialog: Story = {
  render: () => (
    <UiDialog
      trigger={<Button>Edit profile</Button>}
      title="Profile settings"
      description="Changes apply only to this browsing identity."
      footer={<><Button>Cancel</Button><Button variant="primary">Save profile</Button></>}
    >
      Dialog content can contain any field or reusable browser primitive.
    </UiDialog>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Edit profile" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("dialog", { name: "Profile settings" })).toHaveAttribute("data-state", "open");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog", { name: "Profile settings" })).not.toBeInTheDocument());
  },
};

export const ConfirmDialog: Story = {
  render: () => (
    <UiConfirmDialog
      trigger={<Button variant="danger">Delete history</Button>}
      title="Delete all history?"
      description="This action cannot be undone. Saved sites are not affected."
      confirmLabel="Delete history"
      destructive
      onConfirm={confirmAction}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete history" }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("alertdialog", { name: "Delete all history?" });
    await expect(dialog).toHaveAttribute("data-state", "open");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete history" }));
    await expect(confirmAction).toHaveBeenCalledOnce();
  },
};
