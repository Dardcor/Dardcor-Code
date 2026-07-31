/**
 * Dardcor Code - Suggestion Widget Overwritten Keys Handler
 *
 * When the suggestion widget is visible, certain keyboard events must be
 * intercepted ("overwritten") so they drive the suggestion list instead of
 * reaching the editor. This module centralizes that key set and the action
 * mapping, mirroring the logic the widget uses to stay in control.
 */

export type SuggestOverwriteAction = "selectNext" | "selectPrevious" | "selectFirst" | "selectLast" | "accept" | "hide" | "none";

export class SuggestOverwrittenKeys {
	public static readonly OverwrittenKeys: readonly string[] = [
		"ArrowUp",
		"ArrowDown",
		"PageUp",
		"PageDown",
		"Home",
		"End",
		"Enter",
		"Tab",
		"Escape"
	];

	public static readonly KeyBindings: Readonly<Record<string, SuggestOverwriteAction>> = {
		ArrowDown: "selectNext",
		ArrowUp: "selectPrevious",
		PageDown: "selectNext",
		PageUp: "selectPrevious",
		Home: "selectFirst",
		End: "selectLast",
		Enter: "accept",
		Tab: "accept",
		Escape: "hide"
	};

	public static isOverwritten(key: string): boolean {
		return SuggestOverwrittenKeys.OverwrittenKeys.includes(key);
	}

	public static getActionForKey(key: string): SuggestOverwriteAction {
		return SuggestOverwrittenKeys.KeyBindings[key] ?? "none";
	}

	public static getOverwrittenKeys(suggestionsVisible: boolean): readonly string[] {
		return suggestionsVisible ? SuggestOverwrittenKeys.OverwrittenKeys : [];
	}

	public static isNavigationKey(key: string): boolean {
		const action = SuggestOverwrittenKeys.getActionForKey(key);
		return action === "selectNext" || action === "selectPrevious" || action === "selectFirst" || action === "selectLast";
	}

	public static isCommitKey(key: string): boolean {
		const action = SuggestOverwrittenKeys.getActionForKey(key);
		return action === "accept";
	}

	public static isDismissKey(key: string): boolean {
		return SuggestOverwrittenKeys.getActionForKey(key) === "hide";
	}

	public static shouldInterceptEvent(key: string, suggestionsVisible: boolean, hasFocus: boolean): boolean {
		if (!suggestionsVisible || !hasFocus) {
			return false;
		}
		return SuggestOverwrittenKeys.isOverwritten(key);
	}
}
