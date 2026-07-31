import { Emitter, Event } from '../../core/events/emitter';

export interface IContainerEnvOptions {
	readonly sanitizeSensitive?: boolean;
	readonly containerEnv?: Record<string, string>;
}

const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|passwd|api[-_]?key|auth|credential|private[-_]?key|access[-_]?key)/i;
const BLOCKED_KEYS = ['HOME', 'SHELL', 'USER', 'LOGNAME', 'HOSTNAME', 'TERM_PROGRAM'];

export function parseEnvArray(entries: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const entry of entries) {
		const index = entry.indexOf('=');
		if (index === -1) {
			continue;
		}
		result[entry.slice(0, index).trim()] = entry.slice(index + 1);
	}
	return result;
}

export function parseEnvObject(entries: Record<string, unknown>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(entries)) {
		if (value === undefined || value === null) {
			continue;
		}
		result[key] = String(value);
	}
	return result;
}

export function envToArray(env: Record<string, string>): string[] {
	return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERN.test(key);
}

export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (isSensitiveKey(key)) {
			continue;
		}
		result[key] = value;
	}
	return result;
}

export function parseDotEnv(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith('export ')) {
			continue;
		}
		const index = line.indexOf('=');
		if (index === -1) {
			continue;
		}
		const key = line.slice(0, index).trim();
		if (!key) {
			continue;
		}
		let value = line.slice(index + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		const commentIndex = value.indexOf(' #');
		if (commentIndex !== -1) {
			value = value.slice(0, commentIndex).trim();
		}
		result[key] = value;
	}
	return result;
}

export class ContainerEnvVars {
	private readonly _containerEnv: Record<string, string>;
	private readonly _sanitizeSensitive: boolean;

	constructor(options: IContainerEnvOptions = {}) {
		this._containerEnv = { ...(options.containerEnv ?? {}) };
		this._sanitizeSensitive = options.sanitizeSensitive ?? true;
	}

	setContainerEnv(env: Record<string, string>): void {
		for (const [key, value] of Object.entries(env)) {
			this._containerEnv[key] = value;
		}
	}

	unset(key: string): void {
		delete this._containerEnv[key];
	}

	getContainerEnv(config?: { env?: Record<string, unknown> }): Record<string, string> {
		const result: Record<string, string> = { ...this._containerEnv };
		if (config?.env) {
			Object.assign(result, parseEnvObject(config.env));
		}
		if (this._sanitizeSensitive) {
			return sanitizeEnv(result);
		}
		return result;
	}

	injectEnv(taskEnv: Record<string, string>, containerEnv: Record<string, string>): Record<string, string> {
		const result: Record<string, string> = { ...containerEnv };
		for (const [key, value] of Object.entries(taskEnv)) {
			if (key.startsWith('DC_') || key.startsWith('DCC_') || !isSensitiveKey(key)) {
				result[key] = value;
			}
		}
		return result;
	}

	merge(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
		const result: Record<string, string> = {};
		for (const source of sources) {
			if (source) {
				Object.assign(result, source);
			}
		}
		return result;
	}

	filterAllowed(env: Record<string, string>, allowedKeys: string[]): Record<string, string> {
		const result: Record<string, string> = {};
		for (const key of allowedKeys) {
			if (key in env) {
				result[key] = env[key];
			}
		}
		return result;
	}

	filterBlocked(env: Record<string, string>): Record<string, string> {
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(env)) {
			if (!BLOCKED_KEYS.includes(key) && !isSensitiveKey(key)) {
				result[key] = value;
			}
		}
		return result;
	}

	toArray(env: Record<string, string>): string[] {
		return envToArray(env);
	}

	readDotEnv(content: string): Record<string, string> {
		return parseDotEnv(content);
	}

	readEnvFile(content: string): Record<string, string> {
		return parseDotEnv(content);
	}
}

export const DEFAULT_CONTAINER_ENV: Record<string, string> = {
	DC_REMOTE_DEV_CONTAINER: '1',
	LANG: 'C.UTF-8',
	TERM: 'xterm-256color'
};
