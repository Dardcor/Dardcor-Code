/**
 * Dardcor Code - OS Info Monitor (Task 97)
 */
declare const process: any;

export interface ISystemInfo {
	platform: string;
	arch: string;
	cpuCount: number;
	totalMemoryMB: number;
	freeMemoryMB: number;
	uptime: number;
}

export function getSystemInfo(): ISystemInfo {
	if (typeof process !== 'undefined' && process.platform) {
		try {
			const os = require('os');
			return {
				platform: process.platform,
				arch: process.arch,
				cpuCount: os.cpus?.()?.length ?? navigator.hardwareConcurrency ?? 1,
				totalMemoryMB: Math.round((os.totalmem?.() ?? 0) / (1024 * 1024)),
				freeMemoryMB: Math.round((os.freemem?.() ?? 0) / (1024 * 1024)),
				uptime: os.uptime?.() ?? 0,
			};
		} catch { /* fallthrough */ }
	}
	return {
		platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
		arch: 'unknown',
		cpuCount: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
		totalMemoryMB: 0,
		freeMemoryMB: 0,
		uptime: 0,
	};
}

export function getMemoryUsage(): { heapUsedMB: number; heapTotalMB: number } | null {
	if (typeof process !== 'undefined' && process.memoryUsage) {
		const m = process.memoryUsage();
		return { heapUsedMB: Math.round(m.heapUsed / (1024 * 1024)), heapTotalMB: Math.round(m.heapTotal / (1024 * 1024)) };
	}
	if (typeof performance !== 'undefined' && (performance as any).memory) {
		const m = (performance as any).memory;
		return { heapUsedMB: Math.round(m.usedJSHeapSize / (1024 * 1024)), heapTotalMB: Math.round(m.totalJSHeapSize / (1024 * 1024)) };
	}
	return null;
}
