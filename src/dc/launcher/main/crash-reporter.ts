import { app, crashReporter } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface CrashReporterConfig {
	companyName?: string;
	productName?: string;
	submitURL?: string;
	uploadToServer?: boolean;
	ignoreSystemCrashHandler?: boolean;
	compress?: boolean;
	extra?: Record<string, string>;
}

let crashReporterStarted = false;

export function setupCrashReporter(config: CrashReporterConfig = {}): boolean {
	try {
		crashReporter.start({
			companyName: config.companyName ?? 'Dardcor',
			productName: config.productName ?? 'Dardcor Code',
			submitURL: config.submitURL ?? '',
			uploadToServer: config.uploadToServer ?? false,
			ignoreSystemCrashHandler: config.ignoreSystemCrashHandler ?? false,
			compress: config.compress ?? true,
			...(config.extra ? { extra: config.extra } : {})
		});
		crashReporterStarted = true;
		return true;
	} catch (err) {
		console.warn('[crash-reporter] failed to start:', err);
		return false;
	}
}

export function isCrashReporterEnabled(): boolean {
	return crashReporterStarted;
}

export function getCrashDumpsDir(): string {
	try {
		return app.getPath('crashDumps');
	} catch {
		return path.join(app.getPath('userData'), 'Crashpad');
	}
}

export function getLastCrashReport(): { path: string; time: number } | null {
	const dir = getCrashDumpsDir();
	try {
		if (!fs.existsSync(dir)) {
			return null;
		}
		const files = fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && /\.(dmp|dump)$/i.test(entry.name))
			.map((entry) => {
				const fullPath = path.join(dir, entry.name);
				return { path: fullPath, time: fs.statSync(fullPath).mtimeMs };
			})
			.sort((a, b) => b.time - a.time);
		if (files.length === 0) {
			return null;
		}
		return { path: files[0].path, time: files[0].time };
	} catch (err) {
		console.warn('[crash-reporter] getLastCrashReport failed:', err);
		return null;
	}
}

export function getAllCrashReports(): { path: string; time: number }[] {
	const dir = getCrashDumpsDir();
	try {
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && /\.(dmp|dump)$/i.test(entry.name))
			.map((entry) => {
				const fullPath = path.join(dir, entry.name);
				return { path: fullPath, time: fs.statSync(fullPath).mtimeMs };
			})
			.sort((a, b) => b.time - a.time);
	} catch {
		return [];
	}
}

export function clearCrashReports(): number {
	const dir = getCrashDumpsDir();
	try {
		if (!fs.existsSync(dir)) {
			return 0;
		}
		let removed = 0;
		for (const entry of fs.readdirSync(dir)) {
			if (/\.(dmp|dump)$/i.test(entry)) {
				try {
					fs.unlinkSync(path.join(dir, entry));
					removed++;
				} catch {
					// Ignore.
				}
			}
		}
		return removed;
	} catch {
		return 0;
	}
}

export function addCrashExtraParameter(key: string, value: string): void {
	try {
		crashReporter.addExtraParameter(key, value);
	} catch (err) {
		console.warn('[crash-reporter] addExtraParameter failed:', err);
	}
}

export function removeCrashExtraParameter(key: string): void {
	try {
		crashReporter.removeExtraParameter(key);
	} catch {
		// Ignore.
	}
}

export function getCrashReporterInfo(): { started: boolean; dumpsDir: string; lastCrash: string | null } {
	const last = getLastCrashReport();
	return {
		started: isCrashReporterEnabled(),
		dumpsDir: getCrashDumpsDir(),
		lastCrash: last ? last.path : null
	};
}
