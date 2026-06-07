/**
 * @file Standalone `versionHistory` i18n provider + the `AnvilkitMessages`
 * type augmentation.
 *
 * {@link VersionHistoryI18nProvider} wraps the standalone `./ui` subpath
 * (mounted outside `<Studio>`) so its `useMsg("versionHistory.*")` calls
 * resolve. Standalone mounts default to English; locale switching is a
 * Studio (in-chrome) feature. In-chrome usage needs no wrapper —
 * `register()` already contributes {@link VERSION_HISTORY_ENTRY}.
 */

import { EditorI18nProvider } from "@anvilkit/core/i18n";
import type { ReactNode } from "react";
// Classic-JSX build (React.createElement) — every .tsx must bind React or
// dist throws "React is not defined" at runtime (typecheck won't catch it).
import * as React from "react";

import { VERSION_HISTORY_ENTRY, type VersionHistoryMessageKey } from "./entry.js";

export function VersionHistoryI18nProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <EditorI18nProvider entries={[VERSION_HISTORY_ENTRY]}>
      {children}
    </EditorI18nProvider>
  );
}

// Augment the public key registry so `useT("versionHistory.*")` autocompletes.
declare module "@anvilkit/core/i18n" {
  interface AnvilkitMessages
    extends Record<VersionHistoryMessageKey, string> {}
}
