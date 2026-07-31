/**
 * Dardcor Code - Inline Text Line Top Button Widget (CodeLens)
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ICodeLens, ICommand } from "./codelens-controller.js";

export interface ICodeLensWidgetHost {
	getContainer(): HTMLElement;
	getLineTop(lineNumber: number): number;
	runCommand(command: ICommand): void;
}

export class CodeLensWidget extends Disposable {
	private readonly _host: ICodeLensWidgetHost;
	private readonly _domNode: HTMLElement;
	private _lenses: ICodeLens[] = [];

	private readonly _onDidRunCommand = this._register(new Emitter<ICommand>());
	readonly onDidRunCommand: Event<ICommand> = this._onDidRunCommand.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: ICodeLensWidgetHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-codelens-widget");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:9;";
		host.getContainer().appendChild(this._domNode);
	}

	public setLenses(lenses: ICodeLens[]): void {
		this._lenses = [...lenses].sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		this.render();
	}

	public clear(): void {
		this._lenses = [];
		this.render();
	}

	public render(): void {
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
			row.style.cssText = `position:absolute;left:4px;top:${top}px;pointer-events:auto;font-size:12px;color:#8d8d8d;white-space:pre;`;
			lenses.forEach((lens, i) => {
				if (i > 0) {
					const sep = $<HTMLElement>("span", "dc-codelens-sep");
					sep.textContent = "  ";
					row.appendChild(sep);
				}
				const button = $<HTMLElement>("span", "dc-codelens-button");
				button.textContent = lens.command.title;
				button.style.cssText = "cursor:pointer;color:#75beff;";
				button.title = lens.command.id;
				this._register(addDisposableListener(button, "click", e => {
					e.preventDefault();
					e.stopPropagation();
					this._onDidRunCommand.fire(lens.command);
					this._host.runCommand(lens.command);
				}));
				row.appendChild(button);
			});
			this._domNode.appendChild(row);
		}
		this._onDidChange.fire();
	}

	public layout(): void {
		this.render();
	}

	public getLenses(): readonly ICodeLens[] {
		return this._lenses;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
