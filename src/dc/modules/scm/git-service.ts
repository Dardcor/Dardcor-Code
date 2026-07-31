/**
 * Dardcor Code - Native Git CLI Process Wrapper Service
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

declare const require: any;

export interface IGitResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface IGitStatusEntry {
	readonly path: string;
	readonly status: string;
	readonly staged: boolean;
	readonly untracked: boolean;
}

export interface IGitLogEntry {
	readonly hash: string;
	readonly message: string;
	readonly author: string;
	readonly date: string;
}

export const GIT_STATUS_LABELS: Record<string, string> = {
	'M': 'Modified',
	'A': 'Added',
	'D': 'Deleted',
	'R': 'Renamed',
	'C': 'Copied',
	'U': 'Updated',
	'?': 'Untracked'
};

export class GitNotFoundError extends Error {
	constructor() {
		super('Binary git tidak ditemukan di PATH. Install Git terlebih dahulu.');
		this.name = 'GitNotFoundError';
	}
}

export class GitService extends Disposable {
	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private _gitAvailable: boolean | undefined;

	public async isAvailable(): Promise<boolean> {
		if (this._gitAvailable !== undefined) {
			return this._gitAvailable;
		}
		try {
			const result = await this.run(['--version'], process.cwd());
			this._gitAvailable = result.exitCode === 0;
		} catch {
			this._gitAvailable = false;
		}
		return this._gitAvailable;
	}

	public async run(args: string[], cwd: string): Promise<IGitResult> {
		const cp = require('node:child_process');
		return new Promise<IGitResult>((resolve, reject) => {
			let child: any;
			try {
				child = cp.spawn('git', args, { cwd, windowsHide: true });
			} catch (err) {
				this._onDidError.fire(String(err));
				reject(new GitNotFoundError());
				return;
			}
			let stdout = '';
			let stderr = '';
			child.stdout?.setEncoding('utf8');
			child.stdout?.on('data', (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.setEncoding('utf8');
			child.stderr?.on('data', (chunk: string) => {
				stderr += chunk;
			});
			child.on('error', (err: any) => {
				if (err?.code === 'ENOENT') {
					this._gitAvailable = false;
					this._onDidError.fire('Binary git tidak ditemukan di PATH');
					reject(new GitNotFoundError());
				} else {
					reject(err);
				}
			});
			child.on('close', (code: number) => {
				resolve({ exitCode: code, stdout, stderr });
			});
		});
	}

	public async status(cwd: string): Promise<IGitStatusEntry[]> {
		const result = await this.run(['status', '--porcelain=v1', '-uall'], cwd);
		if (result.exitCode !== 0) {
			return [];
		}
		const entries: IGitStatusEntry[] = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			if (line.length < 3) {
				continue;
			}
			const stagedCode = line.substring(0, 1);
			const unstagedCode = line.substring(1, 2);
			const rawPath = line.substring(3).trim();
			if (rawPath.includes(' -> ')) {
				entries.push({ path: rawPath.split(' -> ')[1], status: 'R', staged: true, untracked: false });
				continue;
			}
			const untracked = stagedCode === '?' && unstagedCode === '?';
			const status = untracked ? '?' : unstagedCode !== ' ' && unstagedCode !== '?' ? unstagedCode : stagedCode;
			entries.push({ path: rawPath, status, staged: stagedCode !== ' ' && stagedCode !== '?', untracked });
		}
		return entries;
	}

	public async add(cwd: string, paths: string[]): Promise<void> {
		if (paths.length === 0) {
			return;
		}
		await this.run(['add', '--', ...paths], cwd);
	}

	public async addAll(cwd: string): Promise<void> {
		await this.run(['add', '-A'], cwd);
	}

	public async unstage(cwd: string, paths: string[]): Promise<void> {
		if (paths.length === 0) {
			return;
		}
		await this.run(['restore', '--staged', '--', ...paths], cwd);
	}

	public async commit(cwd: string, message: string): Promise<IGitResult> {
		return this.run(['commit', '-m', message], cwd);
	}

	public async diff(cwd: string, filePath?: string): Promise<string> {
		const args = ['diff', '--no-color', '-U0'];
		if (filePath) {
			args.push('--', filePath);
		}
		const result = await this.run(args, cwd);
		return result.stdout;
	}

	public async diffHead(cwd: string, filePath?: string): Promise<string> {
		const args = ['diff', 'HEAD', '--no-color', '-U0'];
		if (filePath) {
			args.push('--', filePath);
		}
		const result = await this.run(args, cwd);
		return result.stdout;
	}

	public async getCurrentBranch(cwd: string): Promise<string> {
		const result = await this.run(['branch', '--show-current'], cwd);
		return result.exitCode === 0 ? result.stdout.trim() : '';
	}

	public async listBranches(cwd: string): Promise<string[]> {
		const result = await this.run(['branch', '--format=%(refname:short)'], cwd);
		if (result.exitCode !== 0) {
			return [];
		}
		return result.stdout.split(/\r?\n/).map(b => b.trim()).filter(Boolean);
	}

	public async log(cwd: string, limit = 15): Promise<IGitLogEntry[]> {
		const result = await this.run(['log', `-n${limit}`, '--pretty=format:%h|%s|%an|%aI'], cwd);
		if (result.exitCode !== 0) {
			return [];
		}
		const entries: IGitLogEntry[] = [];
		for (const line of result.stdout.split(/\r?\n/)) {
			const parts = line.split('|');
			if (parts.length >= 4) {
				entries.push({ hash: parts[0], message: parts[1], author: parts[2], date: parts[3] });
			}
		}
		return entries;
	}

	public async init(cwd: string): Promise<IGitResult> {
		return this.run(['init'], cwd);
	}
}
