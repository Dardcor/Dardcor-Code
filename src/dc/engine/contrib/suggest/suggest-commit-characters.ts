/**
 * Dardcor Code - Suggestion Commit Characters Handler
 */

import { CompletionItem } from "./completion-item.js";

export interface ICommitCharacterHandlerHost {
	isSuggestionsVisible(): boolean;
	getSelectedItem(): CompletionItem | null;
	acceptItem(item: CompletionItem): void;
}

export interface ICommitCharacterResult {
	readonly committed: boolean;
	readonly item: CompletionItem | null;
	readonly remainingText: string;
}

const DEFAULT_COMMIT_CHARACTERS = [".", "(", ";", ",", ":", "[", "=", "!"];
const COMPLETION_COMMIT_CHARACTERS: Record<string, string> = {
	".": ".",
	"(": "(",
	";": ";",
	",": ",",
	":": ":",
	"[": "[",
	"=": "=",
	"!": "!"
};

/**
 * Decides whether a typed character commits the currently selected
 * suggestion. Mirrors the editor's "commit characters" behavior: when the
 * suggestion widget is visible and the typed character is a commit character
 * (either from the defaults or from the item's own `commitCharacters`), the
 * selected item is accepted first and the remaining text is returned so the
 * caller can insert it into the document.
 */
export class CommitCharactersHandler {
	private readonly _host: ICommitCharacterHandlerHost;
	private readonly _defaultCommitCharacters: readonly string[];

	constructor(host: ICommitCharacterHandlerHost, defaultCommitCharacters: readonly string[] = DEFAULT_COMMIT_CHARACTERS) {
		this._host = host;
		this._defaultCommitCharacters = defaultCommitCharacters;
	}

	public shouldCommit(typedChar: string): boolean {
		if (!this._host.isSuggestionsVisible()) {
			return false;
		}
		const item = this._host.getSelectedItem();
		if (!item) {
			return false;
		}
		if (CommitCharactersHandler.isWordCharacter(typedChar)) {
			return false;
		}
		if (item.commitCharacters.length > 0) {
			return item.commitCharacters.includes(typedChar);
		}
		return this._defaultCommitCharacters.includes(typedChar);
	}

	public handle(typedChar: string): ICommitCharacterResult {
		if (!this.shouldCommit(typedChar)) {
			return { committed: false, item: null, remainingText: typedChar };
		}
		const item = this._host.getSelectedItem();
		if (item) {
			this._host.acceptItem(item);
		}
		const mapping = COMPLETION_COMMIT_CHARACTERS[typedChar];
		return {
			committed: true,
			item,
			remainingText: mapping ?? typedChar
		};
	}

	public getCommitCharacters(item: CompletionItem): readonly string[] {
		return item.commitCharacters.length > 0 ? item.commitCharacters : this._defaultCommitCharacters;
	}

	public static isWordCharacter(ch: string): boolean {
		return /[A-Za-z0-9_$]/.test(ch);
	}

	public static isDefaultCommitCharacter(ch: string): boolean {
		return DEFAULT_COMMIT_CHARACTERS.includes(ch);
	}
}

export function isCommitCharacter(ch: string, item: CompletionItem | null, defaultCharacters: readonly string[] = DEFAULT_COMMIT_CHARACTERS): boolean {
	if (!item) {
		return false;
	}
	if (item.commitCharacters.length > 0) {
		return item.commitCharacters.includes(ch);
	}
	return defaultCharacters.includes(ch);
}
