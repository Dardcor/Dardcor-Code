import { app } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CLIOutput } from '../cli/cli-output.js';
import { formatBytes } from './native-file-trash.js';
import { getGpuStatus } from './gpu-acceleration.js';
import { getProcessTree, ProcessInfo } from './process-monitor-tree.js';
import { getV8Flags } from './v8-flags-main.js';

export interface DiagnosticReport {
	version: string;
	name: string;
	platform: string;
	arch: string;
	release: string;
	cpuModel: string;
	cpuCores: number;
	totalMemory: number;
	freeMemory: number;
	nodeVersion: string;
	electronVersion: string;
	chromeVersion: string;
	v8Version: string;
	gpu: Record<string, unknown> | null;
	processes: ProcessInfo[];
	v8Flags: string[];
	userDataPath: string;
	appPath: string;
	extensions: string[];
	locale: string;
	uptime: number;
	timestamp: string;
}

export function getExtensionsDir(): string {
	return path.join(app.getPath('userData'), 'extensions');
}

export function listExtensions(): string[] {
	const dir = getExtensionsDir();
	try {
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isFile())
			.map((entry) => entry.name)
			.filter((name) => !name.startsWith('.'));
	} catch {
		return [];
	}
}

export async function collectDiagnostics(): Promise<DiagnosticReport> {
	const gpu = getGpuStatus();
	const processes = await getProcessTree();
	const cpu = os.cpus();
	const report: DiagnosticReport = {
		version: app.getVersion(),
		name: app.getName(),
		platform: process.platform,
		arch: process.arch,
		release: os.release(),
		cpuModel: cpu.length > 0 ? cpu[0].model : 'Unknown',
		cpuCores: cpu.length,
		totalMemory: os.totalmem(),
		freeMemory: os.freemem(),
		nodeVersion: process.versions.node,
		electronVersion: process.versions.electron,
		chromeVersion: process.versions.chrome,
		v8Version: process.versions.v8,
		gpu: gpu.featureStatus ? { ...gpu.featureStatus, enabled: gpu.enabled } : { enabled: gpu.enabled },
		processes,
		v8Flags: getV8Flags(),
		userDataPath: app.getPath('userData'),
		appPath: app.getAppPath(),
		extensions: listExtensions(),
		locale: app.getLocale(),
		uptime: Math.floor(process.uptime()),
		timestamp: new Date().toISOString()
	};
	return report;
}

export function formatDiagnostics(report: DiagnosticReport): string {
	const lines: string[] = [];
	lines.push(`Dardcor Code Diagnostics`);
	lines.push(`=======================`);
	lines.push(`Version: ${report.version}`);
	lines.push(`Platform: ${report.platform} ${report.arch} (${report.release})`);
	lines.push(`CPU: ${report.cpuModel} (${report.cpuCores} cores)`);
	lines.push(`Memory: ${formatBytes(report.totalMemory)} total, ${formatBytes(report.freeMemory)} free`);
	lines.push(`Node: ${report.nodeVersion}`);
	lines.push(`Electron: ${report.electronVersion}`);
	lines.push(`Chromium: ${report.chromeVersion}`);
	lines.push(`V8: ${report.v8Version}`);
	lines.push(`Locale: ${report.locale}`);
	lines.push(`Uptime: ${report.uptime}s`);
	lines.push(`User data: ${report.userDataPath}`);
	lines.push(`App path: ${report.appPath}`);
	lines.push(`V8 flags: ${report.v8Flags.join(' ') || '(none)'}`);
	lines.push(`GPU: ${report.gpu?.enabled ? 'enabled' : 'disabled'}`);
	lines.push(`Extensions (${report.extensions.length}):`);
	for (const extension of report.extensions) {
		lines.push(`  - ${extension}`);
	}
	lines.push(`Processes (${report.processes.length}):`);
	for (const process of report.processes) {
		lines.push(`  - ${process.name} (PID ${process.pid}): ${formatBytes(process.memory ?? 0)}`);
		for (const child of process.children ?? []) {
			lines.push(`      - ${child.name} (PID ${child.pid}): ${formatBytes(child.memory ?? 0)}`);
		}
	}
	return lines.join('\n');
}

export function printDiagnostics(output: CLIOutput): Promise<void> {
	return collectDiagnostics().then((report) => {
		output.out(formatDiagnostics(report));
	});
}

export function printDiagnosticsSummary(output: CLIOutput): Promise<void> {
	return collectDiagnostics().then((report) => {
		output.table([
			['Version', report.version],
			['Platform', `${report.platform} ${report.arch}`],
			['Node', report.nodeVersion],
			['Electron', report.electronVersion],
			['Chromium', report.chromeVersion],
			['V8', report.v8Version],
			['Memory', `${formatBytes(report.freeMemory)} free of ${formatBytes(report.totalMemory)}`],
			['Extensions', String(report.extensions.length)]
		]);
	});
}

export function getDiagnosticsFilePath(): string {
	return path.join(app.getPath('userData'), 'diagnostics.json');
}

export async function writeDiagnosticsFile(): Promise<string> {
	const report = await collectDiagnostics();
	const filePath = getDiagnosticsFilePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
	return filePath;
}

export async function writeDiagnosticsTextFile(): Promise<string> {
	const report = await collectDiagnostics();
	const filePath = path.join(app.getPath('userData'), 'diagnostics.txt');
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, formatDiagnostics(report), 'utf-8');
	return filePath;
}
