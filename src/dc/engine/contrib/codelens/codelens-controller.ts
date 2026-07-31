/**
 * Dardcor Code - Inline CodeLens Text Button Controller
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export interface ICommand {
	readonly id: string;
	readonly title: string;
	readonly arguments?: unknown[];
}

export interface ICodeLens {
	readonly range: IRange;
	readonly command: ICommand;
}

export interface ICodeLensProvider {
	provideCodeLenses(model: ITextModel, token: CancellationToken): ICodeLens[] | Promise<ICodeLens[]>;
	resolveCodeLens?(model: ITextModel, lens: ICodeLens, token: CancellationToken): ICodeLens | Promise<ICodeLens> | null;
}

export interface ICodeLensHost {
	getContainer(): HTMLElement;
	getLineTop(lineNumber: number): number;
	runCommand(command: ICommand): void;
}

export class CodeLensController extends Disposable {
	private readonly _providers: ICodeLensProvider[] = [];
	private readonly _host: ICodeLensHost;
	private readonly _domNode: HTMLElement;
	private _model: ITextModel | null = null;
	private _lenses: ICodeLens[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: ICodeLensHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-codelens-layer");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:9;";
		host.getContainer().appendChild(this._domNode);
	}

	public registerProvider(provider: ICodeLensProvider): void {
		this._providers.push(provider);
	}

	public unregisterProvider(provider: ICodeLensProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
		}
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.refresh();
	}

	public async refresh(): Promise<void> {
		const model = this._model;
		clearNode(this._domNode);
		this._lenses = [];
		if (!model || this._providers.length === 0) {
			this._onDidChange.fire();
			return;
		}
		const results = await Promise.all(this._providers.map(async provider => {
			try {
				return await provider.provideCodeLenses(model, CancellationToken.None);
			} catch {
				return [];
			}
		}));
		this._lenses = results.flat().sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		this._render();
		this._onDidChange.fire();
	}

	private _render(): void {
		clearNode(this._domNode);
		const byLine = new Map<number, ICodeLens[]>();
		for (const lens of this._lenses) {
			const line = lens.range.startLineNumber;
			if (!byLine.has(line)) {
				byLine.set(line, []);
			}
			byLine.get(line)!.push(lens);
		}
		for (const [line, lenses] of byLine) {
			const top = this._host.getLineTop(line);
			const row = $<HTMLElement>("div", "dc-codelens-row");
			row.style.cssText = `position:absolute;left:4px;top:${top}px;pointer-events:auto;font-size:12px;color:#8d8d8d;`;
			lenses.forEach((lens, i) => {
				if (i > 0) {
					const sep = $<HTMLElement>("span", "dc-codelens-sep");
					sep.textContent = "  ";
					row.appendChild(sep);
				}
				const button = $<HTMLElement>("span", "dc-codelens-button");
				button.textContent = lens.command.title;
				button.style.cssText = "cursor:pointer;color:#75beff;";
				this._register(addDisposableListener(button, "click", e => {
					e.preventDefault();
					e.stopPropagation();
					this._host.runCommand(lens.command);
				}));
				row.appendChild(button);
			});
			this._domNode.appendChild(row);
		}
	}

	public getLenses(): readonly ICodeLens[] {
		return this._lenses;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
