/**
 * Dardcor Code - Debug Console Output & Expression Evaluation Panel
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { DebugSession } from './debug-session.js';

const DEBUG_CONSOLE_STYLE_ID = 'dc-debug-console-styles';

export type DebugConsoleSeverity = 'info' | 'error' | 'warning' | 'output';

export interface IDebugConsoleMessage {
	readonly text: string;
	readonly severity: DebugConsoleSeverity;
	readonly timestamp: number;
}

export class DebugConsole extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _container: HTMLElement;
	private readonly _messagesContainer: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _session: DebugSession | undefined;
	private _messages: IDebugConsoleMessage[] = [];
	private _history: string[] = [];
	private _historyIndex = -1;
	private _evaluatedVariables = new Map<string, string>();

	constructor(parentDom: HTMLElement, session?: DebugSession) {
		super();
		this._session = session;

		CssInjector.inject(DEBUG_CONSOLE_STYLE_ID, `
			.dc-debug-console-msg-info { color:#cccccc; }
			.dc-debug-console-msg-error { color:#f14c4c; }
			.dc-debug-console-msg-warning { color:#dcdcaa; }
			.dc-debug-console-msg-output { color:#9cdcfe; }
		`);

		this._container = $<HTMLElement>('div', 'dc-debug-console');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#1e1e1e;overflow:hidden;';

		this._messagesContainer = $<HTMLElement>('div');
		this._messagesContainer.style.cssText = 'flex:1;overflow-y:auto;padding:8px 12px;font-family:Consolas,monospace;font-size:12px;';
		this._container.appendChild(this._messagesContainer);

		const inputRow = $<HTMLElement>('div');
		inputRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;border-top:1px solid #2a2d2e;';

		const prompt = $<HTMLElement>('span');
		prompt.textContent = '>';
		prompt.style.cssText = 'color:#4ec9b0;font-weight:bold;font-family:Consolas,monospace;';

		this._input = $<HTMLInputElement>('input');
		this._input.placeholder = 'Evaluasi ekspresi\u2026';
		this._input.style.cssText = 'flex:1;background:transparent;border:none;color:#cccccc;font-family:Consolas,monospace;font-size:12px;outline:none;';
		this._input.spellcheck = false;

		inputRow.appendChild(prompt);
		inputRow.appendChild(this._input);
		this._container.appendChild(inputRow);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._input, 'keydown', (e) => {
			const ev = e as KeyboardEvent;
			if (ev.key === 'Enter') {
				void this.evaluate(this._input.value);
			} else if (ev.key === 'ArrowUp') {
				ev.preventDefault();
				this._historyIndex = Math.min(this._historyIndex + 1, this._history.length - 1);
				this._input.value = this._history[this._history.length - 1 - this._historyIndex] ?? '';
			} else if (ev.key === 'ArrowDown') {
				ev.preventDefault();
				this._historyIndex = Math.max(this._historyIndex - 1, -1);
				this._input.value = this._historyIndex === -1 ? '' : (this._history[this._history.length - 1 - this._historyIndex] ?? '');
			}
		}));

		if (this._session) {
			this._register(this._session.onDidChangeState(() => {
				this._onDidChange.fire();
			}));
		}
	}

	get messages(): IDebugConsoleMessage[] {
		return [...this._messages];
	}

	public append(text: string, severity: DebugConsoleSeverity = 'output'): void {
		this._messages.push({ text, severity, timestamp: Date.now() });
		this._onDidChange.fire();
		this.render();
	}

	public clear(): void {
		this._messages = [];
		this._evaluatedVariables.clear();
		this._onDidChange.fire();
		this.render();
	}

	public getEvaluatedVariable(name: string): string | undefined {
		return this._evaluatedVariables.get(name);
	}

	public async evaluate(expression: string): Promise<void> {
		const trimmed = expression.trim();
		if (!trimmed) {
			return;
		}
		this.append(`> ${trimmed}`, 'output');
		this._history.push(trimmed);
		this._historyIndex = -1;
		this._input.value = '';
		if (!this._session) {
			this.append('Tidak ada sesi debug aktif.', 'warning');
			return;
		}
		try {
			const result = await this._session.evaluate(trimmed);
			const text = result.result ?? '(tidak ada nilai)';
			this._evaluatedVariables.set(trimmed, text);
			this.append(String(text), 'output');
		} catch (err) {
			this.append(String(err), 'error');
		}
	}

	public render(): void {
		clearNode(this._messagesContainer);
		for (const msg of this._messages) {
			const line = $<HTMLElement>('div', `dc-debug-console-msg-${msg.severity}`);
			line.textContent = msg.text;
			line.style.cssText = 'white-space:pre-wrap;word-break:break-all;line-height:1.5;';
			this._messagesContainer.appendChild(line);
		}
		this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
	}
}
