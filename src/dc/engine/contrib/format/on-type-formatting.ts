/**
 * Dardcor Code - Auto-Format On Character Typed Provider
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { IFormattingEdit } from "./format-controller.js";

export interface IOnTypeFormattingEdit {
	readonly range: IRange;
	readonly text: string;
}

export interface IOnTypeFormattingProvider {
	provideOnTypeFormattingEdits(
		model: ITextModel,
		position: IPosition,
		ch: string,
		options: { tabSize: number; insertSpaces: boolean },
		token: CancellationToken
	): IOnTypeFormattingEdit[] | null | Promise<IOnTypeFormattingEdit[] | null>;
}

export interface IOnTypeFormattingHost {
	getModel(): ITextModel | null;
	getPosition(): IPosition | null;
	applyEdits(edits: IOnTypeFormattingEdit[]): void;
}

const TRIGGER_CHARACTERS = ["}", ";", ",", ")", ">"];

/**
 * Reindents the current line after a closing character has been typed by
 * measuring the brace depth of everything above it, mirroring the behavior of
 * editor "auto indent" without a full formatter run.
 */
export class IndentOnTypeFormattingProvider implements IOnTypeFormattingProvider {
	constructor(private readonly _options: { tabSize: number; insertSpaces: boolean } = { tabSize: 4, insertSpaces: true }) {}

	public async provideOnTypeFormattingEdits(model: ITextModel, position: IPosition, ch: string, options: { tabSize: number; insertSpaces: boolean }, token: CancellationToken): Promise<IOnTypeFormattingEdit[]> {
		if (token.isCancellationRequested || ch !== "}") {
			return [];
		}
		const lineNumber = position.lineNumber;
		const text = model.getLineContent(lineNumber);
		const trimmed = text.trim();
		if (!trimmed.startsWith("}") && !trimmed.startsWith("]") && !trimmed.startsWith(")")) {
			return [];
		}
		let depth = 0;
		let quote: string | null = null;
		for (let line = 1; line < lineNumber; line++) {
			const content = model.getLineContent(line);
			for (let i = 0; i < content.length; i++) {
				const ch2 = content[i];
				const next = content[i + 1] ?? "";
				if (quote) {
					if (ch2 === quote && content[i - 1] !== "\\") {
						quote = null;
					}
					continue;
				}
				if (ch2 === "/" && next === "/") {
					break;
				}
				if (ch2 === "/" && next === "*") {
					break;
				}
				if (ch2 === "'" || ch2 === "\"" || ch2 === "`") {
					quote = ch2;
					continue;
				}
				if (ch2 === "{") {
					depth++;
				} else if (ch2 === "}") {
					depth = Math.max(0, depth - 1);
				}
			}
		}
		const expectedDepth = Math.max(0, depth - 1);
		const expected = options.insertSpaces ? " ".repeat(expectedDepth * (options.tabSize ?? 4)) : "\t".repeat(expectedDepth);
		let index = 0;
		while (index < text.length && (text[index] === " " || text[index] === "\t")) {
			index++;
		}
		const current = text.substring(0, index);
		if (current === expected) {
			return [];
		}
		return [{
			range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: current.length + 1 },
			text: expected
		}];
	}
}

/**
 * Watches content changes of the bound model, detects when one of the trigger
 * characters has been typed at the end of a line and runs the registered
 * on-type-formatting providers.
 */
export class OnTypeFormattingController extends Disposable {
	private readonly _host: IOnTypeFormattingHost;
	private readonly _providers: IOnTypeFormattingProvider[] = [];
	private _lastContent: string = "";

	private readonly _onDidFormat = this._register(new Emitter<IOnTypeFormattingEdit[]>());
	readonly onDidFormat: Event<IOnTypeFormattingEdit[]> = this._onDidFormat.event;

	constructor(host: IOnTypeFormattingHost) {
		super();
		this._host = host;
	}

	public registerProvider(provider: IOnTypeFormattingProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: IOnTypeFormattingProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public static getTriggerCharacters(): readonly string[] {
		return TRIGGER_CHARACTERS;
	}

	public handleContentChanged(): void {
		const model = this._host.getModel();
		if (!model) {
			this._lastContent = "";
			return;
		}
		const content = model.getValue();
		const previous = this._lastContent;
		this._lastContent = content;
		if (content.length <= previous.length) {
			return;
		}
		const typed = content.substring(previous.length);
		if (!TRIGGER_CHARACTERS.includes(typed)) {
			return;
		}
		const position = this._host.getPosition();
		if (!position) {
			return;
		}
		this._run(model, position, typed);
	}

	public setBaseline(): void {
		this._lastContent = this._host.getModel()?.getValue() ?? "";
	}

	private async _run(model: ITextModel, position: IPosition, ch: string): Promise<void> {
		if (this._providers.length === 0) {
			return;
		}
		const edits: IOnTypeFormattingEdit[] = [];
		for (const provider of this._providers) {
			try {
				const result = await provider.provideOnTypeFormattingEdits(
					model,
					position,
					ch,
					{ tabSize: 4, insertSpaces: true },
					CancellationToken.None
				);
				if (result && result.length > 0) {
					edits.push(...result);
				}
			} catch {
				// Continue with the next provider
			}
		}
		if (edits.length === 0) {
			return;
		}
		this._host.applyEdits(edits);
		this._onDidFormat.fire(edits);
	}
}
