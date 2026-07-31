import { app } from 'electron';

export const DEFAULT_V8_FLAGS: string[] = [
	'--max-old-space-size=4096',
	'--max-semi-space-size=64'
];

export function getV8Flags(): string[] {
	const current = app.commandLine.getSwitchValue('js-flags');
	if (!current) {
		return [];
	}
	return current.split(/\s+/).filter((flag) => flag.length > 0);
}

export function getV8FlagsWithDefaults(): string[] {
	const current = getV8Flags();
	const seen = new Set(current);
	const defaults = DEFAULT_V8_FLAGS.filter((flag) => !seen.has(flag));
	return [...current, ...defaults];
}

export function applyV8Flags(flags?: string[]): void {
	const target = flags ?? DEFAULT_V8_FLAGS;
	const current = app.commandLine.getSwitchValue('js-flags');
	const existing = current ? current.split(/\s+/).filter((f) => f.length > 0) : [];
	const seen = new Set(existing);
	const toAdd = target.filter((flag) => !seen.has(flag));
	if (toAdd.length > 0) {
		app.commandLine.appendSwitch('js-flags', [...existing, ...toAdd].join(' '));
	}
}

export function applyDefaultV8Flags(): void {
	applyV8Flags(DEFAULT_V8_FLAGS);
}

export function addV8Flag(flag: string): void {
	applyV8Flags([flag]);
}

export function hasV8Flag(flag: string): boolean {
	const flagName = flag.replace(/^--?/, '').split('=')[0];
	const normalized = `--${flagName}`;
	return getV8Flags().some((f) => f.split('=')[0] === normalized);
}

export function removeV8Flag(flag: string): void {
	const flagName = flag.replace(/^--?/, '').split('=')[0];
	const normalized = `--${flagName}`;
	const flags = getV8Flags().filter((f) => f.split('=')[0] !== normalized);
	if (flags.length === 0) {
		app.commandLine.removeSwitch('js-flags');
		return;
	}
	app.commandLine.appendSwitch('js-flags', flags.join(' '));
}

export function getFlagValue(flagName: string): string | null {
	const normalized = `--${flagName.replace(/^--?/, '')}`;
	const match = getV8Flags().find((f) => f.startsWith(`${normalized}=`));
	if (!match) {
		return null;
	}
	return match.slice(normalized.length + 1);
}

export function getMaxOldSpaceSizeMb(): number {
	const value = getFlagValue('max-old-space-size');
	return value ? Number(value) : 4096;
}

export function getV8Version(): string {
	return process.versions.v8;
}

export function isV8FlagSupported(flag: string): boolean {
	try {
		const match = /^--?([a-z0-9-]+)(?:=(.*))?$/.exec(flag);
		return !!match;
	} catch {
		return false;
	}
}
