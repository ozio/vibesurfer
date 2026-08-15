import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Tooltip } from "radix-ui";
import { BrowserApp } from "./app/BrowserApp";
import { startDeepLinkRuntime } from "./app/deep-link-runtime";
import { startNativeMenuRuntime } from "./app/native-menu-runtime";
import "./styles/app.css";

void startDeepLinkRuntime();
void startNativeMenuRuntime();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
        <BrowserApp />
      </Tooltip.Provider>
    </MemoryRouter>
  </StrictMode>,
);
