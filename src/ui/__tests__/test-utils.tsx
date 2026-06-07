import {
  render as rtlRender,
  type RenderOptions,
} from "@testing-library/react";
// Classic-JSX build (React.createElement) — every .tsx must bind React.
import * as React from "react";

import { VersionHistoryI18nProvider } from "../../i18n/provider.js";

/**
 * Wraps every render in the plugin's own i18n provider so standalone `./ui`
 * components resolve `versionHistory.*` message keys to their English
 * baseline — exactly as they do when mounted outside the Studio chrome.
 * Without it `useMsg()` falls back to the bare key (no catalog), and any
 * assertion on user-facing text fails.
 */
function Wrapper({ children }: { children: React.ReactNode }) {
  return <VersionHistoryI18nProvider>{children}</VersionHistoryI18nProvider>;
}

function render(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the rest of RTL; the explicit `render` below shadows RTL's.
export * from "@testing-library/react";
export { render };
