import type { ReactNode } from "react";

const menuItems = ["File", "Edit", "View", "Favorites", "Tools", "Help"];

export function ClassicMenuBar() {
  return (
    <div className="classic-menu-bar" aria-hidden="true">
      <span className="classic-rebar-grip" />
      <div className="classic-menu-bar__items">
        {menuItems.map((item) => <span key={item}>{item}</span>)}
      </div>
      <span className="classic-windows-mark">
        <i /><i /><i /><i />
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
        <span>Page <i>▾</i></span>
        <span>Safety <i>▾</i></span>
        <span>Tools <i>▾</i></span>
        <b>»</b>
      </div>
    </div>
  );
}
