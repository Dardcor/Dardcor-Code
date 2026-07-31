/**
 * Dardcor Code - Command Error Auto-Correction Quick Fix Provider in Terminal
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';

const QUICK_FIX_STYLE_ID = 'dc-terminal-quick-fix-styles';

export interface ITerminalQuickFix {
	readonly id: string;
	readonly original: string;
	readonly suggestion: string;
	readonly reason: string;
}

export interface ITerminalQuickFixOptions {
	readonly knownCommands?: string[];
	readonly maxSuggestions?: number;
}

const COMMON_COMMANDS = [
	'git', 'npm', 'npx', 'node', 'pnpm', 'yarn', 'tsc', 'deno', 'bun',
	'cd', 'dir', 'ls', 'mkdir', 'rm', 'cp', 'move', 'echo', 'type',
	'powershell', 'cmd', 'code', 'curl', 'wget', 'python', 'python3',
	'docker', 'kubectl', 'clear', 'cls', 'help', 'exit', 'pwd'
];

export class TerminalQuickFix extends Disposable {
	private readonly _onDidApply = this._register(new Emitter<ITerminalQuickFix>());
	readonly onDidApply: Event<ITerminalQuickFix> = this._onDidApply.event;

	private readonly _container: HTMLElement;
	private readonly _knownCommands: string[];
	private readonly _maxSuggestions: number;
	private _currentFix: ITerminalQuickFix | undefined;

	constructor(parentDom: HTMLElement, options: ITerminalQuickFixOptions = {}) {
		super();
		this._knownCommands = options.knownCommands ?? COMMON_COMMANDS;
		this._maxSuggestions = options.maxSuggestions ?? 3;

		CssInjector.inject(QUICK_FIX_STYLE_ID, `
			.dc-terminal-quickfix { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: #3a3d41; border-bottom: 1px solid #2a2d2e; font-size: 12px; color: #cccccc; }
			.dc-terminal-quickfix button { background: #0e639c; border: none; color: white; border-radius: 2px; font-size: 11px; padding: 2px 10px; cursor: pointer; }
		`);

		this._container = $<HTMLElement>('div', 'dc-terminal-quickfix');
		this._container.style.cssText = 'display:none;align-items:center;gap:8px;padding:4px 10px;background:#3a3d41;border-bottom:1px solid #2a2d2e;font-size:12px;color:#cccccc;';
		parentDom.appendChild(this._container);
	}

	get currentFix(): ITerminalQuickFix | undefined {
		return this._currentFix;
	}

	public feedOutput(text: string): ITerminalQuickFix | undefined {
		for (const line of text.split(/\r?\n/)) {
			const fix = TerminalQuickFix.detect(line, this._knownCommands, this._maxSuggestions);
			if (fix) {
				this.show(fix);
				return fix;
			}
		}
		return undefined;
	}

	public detect(input: string): ITerminalQuickFix | undefined {
		return TerminalQuickFix.detect(input, this._knownCommands, this._maxSuggestions);
	}

	public show(fix: ITerminalQuickFix): void {
		this._currentFix = fix;
		clearNode(this._container);
		this._container.style.display = 'flex';

		const label = $<HTMLElement>('span');
		label.textContent = fix.reason;
		label.style.flex = '1';

		const suggestion = $<HTMLElement>('code');
		suggestion.textContent = fix.suggestion;
		suggestion.style.cssText = 'background:#1e1e1e;border-radius:2px;padding:1px 6px;font-family:Consolas,monospace;font-size:11px;color:#23d18b;';

		const applyBtn = $<HTMLButtonElement>('button');
		applyBtn.textContent = 'Terapkan';
		applyBtn.addEventListener('click', () => {
			this._onDidApply.fire(fix);
			this.hide();
		});

		const dismissBtn = $<HTMLButtonElement>('button');
		dismissBtn.textContent = '\u2716';
		dismissBtn.title = 'Tutup';
		dismissBtn.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:10px;padding:2px;';
		dismissBtn.addEventListener('click', () => this.hide());

		this._container.appendChild(label);
		this._container.appendChild(suggestion);
		this._container.appendChild(applyBtn);
		this._container.appendChild(dismissBtn);
	}

	public hide(): void {
		this._currentFix = undefined;
		this._container.style.display = 'none';
	}

	public static detect(line: string, knownCommands: string[] = COMMON_COMMANDS, maxSuggestions = 3): ITerminalQuickFix | undefined {
		const normalized = line.trim();
		const commandMatch = /^([^:\s]+)\s*:\s*.*(?:not\s+(?:recognized|found)|bukan\s+perintah|command\s+not\s+found)/i.exec(normalized);
		let command = commandMatch?.[1];

		if (!command) {
			const windowsMatch = /^'([^']+)'\s+is\s+not\s+recognized/i.exec(normalized);
			const bashMatch = /^([^:\s]+):\s+command\s+not\s+found/i.exec(normalized);
			command = windowsMatch?.[1] ?? bashMatch?.[1];
		}
		if (!command) {
			return undefined;
		}

		const base = command.replace(/^[\s"'`]+|[\s"'`]+$/g, '');
		const suggestion = TerminalQuickFix.suggestCommand(base, knownCommands, maxSuggestions);
		if (!suggestion) {
			return undefined;
		}

		return {
			id: `fix-${Date.now()}`,
			original: base,
			suggestion,
			reason: `Perintah "${base}" tidak dikenal. Mungkin maksud Anda:`
		};
	}

	public static suggestCommand(command: string, knownCommands: string[] = COMMON_COMMANDS, maxSuggestions = 3): string | undefined {
		const candidates = knownCommands
			.map(cmd => ({ cmd, distance: TerminalQuickFix.levenshtein(command, cmd) }))
			.filter(item => item.distance <= Math.max(2, Math.floor(command.length / 3)))
			.sort((a, b) => a.distance - b.distance);

		if (candidates.length === 0) {
			return undefined;
		}
		const best = candidates[0];
		if (best.distance > 2 && best.cmd.length > 4) {
			return undefined;
		}
		const suggestions = candidates.slice(0, maxSuggestions).map(item => item.cmd);
		return suggestions.length === 1 ? suggestions[0] : suggestions.join(' / ');
	}

	public static levenshtein(a: string, b: string): number {
		const m = a.length;
		const n = b.length;
		const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
		for (let i = 0; i <= m; i++) {
			dp[i][0] = i;
		}
		for (let j = 0; j <= n; j++) {
			dp[0][j] = j;
		}
		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				const cost = a[i - 1] === b[j - 1] ? 0 : 1;
				dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
			}
		}
		return dp[m][n];
	}
}
