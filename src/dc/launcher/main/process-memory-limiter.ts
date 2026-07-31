import { app } from 'electron';
import * as os from 'os';

export interface MemoryLimits {
	maxOldSpace: number;
	maxSemiSpace: number;
	maxNewSpace: number;
}

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
	maxOldSpace: 2048,
	maxSemiSpace: 64,
	maxNewSpace: 32
};

export function parseJsFlagValue(flags: string, flagName: string): number | null {
	const pattern = new RegExp(`--${flagName}=([0-9]+)`);
	const match = flags.match(pattern);
	if (!match) {
		return null;
	}
	const value = Number(match[1]);
	return isNaN(value) || value <= 0 ? null : value;
}

export function getMemoryLimits(): MemoryLimits {
	const flags = app.commandLine.getSwitchValue('js-flags');
	const limits: MemoryLimits = {
		maxOldSpace: parseJsFlagValue(flags, 'max-old-space-size') ?? DEFAULT_MEMORY_LIMITS.maxOldSpace,
		maxSemiSpace: parseJsFlagValue(flags, 'max-semi-space-size') ?? DEFAULT_MEMORY_LIMITS.maxSemiSpace,
		maxNewSpace: parseJsFlagValue(flags, 'max-new-space-size') ?? DEFAULT_MEMORY_LIMITS.maxNewSpace
	};
	return limits;
}

export function applyMemoryFlags(extra: string[] = []): void {
	const current = app.commandLine.getSwitchValue('js-flags');
	const existing = current ? current.split(' ') : [];
	const seen = new Set(existing);
	const flagsToAdd: string[] = [];
	const limits = getMemoryLimits();
	const defaults = [
		`--max-old-space-size=${limits.maxOldSpace}`,
		`--max-semi-space-size=${limits.maxSemiSpace}`,
		`--max-new-space-size=${limits.maxNewSpace}`
	];
	for (const flag of [...defaults, ...extra]) {
		if (!seen.has(flag)) {
			seen.add(flag);
			flagsToAdd.push(flag);
		}
	}
	if (flagsToAdd.length > 0) {
		app.commandLine.appendSwitch('js-flags', [...existing, ...flagsToAdd].join(' '));
	}
}

export function applyMemoryLimit(flagName: string, valueMb: number): void {
	app.commandLine.appendSwitch('js-flags', `--${flagName}=${valueMb}`);
}

export function getProcessMemoryInfo(): { rss: number; heapTotal: number; heapUsed: number; external: number } {
	const usage = process.memoryUsage();
	return {
		rss: usage.rss,
		heapTotal: usage.heapTotal,
		heapUsed: usage.heapUsed,
		external: usage.external
	};
}

export function isMemoryLimitExceeded(thresholdMb: number): boolean {
	const usage = process.memoryUsage();
	return usage.heapUsed > thresholdMb * 1024 * 1024;
}

export function getTotalSystemMemoryMb(): number {
	try {
		return Math.floor(os.totalmem() / (1024 * 1024));
	} catch {
		return 8192;
	}
}

export function getRecommendedHeapMb(): number {
	const totalMb = getTotalSystemMemoryMb();
	if (totalMb >= 16384) {
		return 8192;
	}
	if (totalMb >= 8192) {
		return 4096;
	}
	if (totalMb >= 4096) {
		return 2048;
	}
	return 1024;
}

export const V8_MEMORY_CONSTANTS = Object.freeze({
	...DEFAULT_MEMORY_LIMITS,
	get: (): MemoryLimits => getMemoryLimits()
});

export function applyRecommendedMemoryFlags(): void {
	const recommended = getRecommendedHeapMb();
	applyMemoryLimit('max-old-space-size', recommended);
}
