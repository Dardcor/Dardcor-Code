import os from 'node:os';
import { access, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Emitter, Event } from '../../core/events/emitter.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface IHealthCheckResult {
	readonly name: string;
	readonly ok: boolean;
	readonly detail: string;
}

export interface IServerHealthStatus {
	readonly status: 'ok' | 'degraded' | 'down';
	readonly uptime: number;
	readonly version: string;
	readonly memory: { total: number; free: number; usagePercent: number };
	readonly cpu: { count: number; loadAverage: number[] };
	readonly checks: IHealthCheckResult[];
	readonly timestamp: number;
}

export interface IHealthCheckOptions {
	readonly workspaceRoot?: string;
	readonly minimumFreeMemoryPercent?: number;
	readonly serverVersion?: string;
}

const PROBE_FILE_NAME = '.dc-health-probe';

export class ServerHealthCheck {
	private readonly _workspaceRoot?: string;
	private readonly _minimumFreeMemoryPercent: number;
	private readonly _serverVersion: string;
	private readonly _startedAt = Date.now();

	private readonly _onDidRunChecks = new Emitter<IHealthCheckResult[]>();
	readonly onDidRunChecks: Event<IHealthCheckResult[]> = this._onDidRunChecks.event;

	constructor(options: IHealthCheckOptions = {}) {
		this._workspaceRoot = options.workspaceRoot;
		this._minimumFreeMemoryPercent = options.minimumFreeMemoryPercent ?? 10;
		this._serverVersion = options.serverVersion ?? '1.0.0';
	}

	get uptime(): number {
		return Math.floor((Date.now() - this._startedAt) / 1000);
	}

	async runChecks(): Promise<IHealthCheckResult[]> {
		const checks: IHealthCheckResult[] = [];
		checks.push(this._checkMemory());
		checks.push(await this._checkWorkspace());
		checks.push(this._checkCpu());
		checks.push(this._checkNodeVersion());
		checks.push(this._checkUptime());
		this._onDidRunChecks.fire(checks);
		return checks;
	}

	async getStatus(): Promise<IServerHealthStatus> {
		const checks = await this.runChecks();
		const failed = checks.filter(check => !check.ok);
		const status = failed.length === 0 ? 'ok' : failed.some(check => check.name === 'workspace') ? 'down' : 'degraded';
		return {
			status,
			uptime: this.uptime,
			version: this._serverVersion,
			memory: {
				total: os.totalmem(),
				free: os.freemem(),
				usagePercent: Math.round(((os.totalmem() - os.freemem()) / Math.max(1, os.totalmem())) * 100)
			},
			cpu: {
				count: os.cpus().length,
				loadAverage: os.loadavg()
			},
			checks,
			timestamp: Date.now()
		};
	}

	healthEndpoint(request: IncomingMessage, response: ServerResponse): void {
		void this.getStatus().then(status => {
			const code = status.status === 'ok' ? 200 : 503;
			response.writeHead(code, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify(status, null, 2));
		}).catch(error => {
			response.writeHead(500, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ status: 'down', error: error instanceof Error ? error.message : String(error) }));
		});
	}

	async isHealthy(): Promise<boolean> {
		const checks = await this.runChecks();
		return checks.every(check => check.ok);
	}

	private _checkMemory(): IHealthCheckResult {
		const total = os.totalmem();
		const free = os.freemem();
		const percent = (free / Math.max(1, total)) * 100;
		const ok = percent >= this._minimumFreeMemoryPercent;
		return {
			name: 'memory',
			ok,
			detail: `${Math.round(percent)}% free (${Math.round(free / 1024 / 1024)}MB of ${Math.round(total / 1024 / 1024)}MB)`
		};
	}

	private async _checkWorkspace(): IHealthCheckResult {
		if (!this._workspaceRoot) {
			return { name: 'workspace', ok: true, detail: 'no workspace root configured' };
		}
		try {
			const probePath = join(this._workspaceRoot, PROBE_FILE_NAME);
			await writeFile(probePath, 'ok', 'utf8');
			await unlink(probePath);
			return { name: 'workspace', ok: true, detail: `writable: ${this._workspaceRoot}` };
		} catch (error) {
			return {
				name: 'workspace',
				ok: false,
				detail: `not writable: ${this._workspaceRoot} (${error instanceof Error ? error.message : String(error)})`
			};
		}
	}

	private _checkCpu(): IHealthCheckResult {
		const load = os.loadavg();
		const cores = os.cpus().length;
		const ok = load[0] < cores * 2;
		return {
			name: 'cpu',
			ok,
			detail: `load average ${load.map(value => value.toFixed(2)).join(', ')} on ${cores} cores`
		};
	}

	private _checkNodeVersion(): IHealthCheckResult {
		if (typeof process === 'undefined') {
			return { name: 'node', ok: false, detail: 'process not available' };
		}
		const version = process.version ?? 'unknown';
		const major = Number(version.split('.')[0]?.slice(1));
		const ok = major >= 18;
		return { name: 'node', ok, detail: `node ${version}` };
	}

	private _checkUptime(): IHealthCheckResult {
		const seconds = this.uptime;
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return { name: 'uptime', ok: true, detail: `${hours}h ${minutes}m` };
	}
}

export function writeHealthProbe(dirPath: string): Promise<void> {
	return writeFile(join(dirPath, PROBE_FILE_NAME), 'ok', 'utf8');
}

export function readHealthProbe(dirPath: string): Promise<string> {
	return access(join(dirPath, PROBE_FILE_NAME)).then(() => 'ok');
}

export function getTempProbePath(): string {
	return join(tmpdir(), PROBE_FILE_NAME);
}
