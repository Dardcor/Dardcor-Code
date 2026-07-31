export interface IExtensionProfile {
	readonly extensionId: string;
	readonly cpuTime: number;
	readonly memoryUsed: number;
	readonly running: boolean;
	readonly startedAt: number;
	readonly stoppedAt: number | undefined;
}

export interface IExtensionProfileResult {
	readonly cpuTime: number;
	readonly memoryDelta: number;
}

export interface IExtensionProfileSnapshot {
	readonly cpuTime: number;
	readonly memoryUsed: number;
}

interface IActiveProfile {
	readonly extensionId: string;
	readonly startedAt: number;
	readonly startMemory: number;
	readonly startCpu: number;
	cpuTime: number;
	memoryUsed: number;
	running: boolean;
	stoppedAt: number | undefined;
}

export class ExtensionProfiler {
	private readonly _profiles = new Map<string, IActiveProfile>();
	private readonly _history = new Map<string, IExtensionProfile[]>();

	public start(extensionId: string): void {
		if (this._profiles.has(extensionId) && this._profiles.get(extensionId)!.running) {
			return;
		}
		this._profiles.set(extensionId, {
			extensionId,
			startedAt: Date.now(),
			startMemory: this._memory(),
			startCpu: this._cpu(),
			cpuTime: 0,
			memoryUsed: 0,
			running: true,
			stoppedAt: undefined
		});
	}

	public stop(extensionId: string): IExtensionProfileResult | undefined {
		const profile = this._profiles.get(extensionId);
		if (!profile || !profile.running) {
			return undefined;
		}
		const endCpu = this._cpu();
		const endMemory = this._memory();
		const cpuTime = Math.max(0, endCpu - profile.startCpu) / 1000;
		profile.cpuTime = cpuTime;
		profile.memoryUsed = endMemory;
		profile.running = false;
		profile.stoppedAt = Date.now();
		const memoryDelta = endMemory - profile.startMemory;
		this._record(profile);
		return { cpuTime, memoryDelta };
	}

	public snapshot(): Map<string, IExtensionProfileSnapshot> {
		const result = new Map<string, IExtensionProfileSnapshot>();
		for (const [, profile] of this._profiles) {
			const cpuTime = profile.running ? Math.max(0, this._cpu() - profile.startCpu) / 1000 : profile.cpuTime;
			const memoryUsed = profile.running ? this._memory() : profile.memoryUsed;
			result.set(profile.extensionId, { cpuTime, memoryUsed });
		}
		return result;
	}

	public getProfile(extensionId: string): IExtensionProfile | undefined {
		const active = this._profiles.get(extensionId);
		if (!active) {
			return undefined;
		}
		return this._toPublic(active);
	}

	public getHistory(extensionId: string): IExtensionProfile[] {
		return (this._history.get(extensionId) ?? []).slice();
	}

	public isRunning(extensionId: string): boolean {
		return this._profiles.get(extensionId)?.running ?? false;
	}

	public clear(): void {
		this._profiles.clear();
		this._history.clear();
	}

	private _record(profile: IActiveProfile): void {
		let history = this._history.get(profile.extensionId);
		if (!history) {
			history = [];
			this._history.set(profile.extensionId, history);
		}
		history.push(this._toPublic(profile));
	}

	private _toPublic(profile: IActiveProfile): IExtensionProfile {
		return {
			extensionId: profile.extensionId,
			cpuTime: profile.cpuTime,
			memoryUsed: profile.memoryUsed,
			running: profile.running,
			startedAt: profile.startedAt,
			stoppedAt: profile.stoppedAt
		};
	}

	private _memory(): number {
		if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
			return process.memoryUsage().heapUsed;
		}
		return 0;
	}

	private _cpu(): number {
		if (typeof process !== 'undefined' && typeof process.cpuUsage === 'function') {
			const usage = process.cpuUsage();
			return usage.user + usage.system;
		}
		return 0;
	}
}
