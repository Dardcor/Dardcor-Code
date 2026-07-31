import { Emitter, Event } from '../../core/events/emitter.js';
import { DevcontainerConfig } from './devcontainer-parser.js';

export interface ILifecycleCommand {
	readonly command: string;
	readonly cwd?: string;
	readonly label: string;
}

export interface IDevcontainerLifecycle {
	readonly initializeCommand?: string | string[];
	readonly onCreateCommand?: string | string[];
	readonly updateContentCommand?: string | string[];
	readonly postCreateCommand?: string | string[];
	readonly postStartCommand?: string | string[];
	readonly postAttachCommand?: string | string[];
}

export interface IDevcontainerLifecycleResult {
	readonly label: string;
	readonly command: string;
	readonly cwd: string;
	readonly ok: boolean;
	readonly error?: string;
	readonly durationMs: number;
}

export type LifecycleExecutor = (command: string, cwd: string) => Promise<void>;

export const LIFECYCLE_PHASES: ReadonlyArray<keyof IDevcontainerLifecycle> = [
	'initializeCommand',
	'onCreateCommand',
	'updateContentCommand',
	'postCreateCommand',
	'postStartCommand',
	'postAttachCommand'
];

export function normalizeCommand(command: string | string[] | undefined): string | null {
	if (!command) {
		return null;
	}
	if (typeof command === 'string') {
		return command.trim() || null;
	}
	return command.join(' && ').trim() || null;
}

export function getLifecycleConfig(config: DevcontainerConfig | IDevcontainerLifecycle): IDevcontainerLifecycle {
	const lifecycle: IDevcontainerLifecycle = {};
	for (const phase of LIFECYCLE_PHASES) {
		const value = config[phase];
		if (value !== undefined) {
			(lifecycle as Record<string, unknown>)[phase] = value;
		}
	}
	return lifecycle;
}

export function getLifecycleCommandList(lifecycle: IDevcontainerLifecycle, cwd = '.'): ILifecycleCommand[] {
	const commands: ILifecycleCommand[] = [];
	for (const phase of LIFECYCLE_PHASES) {
		const command = normalizeCommand(lifecycle[phase]);
		if (command) {
			commands.push({ command, cwd, label: phase });
		}
	}
	return commands;
}

export class DevcontainerLifecycle {
	private readonly _results: IDevcontainerLifecycleResult[] = [];

	private readonly _onDidRunCommand = new Emitter<IDevcontainerLifecycleResult>();
	readonly onDidRunCommand: Event<IDevcontainerLifecycleResult> = this._onDidRunCommand.event;

	get results(): readonly IDevcontainerLifecycleResult[] {
		return [...this._results];
	}

	async execute(lifecycle: IDevcontainerLifecycle, exec: LifecycleExecutor, cwd = '.'): Promise<void> {
		for (const item of getLifecycleCommandList(lifecycle, cwd)) {
			await this.runCommand(item, exec);
		}
	}

	async runCommand(item: ILifecycleCommand, exec: LifecycleExecutor): Promise<IDevcontainerLifecycleResult> {
		const started = Date.now();
		const cwd = item.cwd ?? '.';
		try {
			await exec(item.command, cwd);
			const result: IDevcontainerLifecycleResult = {
				label: item.label,
				command: item.command,
				cwd,
				ok: true,
				durationMs: Date.now() - started
			};
			this._results.push(result);
			this._onDidRunCommand.fire(result);
			return result;
		} catch (error) {
			const result: IDevcontainerLifecycleResult = {
				label: item.label,
				command: item.command,
				cwd,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - started
			};
			this._results.push(result);
			this._onDidRunCommand.fire(result);
			throw error;
		}
	}

	async collect(lifecycle: IDevcontainerLifecycle, exec: LifecycleExecutor, cwd = '.'): Promise<IDevcontainerLifecycleResult[]> {
		const results: IDevcontainerLifecycleResult[] = [];
		for (const item of getLifecycleCommandList(lifecycle, cwd)) {
			const started = Date.now();
			try {
				await exec(item.command, item.cwd ?? cwd);
				results.push({
					label: item.label,
					command: item.command,
					cwd: item.cwd ?? cwd,
					ok: true,
					durationMs: Date.now() - started
				});
			} catch (error) {
				results.push({
					label: item.label,
					command: item.command,
					cwd: item.cwd ?? cwd,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
					durationMs: Date.now() - started
				});
			}
		}
		return results;
	}

	async runInOrder(lifecycle: IDevcontainerLifecycle, exec: LifecycleExecutor, cwd = '.'): Promise<IDevcontainerLifecycleResult[]> {
		return this.collect(lifecycle, exec, cwd);
	}

	async runSequential(lifecycle: IDevcontainerLifecycle, exec: LifecycleExecutor, cwd = '.', stopOnFailure = true): Promise<IDevcontainerLifecycleResult[]> {
		const results: IDevcontainerLifecycleResult[] = [];
		for (const item of getLifecycleCommandList(lifecycle, cwd)) {
			const started = Date.now();
			try {
				await exec(item.command, item.cwd ?? cwd);
				results.push({ label: item.label, command: item.command, cwd: item.cwd ?? cwd, ok: true, durationMs: Date.now() - started });
			} catch (error) {
				results.push({
					label: item.label,
					command: item.command,
					cwd: item.cwd ?? cwd,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
					durationMs: Date.now() - started
				});
				if (stopOnFailure) {
					break;
				}
			}
		}
		return results;
	}

	get failedPhases(): string[] {
		return this._results.filter(r => !r.ok).map(r => r.label);
	}

	get succeeded(): boolean {
		return this._results.length > 0 && this._results.every(r => r.ok);
	}

	get totalDurationMs(): number {
		return this._results.reduce((sum, r) => sum + r.durationMs, 0);
	}

	clear(): void {
		this._results.length = 0;
	}
}
