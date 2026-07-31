/**
 * Dardcor Code - 3-Way Git Merge Conflict Resolution Code Editor Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';

const MERGE_EDITOR_STYLE_ID = 'dc-git-merge-editor-styles';

export interface IMergeConflict {
	readonly id: string;
	readonly startLine: number;
	readonly base: string;
	readonly incoming: string;
	readonly current: string;
	readonly endLine: number;
}

export type MergeResolution = 'incoming' | 'current' | 'both';

export interface IMergeResolutionEvent {
	readonly conflict: IMergeConflict;
	readonly resolution: MergeResolution;
}

export class MergeConflictParser {
	public static parse(content: string): IMergeConflict[] {
		const lines = content.split(/\r?\n/);
		const conflicts: IMergeConflict[] = [];
		let counter = 1;

		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (/^<<<<<<<|^<<<<<<< /.test(line)) {
				const startLine = i + 1;
				const incoming: string[] = [];
				const base: string[] = [];
				const current: string[] = [];
				let state: 'incoming' | 'base' | 'current' = 'incoming';
				let endLine = startLine;
				let found = false;

				for (let j = i + 1; j < lines.length; j++) {
					const candidate = lines[j];
					if (/^=======/.test(candidate)) {
						if (state === 'incoming') {
							state = 'base';
							continue;
						}
						if (state === 'base') {
							state = 'current';
							continue;
						}
					}
					if (/^>>>>>>>/.test(candidate)) {
						endLine = j + 1;
						found = true;
						break;
					}
					if (state === 'incoming') {
						incoming.push(candidate);
					} else if (state === 'base') {
						base.push(candidate);
					} else {
						current.push(candidate);
					}
				}

				if (found) {
					conflicts.push({
						id: `conflict-${counter++}`,
						startLine,
						base: base.join('\n'),
						incoming: incoming.join('\n'),
						current: current.join('\n'),
						endLine
					});
					i = endLine;
					continue;
				}
			}
			i++;
		}
		return conflicts;
	}

	public static resolve(content: string, conflicts: readonly IMergeConflict[], resolution: (conflict: IMergeConflict) => MergeResolution): string {
		if (conflicts.length === 0) {
			return content;
		}
		const lines = content.split(/\r?\n/);
		const resolvedLines: string[] = [];
		let current = 0;
		for (const conflict of conflicts) {
			for (let i = current; i < conflict.startLine - 1; i++) {
				resolvedLines.push(lines[i]);
			}
			const choice = resolution(conflict);
			if (choice === 'incoming') {
				for (const l of conflict.incoming.split('\n')) {
					resolvedLines.push(l);
				}
			} else if (choice === 'current') {
				for (const l of conflict.current.split('\n')) {
					resolvedLines.push(l);
				}
			} else {
				for (const l of conflict.current.split('\n')) {
					resolvedLines.push(l);
				}
				for (const l of conflict.incoming.split('\n')) {
					resolvedLines.push(l);
				}
			}
			current = conflict.endLine;
		}
		for (let i = current; i < lines.length; i++) {
			resolvedLines.push(lines[i]);
		}
		return resolvedLines.join('\n');
	}

	public static hasConflicts(content: string): boolean {
		return /^(<<<<<<<|<<<<<<< )/m.test(content) && /^>>>>>>>/m.test(content);
	}
}

export class GitMergeEditor extends Disposable {
	private readonly _onDidResolve = this._register(new Emitter<IMergeResolutionEvent>());
	readonly onDidResolve: Event<IMergeResolutionEvent> = this._onDidResolve.event;

	private readonly _onDidResolveAll = this._register(new Emitter<string>());
	readonly onDidResolveAll: Event<string> = this._onDidResolveAll.event;

	private readonly _container: HTMLElement;
	private readonly _listContainer: HTMLElement;
	private readonly _summaryLabel: HTMLElement;
	private _content = '';
	private _conflicts: IMergeConflict[] = [];
	private _resolutions = new Map<string, MergeResolution>();

	constructor(parentDom: HTMLElement) {
		super();

		CssInjector.inject(MERGE_EDITOR_STYLE_ID, `
			.dc-merge-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
			.dc-merge-pane-header { padding: 6px 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid #2a2d2e; }
			.dc-merge-pane-body { flex: 1; overflow: auto; padding: 8px; font-family: Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: #cccccc; }
			.dc-merge-conflict-row { border: 1px solid #3c3c3c; margin: 6px; background: #252526; }
			.dc-merge-accept-btn { background: #3c3c3c; border: none; color: #cccccc; border-radius: 2px; font-size: 11px; padding: 2px 8px; cursor: pointer; }
			.dc-merge-accept-btn:hover { background: #0e639c; color: white; }
			.dc-merge-accept-btn.active { background: #0e639c; color: white; }
		`);

		this._container = $<HTMLElement>('div', 'dc-git-merge-editor');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';

		const title = $<HTMLElement>('span');
		title.textContent = 'MERGE CONFLICT';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;flex:1;';

		const acceptIncomingAll = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptIncomingAll.textContent = 'Accept Incoming Semua';
		acceptIncomingAll.addEventListener('click', () => this.resolveAll('incoming'));

		const acceptCurrentAll = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptCurrentAll.textContent = 'Accept Current Semua';
		acceptCurrentAll.addEventListener('click', () => this.resolveAll('current'));

		const acceptBothAll = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptBothAll.textContent = 'Accept Both Semua';
		acceptBothAll.addEventListener('click', () => this.resolveAll('both'));

		toolbar.appendChild(title);
		toolbar.appendChild(acceptIncomingAll);
		toolbar.appendChild(acceptCurrentAll);
		toolbar.appendChild(acceptBothAll);
		this._container.appendChild(toolbar);

		this._summaryLabel = $<HTMLElement>('div');
		this._summaryLabel.style.cssText = 'padding:4px 12px;font-size:11px;color:#8a8a8a;border-bottom:1px solid #2a2d2e;';
		this._container.appendChild(this._summaryLabel);

		this._listContainer = $<HTMLElement>('div');
		this._listContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._container.appendChild(this._listContainer);
		parentDom.appendChild(this._container);
	}

	get conflicts(): IMergeConflict[] {
		return [...this._conflicts];
	}

	get unresolvedCount(): number {
		return this._conflicts.filter(c => !this._resolutions.has(c.id)).length;
	}

	public setContent(content: string): void {
		this._content = content;
		this._conflicts = MergeConflictParser.parse(content);
		this._resolutions.clear();
		this.render();
	}

	public getContent(): string {
		return this._content;
	}

	public getResolvedContent(): string {
		return MergeConflictParser.resolve(this._content, this._conflicts, c => this._resolutions.get(c.id) ?? 'current');
	}

	public resolveConflict(conflictId: string, resolution: MergeResolution): void {
		this._resolutions.set(conflictId, resolution);
		this._onDidResolve.fire({ conflict: this._conflicts.find(c => c.id === conflictId) ?? this._conflicts[0], resolution });
		this.render();
		if (this.unresolvedCount === 0) {
			this._onDidResolveAll.fire(this.getResolvedContent());
		}
	}

	public resolveAll(resolution: MergeResolution): void {
		for (const conflict of this._conflicts) {
			this._resolutions.set(conflict.id, resolution);
		}
		this.render();
		this._onDidResolveAll.fire(this.getResolvedContent());
	}

	public render(): void {
		clearNode(this._listContainer);
		this._summaryLabel.textContent = `${this._conflicts.length} konflik \u00B7 ${this.unresolvedCount} belum diselesaikan`;

		if (this._conflicts.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada konflik merge yang ditemukan.';
			empty.style.cssText = 'padding:16px;color:#8a8a8a;font-size:13px;';
			this._listContainer.appendChild(empty);
			return;
		}

		for (const conflict of this._conflicts) {
			this._renderConflict(conflict);
		}
	}

	private _renderConflict(conflict: IMergeConflict): void {
		const row = $<HTMLElement>('div', 'dc-merge-conflict-row');
		row.dataset['conflictId'] = conflict.id;

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:#2a2d2e;border-bottom:1px solid #3c3c3c;';

		const label = $<HTMLElement>('span');
		label.textContent = `Konflik baris ${conflict.startLine}-${conflict.endLine}`;
		label.style.cssText = 'flex:1;font-size:12px;color:#cccccc;';

		const resolved = this._resolutions.get(conflict.id);
		if (resolved) {
			const badge = $<HTMLElement>('span');
			badge.textContent = `\u2713 ${resolved}`;
			badge.style.cssText = 'color:#23d18b;font-size:11px;';
			header.appendChild(badge);
		}

		header.appendChild(label);

		const acceptIncoming = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptIncoming.textContent = 'Accept Incoming';
		acceptIncoming.className = 'dc-merge-accept-btn' + (resolved === 'incoming' ? ' active' : '');
		acceptIncoming.addEventListener('click', () => this.resolveConflict(conflict.id, 'incoming'));

		const acceptCurrent = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptCurrent.textContent = 'Accept Current';
		acceptCurrent.className = 'dc-merge-accept-btn' + (resolved === 'current' ? ' active' : '');
		acceptCurrent.addEventListener('click', () => this.resolveConflict(conflict.id, 'current'));

		const acceptBoth = $<HTMLButtonElement>('button', 'dc-merge-accept-btn');
		acceptBoth.textContent = 'Accept Both';
		acceptBoth.className = 'dc-merge-accept-btn' + (resolved === 'both' ? ' active' : '');
		acceptBoth.addEventListener('click', () => this.resolveConflict(conflict.id, 'both'));

		header.appendChild(acceptIncoming);
		header.appendChild(acceptCurrent);
		header.appendChild(acceptBoth);
		row.appendChild(header);

		const panes = $<HTMLElement>('div');
		panes.style.cssText = 'display:flex;gap:0;';
		this._appendPane(panes, 'Incoming', conflict.incoming, '#23d18b');
		this._appendPane(panes, 'Current', conflict.current, '#3794ff');
		if (conflict.base) {
			this._appendPane(panes, 'Base', conflict.base, '#8a8a8a');
		}
		row.appendChild(panes);
		this._listContainer.appendChild(row);
	}

	private _appendPane(container: HTMLElement, title: string, text: string, color: string): void {
		const pane = $<HTMLElement>('div', 'dc-merge-pane');
		const header = $<HTMLElement>('div', 'dc-merge-pane-header');
		header.textContent = title;
		header.style.color = color;
		header.style.borderColor = '#2a2d2e';
		const body = $<HTMLElement>('div', 'dc-merge-pane-body');
		body.textContent = text || '(kosong)';
		body.style.color = text ? '#cccccc' : '#6a6a6a';
		pane.appendChild(header);
		pane.appendChild(body);
		container.appendChild(pane);
	}

	public dispose(): void {
		super.dispose();
	}
}
