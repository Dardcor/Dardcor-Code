/**
 * Dardcor Code - Docker CLI Command Runner Wrapper Service (Task 818)
 */

import { spawn } from 'node:child_process';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface DockerContainerInfo {
	readonly id: string;
	readonly image: string;
	readonly names: string;
	readonly status: string;
	readonly ports: string;
}

export interface DockerRunOptions {
	readonly name?: string;
	readonly ports?: { host: number; container: number }[];
	readonly volumes?: { host: string; container: string }[];
	readonly env?: Record<string, string>;
	readonly user?: string;
	readonly workdir?: string;
	readonly interactive?: boolean;
	readonly tty?: boolean;
	readonly detach?: boolean;
	readonly rm?: boolean;
	readonly privileged?: boolean;
	readonly extraArgs?: string[];
}

export interface DockerExecResult {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

export class DockerCliError extends Error {
	readonly command?: string;
	readonly exitCode?: number | null;

	constructor(message: string, command?: string, exitCode?: number | null) {
		super(message);
		this.name = 'DockerCliError';
		this.command = command;
		this.exitCode = exitCode;
	}
}

export class DockerCli extends Disposable {
	private _available: boolean | null = null;

	constructor(private readonly _binary: string = 'docker', private readonly _timeoutMs = 120000) {
		super();
	}

	async isAvailable(): Promise<boolean> {
		if (this._available === null) {
			this._available = await this._probe();
		}
		return this._available;
	}

	async ps(): Promise<DockerContainerInfo[]> {
		const result = await this._run(['ps', '--no-trunc', '--format', '{{.ID}}|{{.Image}}|{{.Names}}|{{.Status}}|{{.Ports}}']);
		if (result.exitCode !== 0) {
			throw new DockerCliError(result.stderr || 'docker ps failed', 'docker ps', result.exitCode);
		}
		return result.stdout.split('\n')
			.filter(line => line.includes('|'))
			.map(line => {
				const [id, image, names, status, ports = ''] = line.split('|');
				return { id, image, names, status, ports };
			});
	}

	async run(image: string, command: string[], options: DockerRunOptions = {}): Promise<{ containerId?: string; output: string }> {
		const args = ['run'];
		if (options.detach) {
			args.push('-d');
		}
		if (options.interactive) {
			args.push('-i');
		}
		if (options.tty) {
			args.push('-t');
		}
		if (options.rm) {
			args.push('--rm');
		}
		if (options.privileged) {
			args.push('--privileged');
		}
		if (options.name) {
			args.push('--name', options.name);
		}
		if (options.user) {
			args.push('--user', options.user);
		}
		if (options.workdir) {
			args.push('--workdir', options.workdir);
		}
		for (const port of options.ports ?? []) {
			args.push('-p', `${port.host}:${port.container}`);
		}
		for (const volume of options.volumes ?? []) {
			args.push('-v', `${volume.host}:${volume.container}`);
		}
		for (const [key, value] of Object.entries(options.env ?? {})) {
			args.push('-e', `${key}=${value}`);
		}
		args.push(...(options.extraArgs ?? []), image, ...command);
		const result = await this._run(args);
		if (result.exitCode !== 0) {
			throw new DockerCliError(result.stderr || 'docker run failed', `docker ${args.join(' ')}`, result.exitCode);
		}
		const containerId = options.detach ? result.stdout.trim().split('\n').at(-1) ?? undefined : undefined;
		return { containerId, output: result.stdout };
	}

	async exec(containerId: string, command: string[], options: { workdir?: string; user?: string; env?: Record<string, string> } = {}): Promise<DockerExecResult> {
		const args = ['exec'];
		if (options.workdir) {
			args.push('-w', options.workdir);
		}
		if (options.user) {
			args.push('--user', options.user);
		}
		for (const [key, value] of Object.entries(options.env ?? {})) {
			args.push('-e', `${key}=${value}`);
		}
		args.push(containerId, ...command);
		return this._run(args);
	}

	async build(contextPath: string, options: { dockerfile?: string; tags?: string[]; buildArgs?: Record<string, string> } = {}): Promise<string> {
		const args = ['build', contextPath];
		if (options.dockerfile) {
			args.push('-f', options.dockerfile);
		}
		for (const tag of options.tags ?? []) {
			args.push('-t', tag);
		}
		for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
			args.push('--build-arg', `${key}=${value}`);
		}
		const result = await this._run(args);
		if (result.exitCode !== 0) {
			throw new DockerCliError(result.stderr || 'docker build failed', 'docker build', result.exitCode);
		}
		return result.stdout;
	}

	async pull(image: string): Promise<void> {
		const result = await this._run(['pull', image]);
		if (result.exitCode !== 0) {
			throw new DockerCliError(result.stderr || 'docker pull failed', `docker pull ${image}`, result.exitCode);
		}
	}

	async inspect(containerId: string): Promise<Record<string, any>> {
		const result = await this._run(['inspect', containerId]);
		if (result.exitCode !== 0) {
			throw new DockerCliError(result.stderr || 'docker inspect failed', 'docker inspect', result.exitCode);
		}
		try {
			const parsed = JSON.parse(result.stdout) as Record<string, any>[];
			return parsed[0] ?? {};
		} catch {
			return {};
		}
	}

	async stop(containerId: string): Promise<void> {
		await this._run(['stop', containerId]);
	}

	async remove(containerId: string, force = false): Promise<void> {
		const args = ['rm'];
		if (force) {
			args.push('-f');
		}
		args.push(containerId);
		await this._run(args);
	}

	async imageExists(image: string): Promise<boolean> {
		try {
			const result = await this._run(['image', 'inspect', image]);
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	private async _probe(): Promise<boolean> {
		try {
			const result = await this._run(['--version']);
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	private _run(args: string[]): Promise<DockerExecResult> {
		return new Promise<DockerExecResult>((resolvePromise, reject) => {
			let child;
			try {
				child = spawn(this._binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
			} catch (error) {
				reject(new DockerCliError(`Failed to spawn '${this._binary}': ${error instanceof Error ? error.message : String(error)}`));
				return;
			}
			let stdout = '';
			let stderr = '';
			const timer = setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} catch {
					// ignore
				}
				reject(new DockerCliError(`Docker command timed out after ${this._timeoutMs}ms`, this._binary));
			}, this._timeoutMs);
			child.stdout.on('data', (chunk: Buffer) => {
				stdout += chunk.toString('utf8');
			});
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString('utf8');
			});
			child.on('error', (error: NodeJS.ErrnoException) => {
				clearTimeout(timer);
				if (error.code === 'ENOENT') {
					this._available = false;
					reject(new DockerCliError(
						`Docker CLI '${this._binary}' not found. Install Docker and make sure it is on PATH.`,
						this._binary
					));
				} else {
					reject(new DockerCliError(`Failed to run '${this._binary}': ${error.message}`, this._binary));
				}
			});
			child.on('close', (exitCode) => {
				clearTimeout(timer);
				resolvePromise({ exitCode, stdout, stderr });
			});
		});
	}
}
