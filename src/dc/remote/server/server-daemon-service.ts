import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Emitter, Event } from '../../core/events/emitter';

export const DAEMON_SERVICE_NAME = 'dc-remote-server';
export const DAEMON_LABEL = 'Dardcor Code Remote Server';

export interface IDaemonServiceOptions {
	readonly serviceName?: string;
	readonly port?: number;
	readonly host?: string;
	readonly workspaceRoot?: string;
	readonly token?: string;
	readonly nodePath?: string;
	readonly serverMainPath?: string;
}

export interface IDaemonStatus {
	readonly installed: boolean;
	readonly running: boolean;
	readonly pid?: number;
	readonly message?: string;
}

export class ServerDaemonService {
	private readonly _serviceName: string;
	private readonly _port: number;
	private readonly _host: string;
	private readonly _workspaceRoot: string;
	private readonly _token?: string;
	private readonly _nodePath: string;
	private readonly _serverMainPath: string;

	private readonly _onDidChange = new Emitter<IDaemonStatus>();
	readonly onDidChange: Event<IDaemonStatus> = this._onDidChange.event;

	constructor(options: IDaemonServiceOptions = {}) {
		this._serviceName = options.serviceName ?? DAEMON_SERVICE_NAME;
		this._port = options.port ?? 8080;
		this._host = options.host ?? '127.0.0.1';
		this._workspaceRoot = options.workspaceRoot ?? (typeof process !== 'undefined' ? process.cwd() : '.');
		this._token = options.token;
		this._nodePath = options.nodePath ?? (typeof process !== 'undefined' ? process.execPath : 'node');
		this._serverMainPath = options.serverMainPath ?? this._resolveServerMainPath();
	}

	get serviceName(): string {
		return this._serviceName;
	}

	get platform(): 'linux' | 'macos' | 'windows' | 'unknown' {
		if (typeof process === 'undefined' || typeof process.platform !== 'string') {
			return 'unknown';
		}
		if (process.platform === 'linux') {
			return 'linux';
		}
		if (process.platform === 'darwin') {
			return 'macos';
		}
		if (process.platform === 'win32') {
			return 'windows';
		}
		return 'unknown';
	}

	isSupported(): boolean {
		return this.platform === 'linux' || this.platform === 'macos';
	}

	getServiceFileContent(): string {
		if (this.platform === 'macos') {
			return this._launchdPlist();
		}
		return this._systemdUnit();
	}

	getServiceFilePath(): string {
		if (this.platform === 'macos') {
			return join(homedir(), 'Library', 'LaunchAgents', `${this._serviceName}.plist`);
		}
		if (typeof process !== 'undefined' && typeof process.getuid === 'function' && process.getuid() === 0) {
			return `/etc/systemd/system/${this._serviceName}.service`;
		}
		return join(homedir(), '.config', 'systemd', 'user', `${this._serviceName}.service`);
	}

