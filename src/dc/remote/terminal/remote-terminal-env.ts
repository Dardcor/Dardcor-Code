import { Emitter, Event } from '../../core/events/emitter';

export const DEFAULT_TERMINAL_ENV: Record<string, string> = {
	TERM: 'xterm-256color',
	COLORTERM: 'truecolor',
	LANG: 'en_US.UTF-8',
	LC_ALL: 'en_US.UTF-8',
	TERM_PROGRAM: 'Dardcor Code',
	TERM_PROGRAM_VERSION: '1.0.0'
};

export function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const index = line.indexOf('=');
		if (index === -1) {
			continue;
		}
		const key = line.slice(0, index).trim();
		let value = line.slice(index + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

export function expandEnvValue(value: string, env: Record<string, string>): string {
	return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, plain) => {
		const name = braced ?? plain;
		return name in env ? env[name] : match;
	});
}

export function resolveEnv(base: Record<string, string>, shellEnv: Record<string, string>, vars: string[]): Record<string, string> {
	const merged: Record<string, string> = { ...base };
	for (const [key, value] of Object.entries(shellEnv)) {
		if (vars.length === 0 || vars.includes(key)) {
			merged[key] = value;
		}
	}
	const expanded: Record<string, string> = {};
	for (const [key, value] of Object.entries(merged)) {
		expanded[key] = expandEnvValue(value, merged);
	}
	return expanded;
}

export class RemoteTerminalEnv {
	private readonly _defaults: Record<string, string>;

	private readonly _onDidChange = new Emitter<Record<string, string>>();
	readonly onDidChange: Event<Record<string, string>> = this._onDidChange.event;

	constructor(defaults: Record<string, string> = {}) {
		this._defaults = { ...DEFAULT_TERMINAL_ENV, ...defaults };
	}

	resolveEnv(base: Record<string, string>, shellEnv: Record<string, string>, vars: string[] = []): Record<string, string> {
		return resolveEnv(base, shellEnv, vars);
	}

	resolve(base: Record<string, string>, shellEnv: Record<string, string>): Record<string, string> {
		return resolveEnv(base, shellEnv, []);
	}

	parseEnvFile(content: string): Record<string, string> {
		return parseEnvFile(content);
	}

	mergeDefaults(env: Record<string, string> = {}): Record<string, string> {
		return { ...this._defaults, ...env };
	}

	setDefault(key: string, value: string): void {
		this._defaults[key] = value;
		this._onDidChange.fire({ ...this._defaults });
	}

	getDefaults(): Record<string, string> {
		return { ...this._defaults };
	}

	buildTerminalEnv(shellEnv: Record<string, string> | undefined, extra: Record<string, string> = {}): Record<string, string> {
		const base = shellEnv ? this.mergeDefaults(shellEnv) : this.mergeDefaults();
		return resolveEnv(base, extra, []);
	}

	withInjected(base: Record<string, string>, vars: string[], injected: Record<string, string>): Record<string, string> {
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(base)) {
			if (vars.length === 0 || vars.includes(key)) {
				result[key] = value;
			}
		}
		return { ...result, ...injected };
	}

	diff(prev: Record<string, string>, next: Record<string, string>): { added: Record<string, string>; removed: string[]; changed: string[] } {
		const added: Record<string, string> = {};
		const removed: string[] = [];
		const changed: string[] = [];
		for (const [key, value] of Object.entries(next)) {
			if (!(key in prev)) {
				added[key] = value;
			} else if (prev[key] !== value) {
				changed.push(key);
			}
		}
		for (const key of Object.keys(prev)) {
			if (!(key in next)) {
				removed.push(key);
			}
		}
		return { added, removed, changed };
	}
}
