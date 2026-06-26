/** @vitest-environment jsdom */

import { createFakePageIR } from "@anvilkit/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inMemoryAdapter } from "../../adapters/in-memory.js";
import { VersionHistoryUI } from "../VersionHistoryUI.js";
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils.js";

// `@anvilkit/vitest-config` runs with `globals: false`, so RTL's automatic
// per-test cleanup is off — both tests reuse the same labels, so tear the
// previous render's DOM down explicitly to keep `getByRole` unambiguous.
afterEach(cleanup);

function makeIR(headline: string) {
  return createFakePageIR({
    children: [{ id: "hero-1", type: "Hero", props: { headline } }],
  });
}

function restoreButton() {
  return screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement;
}

async function saveOpenAndEnableRestore(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));
  fireEvent.change(screen.getByLabelText("Label"), {
    target: { value: label },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  fireEvent.click(await screen.findByRole("listitem", { name: /Snapshot/i }));
  await screen.findByRole("dialog");

  await waitFor(() => {
    expect(restoreButton().disabled).toBe(false);
  });
}

describe("VersionHistoryUI optimistic-concurrency restore", () => {
  it("routes to onConflict (not onRestore) when the document drifts while the modal is open", async () => {
    const adapter = inMemoryAdapter();
    const baseIR = makeIR("Snapshot");
    const onRestore = vi.fn();
    const onConflict = vi.fn();

    const { rerender } = render(
      <VersionHistoryUI
        adapter={adapter}
        currentIR={baseIR}
        onConflict={onConflict}
        onRestore={onRestore}
      />,
    );

    await saveOpenAndEnableRestore("Snapshot");

    // The document changes underneath while the diff modal is open.
    const driftedIR = makeIR("Edited by a collaborator");
    rerender(
      <VersionHistoryUI
        adapter={adapter}
        currentIR={driftedIR}
        onConflict={onConflict}
        onRestore={onRestore}
      />,
    );

    // The panel reloads the open snapshot on the prop change; wait for the
    // Restore action to settle back to enabled before attempting it.
    await waitFor(() => {
      expect(restoreButton().disabled).toBe(false);
    });

    fireEvent.click(restoreButton());

    await waitFor(() => {
      expect(onConflict).toHaveBeenCalledTimes(1);
    });
    expect(onRestore).not.toHaveBeenCalled();

    const event = onConflict.mock.calls[0]?.[0];
    expect(event?.snapshotIR).toEqual(baseIR);
    expect(event?.currentHash).not.toBe(event?.expectedBaseHash);
  });

  it("restores normally (no conflict) when the document is unchanged", async () => {
    const adapter = inMemoryAdapter();
    const baseIR = makeIR("Snapshot");
    const onRestore = vi.fn();
    const onConflict = vi.fn();

    render(
      <VersionHistoryUI
        adapter={adapter}
        currentIR={baseIR}
        onConflict={onConflict}
        onRestore={onRestore}
      />,
    );

    await saveOpenAndEnableRestore("Snapshot");

    fireEvent.click(restoreButton());

    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledTimes(1);
    });
    expect(onConflict).not.toHaveBeenCalled();
    expect(onRestore.mock.calls[0]?.[0]).toEqual(baseIR);
  });
});