	async install(): Promise<string> {
		if (!this.isSupported()) {
			throw new Error(`Automatic daemon install is not supported on ${this.platform}`);
		}
		const filePath = this.getServiceFilePath();
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, this.getServiceFileContent(), 'utf8');
		if (this.platform === 'linux') {
			await this._run(['systemctl', '--user', 'daemon-reload']).catch(() => undefined);
		}
		const status = await this.status();
		this._onDidChange.fire(status);
		return filePath;
	}

	async uninstall(): Promise<boolean> {
		const filePath = this.getServiceFilePath();
		if (!existsSync(filePath)) {
			return false;
		}
		await unlink(filePath);
		if (this.platform === 'linux') {
			await this._run(['systemctl', '--user', 'daemon-reload']).catch(() => undefined);
		}
		const status = await this.status();
		this._onDidChange.fire(status);
		return true;
	}

	isInstalled(): boolean {
		return existsSync(this.getServiceFilePath());
	}

	async status(): Promise<IDaemonStatus> {
		const installed = this.isInstalled();
		if (!installed) {
			return { installed: false, running: false };
		}
		if (this.platform === 'linux') {
			const result = await this._run(['systemctl', '--user', 'status', this._serviceName]);
			const running = result.exitCode === 0 && /active \(running\)/.test(result.stdout);
			const pidMatch = /Main PID: (\d+)/.exec(result.stdout);
			return {
				installed: true,
				running,
				pid: pidMatch ? Number(pidMatch[1]) : undefined,
				message: result.stdout.trim() || result.stderr.trim()
			};
		}
		const plistPath = this.getServiceFilePath();
		try {
			const content = await readFile(plistPath, 'utf8');
			const pidFile = /<key>PIDFile<\/key>\s*<string>(.*?)<\/string>/.exec(content);
			const running = pidFile ? existsSync(pidFile[1]) : false;
			return { installed: true, running, message: 'launchd service' };
		} catch {
			return { installed: true, running: false };
		}
	}

	async start(): Promise<IDaemonStatus> {
		if (!this.isInstalled()) {
			throw new Error('Daemon is not installed; run install() first');
		}
		if (this.platform === 'linux') {
			const result = await this._run(['systemctl', '--user', 'start', this._serviceName]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr || 'systemctl start failed');
			}
		} else if (this.platform === 'macos') {
			const result = await this._run(['launchctl', 'load', this.getServiceFilePath()]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr || 'launchctl load failed');
			}
		}
		const status = await this.status();
		this._onDidChange.fire(status);
		return status;
	}

	async stop(): Promise<IDaemonStatus> {
		if (this.platform === 'linux') {
			await this._run(['systemctl', '--user', 'stop', this._serviceName]).catch(() => undefined);
		} else if (this.platform === 'macos') {
			await this._run(['launchctl', 'unload', this.getServiceFilePath()]).catch(() => undefined);
		}
		const status = await this.status();
		this._onDidChange.fire(status);
		return status;
	}

	private _systemdUnit(): string {
		const envLines = this._token ? `Environment=DC_REMOTE_TOKEN=${this._token}` : '';
		return [
			'[Unit]',
			`Description=${DAEMON_LABEL}`,
			'After=network-online.target',
			'Wants=network-online.target',
			'',
			'[Service]',
			'Type=simple',
			`WorkingDirectory=${this._workspaceRoot}`,
			`ExecStart=${this._nodePath} ${this._serverMainPath} --port ${this._port} --host ${this._host} --workspace ${this._workspaceRoot}`,
			'Restart=on-failure',
			'RestartSec=5',
			'KillSignal=SIGTERM',
			'TimeoutStopSec=30',
			envLines,
			'',
			'[Install]',
			'WantedBy=default.target',
			''
		].join('\n');
	}

	private _launchdPlist(): string {
		const programArgs = [
			this._nodePath,
			this._serverMainPath,
			'--port', String(this._port),
			'--host', this._host,
			'--workspace', this._workspaceRoot
		];
		const xml = programArgs.map(arg => `\t<string>${escapeXml(arg)}</string>`).join('\n');
		return [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
			'<plist version="1.0">',
			'<dict>',
			`\t<key>Label</key>\n\t<string>${this._serviceName}</string>`,
			'\t<key>ProgramArguments</key>',
			'\t<array>',
			xml,
			'\t</array>',
			'\t<key>RunAtLoad</key>\n\t<true/>',
			'\t<key>KeepAlive</key>\n\t<true/>',
			'\t<key>WorkingDirectory</key>',
			`\t<string>${escapeXml(this._workspaceRoot)}</string>`,
			'\t<key>StandardOutPath</key>',
			`\t<string>${escapeXml(join(homedir(), '.dc-remote-server.log'))}</string>`,
			'\t<key>StandardErrorPath</key>',
			`\t<string>${escapeXml(join(homedir(), '.dc-remote-server.err.log'))}</string>`,
			'</dict>',
			'</plist>',
			''
		].join('\n');
	}

	private _resolveServerMainPath(): string {
		try {
			return fileURLToPath(new URL('server-main', import.meta.url));
		} catch {
			return 'server-main';
		}
	}

	private _run(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
		return new Promise(resolvePromise => {
			const child = spawn(args[0], args.slice(1), { windowsHide: true });
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
			child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
			child.on('error', error => resolvePromise({ exitCode: -1, stdout, stderr: error.message }));
			child.on('exit', code => resolvePromise({ exitCode: code, stdout, stderr }));
		});
	}
}

function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
