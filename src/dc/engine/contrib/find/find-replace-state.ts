/**
 * Dardcor Code - Find/Replace Query State Options Container
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { IFindOptions } from "./find-model.js";
import { FindModel } from "./find-model.js";

export interface IFindReplaceState {
	readonly query: string;
	readonly replaceString: string;
	readonly isRegex: boolean;
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
	readonly preserveCase: boolean;
	readonly isRevealed: boolean;
	readonly matchCount: number;
	readonly currentMatchIndex: number;
}

const DEFAULT_STATE: IFindReplaceState = {
	query: "",
	replaceString: "",
	isRegex: false,
	matchCase: false,
	wholeWord: false,
	preserveCase: false,
	isRevealed: false,
	matchCount: 0,
	currentMatchIndex: -1
};

export class FindReplaceState extends Disposable {
	private _state: IFindReplaceState = { ...DEFAULT_STATE };
	private _findModel: FindModel | null = null;

	private readonly _onDidChange = this._register(new Emitter<IFindReplaceState>());
	readonly onDidChange: Event<IFindReplaceState> = this._onDidChange.event;

	public setFindModel(model: FindModel | null): void {
		this._findModel = model;
		this._syncFromFindModel();
	}

	public setQuery(query: string): void {
		this._state = { ...this._state, query };
		this._syncFromFindModel();
	}

	public getQuery(): string {
		return this._state.query;
	}

	public setReplaceString(replaceString: string): void {
		this._state = { ...this._state, replaceString };
		this._emit();
	}

	public getReplaceString(): string {
		return this._state.replaceString;
	}

	public toggleRegex(): void {
		this.setOptions({ isRegex: !this._state.isRegex });
	}

	public toggleMatchCase(): void {
		this.setOptions({ matchCase: !this._state.matchCase });
	}

	public toggleWholeWord(): void {
		this.setOptions({ wholeWord: !this._state.wholeWord });
	}

	public togglePreserveCase(): void {
		this._state = { ...this._state, preserveCase: !this._state.preserveCase };
		this._emit();
	}

	public setOptions(partial: Partial<Pick<IFindReplaceState, "isRegex" | "matchCase" | "wholeWord">>): void {
		this._state = { ...this._state, ...partial };
		this._syncFromFindModel();
	}

	public setRevealed(revealed: boolean): void {
		this._state = { ...this._state, isRevealed: revealed };
		this._emit();
	}

	public reset(): void {
		this._state = { ...DEFAULT_STATE };
		this._emit();
	}

	public getState(): IFindReplaceState {
		return { ...this._state };
	}

	public toFindOptions(): IFindOptions {
		return {
			isRegex: this._state.isRegex,
			matchCase: this._state.matchCase,
			wholeWord: this._state.wholeWord
		};
	}

	public isQueryEmpty(): boolean {
		return this._state.query.length === 0;
	}

	private _syncFromFindModel(): void {
		const model = this._findModel;
		if (model) {
			model.setQuery(this._state.query);
			model.setOptions(this.toFindOptions());
		}
		this._emit();
	}

	private _emit(): void {
		const model = this._findModel;
		if (model) {
			this._state = {
				...this._state,
				matchCount: model.getMatchCount(),
				currentMatchIndex: model.getCurrentMatchIndex()
			};
		}
		this._onDidChange.fire(this.getState());
	}
}
