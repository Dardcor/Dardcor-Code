import { Emitter, Event } from '../../core/events/emitter';

export interface IProfileSample {
	readonly timestamp: number;
	readonly cpuPercent: number;
	readonly memoryMB: number;
	readonly userCpu: number;
	readonly systemCpu: number;
}

export interface IExtensionProfile {
	readonly extensionId: string;
	readonly startedAt: number;
	readonly durationMs: number;
	readonly cpuPercent: number;
	readonly memoryMB: number;
	readonly samples: IProfileSample[];
	readonly sampleCount: number;
}

export interface IProfilerOptions {
	readonly intervalMs?: number;
	readonly maxSamples?: number;
}

export function memoryUsageMb(memory: number): number {
	return Math.round((memory / (1024 * 1024)) * 100) / 100;
}

export class RemoteExtensionProfiler {
	private readonly _intervalMs: number;
	private readonly _maxSamples: number;

	private readonly _active = new Map<string, { samples: IProfileSample[]; timer: ReturnType<typeof setInterval>; startedAt: number; lastCpu: { user: number; system: number }; lastTime: number }>();
	private readonly _profiles = new Map<string, IExtensionProfile>();

	private readonly _onDidSample = new Emitter<{ extensionId: string; sample: IProfileSample }>();
	readonly onDidSample: Event<{ extensionId: string; sample: IProfileSample }> = this._onDidSample.event;

	constructor(options: IProfilerOptions = {}) {
		this._intervalMs = options.intervalMs ?? 1000;
		this._maxSamples = options.maxSamples ?? 300;
	}

	get isProfiling(): boolean {
		return this._active.size > 0;
	}

	get activeProfiles(): string[] {
		return [...this._active.keys()];
	}

	start(extensionId: string): boolean {
		if (this._active.has(extensionId)) {
			return false;
		}
		const cpu = this._getCpuUsage();
		const record = {
			samples: [] as IProfileSample[],
			startedAt: Date.now(),
			lastCpu: cpu,
			lastTime: Date.now(),
			timer: null as unknown as ReturnType<typeof setInterval>
		};
		record.timer = setInterval(() => {
			this._sample(extensionId, record);
		}, this._intervalMs);
		this._active.set(extensionId, record);
		return true;
	}

	stop(extensionId: string): IExtensionProfile | null {
		const record = this._active.get(extensionId);
		if (!record) {
			return null;
		}
		clearInterval(record.timer);
		this._active.delete(extensionId);
		const profile = this._finalize(extensionId, record);
		this._profiles.set(extensionId, profile);
		return profile;
	}

	getProfile(extensionId: string): IExtensionProfile | null {
		const active = this._active.get(extensionId);
		if (active) {
			return this._finalize(extensionId, active);
		}
		return this._profiles.get(extensionId) ?? null;
	}

	listProfiles(): IExtensionProfile[] {
		return [...this._profiles.values()].sort((a, b) => b.startedAt - a.startedAt);
	}

	stopAll(): IExtensionProfile[] {
		const results: IExtensionProfile[] = [];
		for (const id of [...this._active.keys()]) {
			const profile = this.stop(id);
			if (profile) {
				results.push(profile);
			}
		}
		return results;
	}

	clear(): void {
		for (const record of this._active.values()) {
			clearInterval(record.timer);
		}
		this._active.clear();
		this._profiles.clear();
	}

	private _sample(extensionId: string, record: { samples: IProfileSample[]; timer: ReturnType<typeof setInterval>; startedAt: number; lastCpu: { user: number; system: number }; lastTime: number }): void {
		const now = Date.now();
		const cpu = this._getCpuUsage();
		const elapsedMs = Math.max(1, now - record.lastTime);
		const userDelta = Math.max(0, cpu.user - record.lastCpu.user);
		const systemDelta = Math.max(0, cpu.system - record.lastCpu.system);
		const totalDelta = userDelta + systemDelta;
		const cpuPercent = Math.min(100, Math.round((totalDelta / elapsedMs) * 100));
		const sample: IProfileSample = {
			timestamp: now,
			cpuPercent,
			memoryMB: memoryUsageMb(this._getMemoryUsage()),
			userCpu: cpu.user,
			systemCpu: cpu.system
		};
		record.lastCpu = cpu;
		record.lastTime = now;
		record.samples.push(sample);
		if (record.samples.length > this._maxSamples) {
			record.samples.splice(0, record.samples.length - this._maxSamples);
		}
		this._onDidSample.fire({ extensionId, sample });
	}

	private _finalize(extensionId: string, record: { samples: IProfileSample[]; timer: ReturnType<typeof setInterval>; startedAt: number; lastCpu: { user: number; system: number }; lastTime: number }): IExtensionProfile {
		const samples = [...record.samples];
		const averageCpu = samples.length > 0
			? Math.round(samples.reduce((sum, s) => sum + s.cpuPercent, 0) / samples.length)
			: 0;
		const lastMemory = samples.length > 0 ? samples[samples.length - 1].memoryMB : memoryUsageMb(this._getMemoryUsage());
		return {
			extensionId,
			startedAt: record.startedAt,
			durationMs: Date.now() - record.startedAt,
			cpuPercent: averageCpu,
			memoryMB: lastMemory,
			samples,
			sampleCount: samples.length
		};
	}

	private _getCpuUsage(): { user: number; system: number } {
		if (typeof process === 'undefined' || typeof process.cpuUsage !== 'function') {
			return { user: 0, system: 0 };
		}
		const usage = process.cpuUsage();
		return { user: usage.user, system: usage.system };
	}

	private _getMemoryUsage(): number {
		if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
			return 0;
		}
		return process.memoryUsage().heapUsed;
	}
}
