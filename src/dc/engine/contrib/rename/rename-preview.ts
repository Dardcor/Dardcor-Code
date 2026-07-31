/**
 * Dardcor Code - Workspace-Wide Rename Change Preview
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode } from "../../../core/dom/element.js";
import { URI } from "../../../core/types/uri.js";
import { IRange } from "../../model/text-model.js";
import { IRenameEdit, IRenameEditsResult, IRenameLocation } from "./rename-provider.js";

export interface IRenameChange {
	readonly edit: IRenameEdit;
	readonly isRelevant: boolean;
}

export interface IRenameFileChange {
	readonly uri: URI;
	readonly displayName: string;
	readonly changes: IRenameChange[];
}

export interface IRenamePreviewHost {
	previewContent(uri: URI, range: IRange): string | null;
}

/**
 * Collects and previews the edits of a workspace-wide rename before they are
 * applied. Groups changes per file, allows toggling individual changes and
 * reports a summary (total / relevant counts) to the UI.
 */
export class RenamePreview extends Disposable {
	private readonly _host: IRenamePreviewHost;
	private _result: IRenameEditsResult | null = null;
	private _disabled = new Set<IRenameEdit>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: IRenamePreviewHost) {
		super();
		this._host = host;
	}

	public setResult(result: IRenameEditsResult | null): void {
		this._result = result;
		this._disabled.clear();
		this._onDidChange.fire();
	}

	public clear(): void {
		this.setResult(null);
	}

	public getFiles(): IRenameFileChange[] {
		if (!this._result) {
			return [];
		}
		const byUri = new Map<string, IRenameFileChange>();
		for (const edit of this._result.edits) {
			const key = edit.uri.toString();
			let file = byUri.get(key);
			if (!file) {
				file = {
					uri: edit.uri,
					displayName: this._displayName(edit.uri),
					changes: []
				};
				byUri.set(key, file);
			}
			file.changes.push({ edit, isRelevant: !this._disabled.has(edit) });
		}
		return Array.from(byUri.values());
	}

	public getLocationCount(): number {
		return this._result?.locations.length ?? 0;
	}

	public getEnabledEditCount(): number {
		if (!this._result) {
			return 0;
		}
		return this._result.edits.filter(edit => !this._disabled.has(edit)).length;
	}

	public isEnabled(edit: IRenameEdit): boolean {
		return !this._disabled.has(edit);
	}

	public toggle(edit: IRenameEdit): void {
		if (this._disabled.has(edit)) {
			this._disabled.delete(edit);
		} else {
			this._disabled.add(edit);
		}
		this._onDidChange.fire();
	}

	public getLocations(): IRenameLocation[] {
		return this._result ? [...this._result.locations] : [];
	}

	public getEnabledEdits(): IRenameEdit[] {
		if (!this._result) {
			return [];
		}
		return this._result.edits.filter(edit => !this._disabled.has(edit));
	}

	public getPreviewText(edit: IRenameEdit): string {
		const content = this._host.previewContent(edit.uri, edit.range);
		if (content === null) {
			return "";
		}
		const line = content.split(/\r?\n/)[edit.range.startLineNumber - 1] ?? "";
		return line.trim().substring(0, 120);
	}

	public renderList(container: HTMLElement): void {
		clearNode(container);
		if (!this._result || this._result.edits.length === 0) {
			const empty = $<HTMLElement>("div", "dc-rename-preview-empty");
			empty.textContent = "No rename changes found";
			empty.style.cssText = "padding:12px 16px;color:#969696;";
			container.appendChild(empty);
			return;
		}
		for (const file of this.getFiles()) {
			const header = $<HTMLElement>("div", "dc-rename-preview-file");
			header.textContent = file.displayName;
			header.style.cssText = "padding:4px 12px;font-size:11px;color:#75beff;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #3a3a3a;";
			container.appendChild(header);
			for (const change of file.changes) {
				const row = $<HTMLElement>("div", "dc-rename-preview-change");
				row.style.cssText = "display:flex;gap:8px;padding:2px 16px;align-items:baseline;cursor:pointer;";
				row.title = change.isRelevant ? "Click to exclude" : "Click to include";
				const line = $<HTMLElement>("span", "dc-rename-preview-line");
				line.textContent = String(change.edit.range.startLineNumber);
				line.style.cssText = "flex:none;min-width:28px;color:#6a9955;text-align:right;";
				const preview = $<HTMLElement>("span", "dc-rename-preview-text");
				preview.textContent = this.getPreviewText(change.edit);
				preview.style.cssText = "color:#b5b5b5;white-space:pre;overflow:hidden;text-overflow:ellipsis;";
				row.appendChild(line);
				row.appendChild(preview);
				if (!change.isRelevant) {
					row.style.opacity = "0.45";
					preview.style.textDecoration = "line-through";
				}
				container.appendChild(row);
			}
		}
	}

	private _displayName(uri: URI): string {
		const parts = uri.path.split("/");
		return parts[parts.length - 1] || uri.toString();
	}

	public override dispose(): void {
		super.dispose();
	}
}
