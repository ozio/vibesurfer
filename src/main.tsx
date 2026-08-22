import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Tooltip } from "radix-ui";
import { BrowserApp } from "./app/BrowserApp";
import { startDeepLinkRuntime } from "./app/deep-link-runtime";
import { startNativeMenuRuntime } from "./app/native-menu-runtime";
import { createBrowserServices } from "./browser/browser-service-adapters";
import { BrowserServicesProvider } from "./browser/browser-services";
import "./styles/app.css";

const browserServices = createBrowserServices();

void startDeepLinkRuntime();
void startNativeMenuRuntime(browserServices);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserServicesProvider services={browserServices}>
      <MemoryRouter>
        <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
          <BrowserApp />
        </Tooltip.Provider>
      </MemoryRouter>
    </BrowserServicesProvider>
  </StrictMode>,
);
