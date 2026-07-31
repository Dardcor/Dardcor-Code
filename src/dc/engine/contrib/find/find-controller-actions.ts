/**
 * Dardcor Code - Find Controller Command Action Bindings
 */

import { FindModel, IFindMatch } from "./find-model.js";
import { IFindReplaceState, FindReplaceState } from "./find-replace-state.js";

export interface IFindControllerHost {
	getFindModel(): FindModel | null;
	getFindReplaceState(): FindReplaceState | null;
	revealMatch(match: IFindMatch): void;
	openFindWidget(): void;
	closeFindWidget(): void;
}

export interface IFindActionResult {
	readonly handled: boolean;
	readonly matchCount: number;
	readonly currentIndex: number;
}

export enum FindActionId {
	Find = "dc.editor.find",
	FindNext = "dc.editor.findNext",
	FindPrevious = "dc.editor.findPrevious",
	Replace = "dc.editor.replace",
	SelectAllOccurrences = "dc.editor.selectAllOccurrences",
	CloseFind = "dc.editor.closeFind"
}

/**
 * The find/replace command actions. Kept as pure functions over a host so
 * they can be invoked from the command registry or directly from a
 * controller, e.g. for keyboard shortcuts.
 */
export class FindControllerActions {
	public static find(host: IFindControllerHost): IFindActionResult {
		host.openFindWidget();
		return { handled: true, matchCount: host.getFindModel()?.getMatchCount() ?? 0, currentIndex: -1 };
	}

	public static findNext(host: IFindControllerHost): IFindActionResult {
		const model = host.getFindModel();
		if (!model || model.getMatchCount() === 0) {
			return { handled: false, matchCount: 0, currentIndex: -1 };
		}
		const match = model.moveNext();
		if (match) {
			host.revealMatch(match);
		}
		return { handled: true, matchCount: model.getMatchCount(), currentIndex: model.getCurrentMatchIndex() };
	}

	public static findPrevious(host: IFindControllerHost): IFindActionResult {
		const model = host.getFindModel();
		if (!model || model.getMatchCount() === 0) {
			return { handled: false, matchCount: 0, currentIndex: -1 };
		}
		const match = model.movePrevious();
		if (match) {
			host.revealMatch(match);
		}
		return { handled: true, matchCount: model.getMatchCount(), currentIndex: model.getCurrentMatchIndex() };
	}

	public static replace(host: IFindControllerHost): IFindActionResult {
		const state = host.getFindReplaceState();
		if (!state) {
			return { handled: false, matchCount: 0, currentIndex: -1 };
		}
		state.setRevealed(true);
		const model = host.getFindModel();
		return { handled: true, matchCount: model?.getMatchCount() ?? 0, currentIndex: model?.getCurrentMatchIndex() ?? -1 };
	}

	public static selectAllOccurrences(host: IFindControllerHost): IFindActionResult {
		const model = host.getFindModel();
		if (!model) {
			return { handled: false, matchCount: 0, currentIndex: -1 };
		}
		host.revealMatch({ range: model.getCurrentMatch()?.range ?? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, lineText: "" });
		return { handled: true, matchCount: model.getMatchCount(), currentIndex: model.getCurrentMatchIndex() };
	}

	public static closeFind(host: IFindControllerHost): IFindActionResult {
		host.closeFindWidget();
		return { handled: true, matchCount: 0, currentIndex: -1 };
	}

	public static execute(host: IFindControllerHost, id: FindActionId): IFindActionResult {
		switch (id) {
			case FindActionId.Find:
				return FindControllerActions.find(host);
			case FindActionId.FindNext:
				return FindControllerActions.findNext(host);
			case FindActionId.FindPrevious:
				return FindControllerActions.findPrevious(host);
			case FindActionId.Replace:
				return FindControllerActions.replace(host);
			case FindActionId.SelectAllOccurrences:
				return FindControllerActions.selectAllOccurrences(host);
			case FindActionId.CloseFind:
				return FindControllerActions.closeFind(host);
			default:
				return { handled: false, matchCount: 0, currentIndex: -1 };
		}
	}
}

/**
 * Binder holding a host reference so controller code can call the actions
 * without threading the host through every call site.
 */
export class FindActionBinder {
	constructor(private readonly _host: IFindControllerHost) {}

	public find(): IFindActionResult {
		return FindControllerActions.find(this._host);
	}

	public findNext(): IFindActionResult {
		return FindControllerActions.findNext(this._host);
	}

	public findPrevious(): IFindActionResult {
		return FindControllerActions.findPrevious(this._host);
	}

	public replace(): IFindActionResult {
		return FindControllerActions.replace(this._host);
	}

	public selectAllOccurrences(): IFindActionResult {
		return FindControllerActions.selectAllOccurrences(this._host);
	}

	public closeFind(): IFindActionResult {
		return FindControllerActions.closeFind(this._host);
	}
}

export function isFindStateRevealed(state: IFindReplaceState): boolean {
	return state.isRevealed;
}
