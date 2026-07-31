/**
 * Dardcor Code - Code Snippet Expansion Engine & Tab Stop Session
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel } from "../../model/text-model.js";
import { SnippetParser, SnippetNode, SnippetNodeKind, ISnippetTabStopNode, ISnippetPlaceholderNode, snippetNodesToText } from "./snippet-parser.js";

export interface ITabStopState {
	readonly index: number;
	readonly offset: number;
	readonly length: number;
}

export interface ISnippetSession {
	readonly text: string;
	readonly tabStops: ITabStopState[];
	readonly currentIndex: number;
}

export interface ISnippetInsertResult {
	readonly session: ISnippetSession | null;
	readonly error: string | null;
}

function basename(uriPath: string): string {
	const parts = uriPath.split("/");
	return parts[parts.length - 1] || uriPath;
}

export class SnippetController extends Disposable {
	private _session: ISnippetSession | null = null;

	private readonly _onDidChange = this._register(new Emitter<ISnippetSession | null>());
	readonly onDidChange: Event<ISnippetSession | null> = this._onDidChange.event;

	public insertSnippet(model: ITextModel, snippetString: string, atOffset?: number): ISnippetInsertResult {
		const parsed = SnippetParser.parse(snippetString);
		if (parsed.error) {
			return { session: null, error: parsed.error };
		}
		const resolved = this._resolveVariables(model, parsed.ast.nodes);
		const snippetText = snippetNodesToText(resolved);
		const offset = atOffset ?? model.getValue().length;

		const text = model.getValue();
		const newText = text.substring(0, offset) + snippetText + text.substring(offset);
		model.setValue(newText);

		const tabStops = this._collectTabStops(resolved, offset);
		if (tabStops.length === 0) {
			this._session = null;
			this._onDidChange.fire(this._session);
			return { session: null, error: null };
		}
		this._session = { text: newText, tabStops, currentIndex: 0 };
		this._onDidChange.fire(this._session);
		return { session: this._session, error: null };
	}

	private _resolveVariables(model: ITextModel, nodes: SnippetNode[]): SnippetNode[] {
		const now = new Date();
		const fileName = model.uri.path ? basename(model.uri.path) : "";
		const variables: Record<string, string> = {
			TM_FILENAME: fileName,
			TM_FILENAME_BASE: fileName.replace(/\.[^.]+$/, ""),
			TM_DIRECTORY: model.uri.path ? model.uri.path.substring(0, model.uri.path.lastIndexOf("/")) : "",
			TM_FILEPATH: model.uri.path ?? "",
			CURRENT_YEAR: String(now.getFullYear()),
			CURRENT_YEAR_SHORT: String(now.getFullYear()).slice(-2),
			CURRENT_MONTH: String(now.getMonth() + 1).padStart(2, "0"),
			CURRENT_MONTH_NAME: now.toLocaleString("en", { month: "long" }),
			CURRENT_DATE: String(now.getDate()).padStart(2, "0"),
			CURRENT_DAY_NAME: now.toLocaleString("en", { weekday: "long" }),
			CURRENT_HOUR: String(now.getHours()).padStart(2, "0"),
			CURRENT_MINUTE: String(now.getMinutes()).padStart(2, "0"),
			CURRENT_SECOND: String(now.getSeconds()).padStart(2, "0"),
			CURRENT_LINE: "1",
			TM_LINE_INDEX: "0",
			TM_LINE_NUMBER: "1",
			TM_SELECTED_TEXT: "",
			CLIPBOARD: ""
		};
		return nodes.map(node => {
			if (node.kind === SnippetNodeKind.Variable) {
				const value = variables[node.name];
				if (value !== undefined) {
					return { kind: SnippetNodeKind.Text as const, offset: node.offset, length: node.length, value };
				}
				return { ...node, defaultValue: node.defaultValue ?? "" };
			}
			return node;
		});
	}

	private _collectTabStops(nodes: SnippetNode[], baseOffset: number): ITabStopState[] {
		const tabStops = new Map<number, ITabStopState>();
		let cursor = baseOffset;

		const walk = (node: SnippetNode, currentOffset: number): number => {
			switch (node.kind) {
				case SnippetNodeKind.Text:
				case SnippetNodeKind.EscapedText:
					return currentOffset + node.value.length;
				case SnippetNodeKind.TabStop:
					if (node.index > 0) {
						tabStops.set(node.index, { index: node.index, offset: currentOffset, length: node.defaultValue?.length ?? 0 });
					}
					return currentOffset + (node.defaultValue?.length ?? 0);
				case SnippetNodeKind.Placeholder:
					if (node.index > 0) {
						tabStops.set(node.index, { index: node.index, offset: currentOffset, length: node.defaultValue.length });
					}
					return currentOffset + node.defaultValue.length;
				case SnippetNodeKind.Variable:
					return currentOffset + (node.defaultValue?.length ?? 0);
				case SnippetNodeKind.Choice:
					tabStops.set(node.index, { index: node.index, offset: currentOffset, length: node.choices[0]?.length ?? 0 });
					return currentOffset + (node.choices[0]?.length ?? 0);
			}
		};

		for (const node of nodes) {
			cursor = walk(node, cursor);
		}
		const result = [...tabStops.values()].sort((a, b) => a.index - b.index);
		return result;
	}

	public nextTabStop(): void {
		if (!this._session || this._session.tabStops.length === 0) {
			return;
		}
		if (this._session.currentIndex >= this._session.tabStops.length - 1) {
			this.endSession();
			return;
		}
		this._session = { ...this._session, currentIndex: this._session.currentIndex + 1 };
		this._onDidChange.fire(this._session);
	}

	public previousTabStop(): void {
		if (!this._session || this._session.currentIndex <= 0) {
			return;
		}
		this._session = { ...this._session, currentIndex: this._session.currentIndex - 1 };
		this._onDidChange.fire(this._session);
	}

	public endSession(): void {
		this._session = null;
		this._onDidChange.fire(null);
	}

	public getSession(): ISnippetSession | null {
		return this._session;
	}

	public hasActiveSession(): boolean {
		return this._session !== null;
	}

	public getCurrentTabStop(): ITabStopState | null {
		if (!this._session || this._session.currentIndex < 0) {
			return null;
		}
		return this._session.tabStops[this._session.currentIndex] ?? null;
	}

	public selectChoice(choiceIndex: number): void {
		// Choices are expanded to their first option at insert time; selecting
		// another option requires re-parsing, which sessions keep simple.
		void choiceIndex;
	}

	public getTabStop(index: number): ISnippetTabStopNode | ISnippetPlaceholderNode | null {
		void index;
		return null;
	}
}
