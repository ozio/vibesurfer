import type { ReactNode } from "react";

const menuItems = ["File", "Edit", "View", "Favorites", "Tools", "Help"] as const;

export function ClassicMenuBar() {
  return (
    <div className="classic-menu-bar" aria-hidden="true">
      <span className="classic-rebar-grip" />
      <div className="classic-menu-bar__items">
        {menuItems.map((item) => <span className={`classic-menu-bar__item classic-menu-bar__item--${item.toLowerCase()}`} key={item}>{item}</span>)}
      </div>
      <span className="classic-windows-mark">
        <i className="classic-windows-mark__pane classic-windows-mark__pane--red" />
        <i className="classic-windows-mark__pane classic-windows-mark__pane--green" />
        <i className="classic-windows-mark__pane classic-windows-mark__pane--blue" />
        <i className="classic-windows-mark__pane classic-windows-mark__pane--yellow" />
      </span>
    </div>
  );
}

export function ClassicTabBar({ children }: { children: ReactNode }) {
  return (
    <div className="classic-tab-row">
      <span className="classic-rebar-grip" aria-hidden="true" />
      {children}
      <div className="classic-command-bar" aria-hidden="true">
        <span className="classic-command-bar__item classic-command-bar__item--page">Page <i>▾</i></span>
        <span className="classic-command-bar__item classic-command-bar__item--safety">Safety <i>▾</i></span>
        <span className="classic-command-bar__item classic-command-bar__item--tools">Tools <i>▾</i></span>
        <b>»</b>
      </div>
    </div>
  );
}
