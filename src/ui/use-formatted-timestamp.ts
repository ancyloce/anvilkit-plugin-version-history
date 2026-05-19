import * as React from "react";

/**
 * SSR/hydration-stable timestamp formatting.
 *
 * `new Date(iso).toLocaleString()` is locale/timezone dependent, so calling
 * it during render produces server↔client (and environment) mismatches. The
 * hook stores both the ISO it last localized and the localized string; when
 * `iso` changes, the render path returns the new raw ISO immediately, and
 * the effect re-localizes on the next tick. That keeps the first render
 * deterministic (matching the server payload) and prevents a one-paint
 * window where the UI would otherwise display the *previous* snapshot's
 * localized timestamp under the new snapshot's label.
 *
 * Pass an empty string when there is no timestamp; the hook still runs
 * unconditionally so it stays on a stable hook path.
 */
export function useFormattedTimestamp(iso: string): string {
	const [state, setState] = React.useState<{
		readonly iso: string;
		readonly formatted: string;
	}>({ iso, formatted: iso });

	React.useEffect(() => {
		if (!iso) {
			setState({ iso, formatted: "" });
			return;
		}

		setState({ iso, formatted: new Date(iso).toLocaleString() });
	}, [iso]);

	return state.iso === iso ? state.formatted : iso;
}
