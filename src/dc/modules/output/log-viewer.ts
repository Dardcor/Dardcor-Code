/**
 * Dardcor Code - Syntax Colored Log File Viewer Pane
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { Path } from '../../core/types/path';
import { escape } from '../../core/types/strings';

declare const require: any;

const LOG_VIEWER_STYLE_ID = 'dc-log-viewer-styles';

export interface ILogLineToken {
	readonly text: string;
	readonly color: string;
}

export class LogViewer extends Disposable {
	private readonly _onDidOpenFile = this._register(new Emitter<string>());
	readonly onDidOpenFile: Event<string> = this._onDidOpenFile.event;

	private readonly _container: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _followCheckbox: HTMLInputElement;
	private readonly _clearButton: HTMLButtonElement;
	private readonly _titleLabel: HTMLElement;
	private readonly _filePath: string | undefined;
	private _autoFollow = true;

	constructor(parentDom: HTMLElement, filePath?: string) {
		super();
		this._filePath = filePath;

		CssInjector.inject(LOG_VIEWER_STYLE_ID, `
			.dc-log-line { white-space: pre-wrap; word-break: break-all; font-family: Consolas, monospace; font-size: 12px; line-height: 1.5; }
			.dc-log-line:hover { background: #2a2d2e; }
			.dc-log-link { color: #3794ff; cursor: pointer; text-decoration: underline; }
		`);

		this._container = $<HTMLElement>('div', 'dc-log-viewer');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';
		this._titleLabel = $<HTMLElement>('span');
		this._titleLabel.textContent = filePath ? Path.basename(filePath) : 'Log Viewer';
		this._titleLabel.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;flex:1;';
		this._titleLabel.title = filePath ?? '';

		const followLabel = $<HTMLElement>('label');
		followLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#8a8a8a;font-size:12px;cursor:pointer;user-select:none;';
		this._followCheckbox = $<HTMLInputElement>('input');
		this._followCheckbox.type = 'checkbox';
		this._followCheckbox.checked = true;
		followLabel.appendChild(this._followCheckbox);
		followLabel.appendChild(document.createTextNode('Auto Scroll'));

		this._clearButton = $<HTMLButtonElement>('button');
		this._clearButton.textContent = 'Bersihkan';
		this._clearButton.style.cssText = 'background:transparent;border:none;color:#cccccc;font-size:12px;cursor:pointer;';

		toolbar.appendChild(this._titleLabel);
		toolbar.appendChild(followLabel);
		toolbar.appendChild(this._clearButton);
		this._container.appendChild(toolbar);

		this._content = $<HTMLElement>('div', 'dc-log-content');
		this._content.style.cssText = 'flex:1;overflow-y:auto;padding:4px 8px;';
		this._content.tabIndex = 0;
		this._content.style.outline = 'none';
		this._container.appendChild(this._content);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._followCheckbox, 'change', () => {
			this._autoFollow = this._followCheckbox.checked;
		}));
		this._register(addDisposableListener(this._clearButton, 'click', () => {
			clearNode(this._content);
		}));

		if (filePath) {
			void this.loadFile(filePath);
		}
	}

	public async loadFile(path: string): Promise<void> {
		try {
			const fs = require('node:fs/promises');
			const content = await fs.readFile(path, 'utf8');
			this.setContent(content);
			this._titleLabel.textContent = Path.basename(path);
			this._titleLabel.title = path;
		} catch (err) {
			this.appendLine(`[ERROR] Gagal membaca file log: ${String(err)}`);
		}
	}

	public setContent(text: string): void {
		clearNode(this._content);
		const lines = text.split(/\r?\n/);
		for (const line of lines) {
			this._renderLine(line);
		}
		this._scrollToBottom();
	}

	public appendLine(line: string): void {
		this._renderLine(line);
		if (this._autoFollow) {
			this._scrollToBottom();
		}
	}

	public clear(): void {
		clearNode(this._content);
	}

	public static tokenize(line: string): ILogLineToken[] {
		const tokens: ILogLineToken[] = [];

		const timestampMatch = /^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(line);
		let rest = line;
		if (timestampMatch) {
			tokens.push({ text: timestampMatch[1], color: '#6a9955' });
			rest = line.substring(timestampMatch[1].length);
		}

		const levelMatch = /^(\s*)(\[?(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE|VERBOSE)\]?)(\s*)/i.exec(rest);
		if (levelMatch) {
			const level = levelMatch[2].toUpperCase();
			let color = '#3794ff';
			if (level.includes('ERROR') || level.includes('FATAL')) {
				color = '#f14c4c';
			} else if (level.includes('WARN')) {
				color = '#e5e510';
			} else if (level.includes('DEBUG') || level.includes('TRACE') || level.includes('VERBOSE')) {
				color = '#8a8a8a';
			}
			tokens.push({ text: levelMatch[1], color: '#cccccc' });
			tokens.push({ text: levelMatch[2], color });
			rest = rest.substring(levelMatch[0].length);
		}

		const pathPattern = /([A-Za-z]:\\[^\s:;]+|\/[^\s:;]+\.[A-Za-z0-9]+)/;
		let cursor = 0;
		for (const match of rest.matchAll(new RegExp(pathPattern.source, 'g'))) {
			if (match.index === undefined) {
				continue;
			}
			if (match.index > cursor) {
				tokens.push({ text: rest.substring(cursor, match.index), color: '#cccccc' });
			}
			tokens.push({ text: match[1], color: '#4ec9b0' });
			cursor = match.index + match[1].length;
		}
		if (cursor < rest.length) {
			tokens.push({ text: rest.substring(cursor), color: '#cccccc' });
		}
		return tokens;
	}

	private _renderLine(line: string): void {
		const row = $<HTMLElement>('div', 'dc-log-line');
		for (const token of LogViewer.tokenize(line)) {
			if (LogViewer.isFilePathToken(token.text) && this._filePath) {
				const link = $<HTMLElement>('span', 'dc-log-link');
				link.textContent = token.text;
				link.addEventListener('click', () => this._onDidOpenFile.fire(token.text));
				row.appendChild(link);
			} else {
				const span = $<HTMLElement>('span');
				span.textContent = token.text;
				span.style.color = token.color;
				row.appendChild(span);
			}
		}
		this._content.appendChild(row);
	}

	private static isFilePathToken(text: string): boolean {
		return /\.(ts|js|jsx|tsx|json|log|txt|css|html|md)$/i.test(text);
	}

	private _scrollToBottom(): void {
		this._content.scrollTop = this._content.scrollHeight;
	}
}
