/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../common/cancellation.js';
import { Disposable, DisposableStore, IDisposable } from '../../../common/lifecycle.js';
import { Embedding, nextMacrotask } from './embedding.js';
import { TimeApi } from './timeApi.js';
import { ROOT_TRACE, TraceContext } from './trace.js';
import { EventSource, VirtualClock, VirtualEvent, VirtualTime } from './virtualClock.js';


export type TerminationPolicy =
	| { readonly kind: 'idle' }
	| { readonly kind: 'token'; readonly token: CancellationToken }
	| { readonly kind: 'time'; readonly time: VirtualTime };

export const untilIdle: TerminationPolicy = { kind: 'idle' };
export function untilToken(token: CancellationToken): TerminationPolicy { return { kind: 'token', token }; }
export function untilTime(time: VirtualTime): TerminationPolicy { return { kind: 'time', time }; }

export interface RunOptions {
	readonly until: TerminationPolicy;
	readonly maxEvents?: number;
	readonly maxTraceDepth?: number;
}


type RunStatus = 'continue' | 'done' | { readonly error: Error };

class Run {
	private static _idCounter = 0;
	public readonly id = ++Run._idCounter;

	public readonly promise: Promise<void>;
	private _resolve!: () => void;
	private _reject!: (e: Error) => void;
	private _settled = false;
	public get settled(): boolean { return this._settled; }

	constructor(
		public readonly options: RunOptions,
		public readonly executedAtStart: number,
		public readonly maxEvents: number,
	) {
		this.promise = new Promise<void>((res, rej) => { this._resolve = res; this._reject = rej; });
	}

	settle(error?: Error): void {
		if (this._settled) { return; }
		this._settled = true;
		if (error) { this._reject(error); } else { this._resolve(); }
	}

	evaluate(clock: VirtualClock, executedTotal: number, makeOverflow: () => Error): RunStatus {
		const local = executedTotal - this.executedAtStart;
		if (local >= this.maxEvents && clock.hasEvents) {
			return { error: makeOverflow() };
		}

		const u = this.options.until;
		switch (u.kind) {
			case 'idle':
				return clock.hasEvents ? 'continue' : 'done';
			case 'token':
				return u.token.isCancellationRequested && !clock.hasEvents ? 'done' : 'continue';
			case 'time': {
				const next = clock.peekNext();
				return next === undefined || next.time > u.time ? 'done' : 'continue';
			}
		}
	}
}


type StepOutcome =
	| 'progress'
	| 'park'
	| 'quiesce';


export interface VirtualTimeProcessorOptions {
	readonly defaultMaxEvents?: number;
}

export class VirtualTimeProcessor extends Disposable {

	private readonly _runs = new Map<Run, IDisposable>();
	private readonly _history: VirtualEvent[] = [];
	private _executedTotal = 0;
	private _disposed = false;

	private _inDrive = false;
	private _parkCleanup: IDisposable | undefined;

	private readonly _defaultMaxEvents: number;

	public get history(): readonly VirtualEvent[] { return this._history; }
	public get executedTotal(): number { return this._executedTotal; }

	constructor(
		private readonly _clock: VirtualClock,
		private readonly _embedding: Embedding,
		private readonly _realApi: TimeApi,
		opts: VirtualTimeProcessorOptions = {},
	) {
		super();
		this._defaultMaxEvents = opts.defaultMaxEvents ?? 100;
		this._register({ dispose: () => this._onDispose() });
	}


	run(options: RunOptions): Promise<void> {
		const run = new Run(options, this._executedTotal, options.maxEvents ?? this._defaultMaxEvents);
		const cleanup = new DisposableStore();

		if (options.until.kind === 'token') {
			cleanup.add(options.until.token.onCancellationRequested(() => this._wake()));
		}

		if (options.until.kind === 'time' && options.until.time > this._clock.now) {
			const source: EventSource = { toString: () => `<deadline of run #${run.id}>` };
			cleanup.add(this._clock.schedule({
				time: options.until.time,
				source,
				run: () => { },
			}));
		}

		this._runs.set(run, cleanup);
		this._wake();
		return run.promise;
	}


	private _step(): StepOutcome {
		if (this._disposed) { return 'quiesce'; }

		this._settleFinishedRuns();
		if (this._runs.size === 0) { return 'quiesce'; }

		const next = this._clock.peekNext();
		if (next === undefined) { return 'park'; }

		const traceDepth = next.trace?.depth ?? 0;
		let depthOverflow = false;
		for (const run of [...this._runs.keys()]) {
			const limit = run.options.maxTraceDepth;
			if (limit !== undefined && traceDepth > limit) {
				this._settleRun(run, this._buildDepthOverflow(run, traceDepth));
				depthOverflow = true;
			}
		}
		if (depthOverflow) { return 'progress'; }

		this._executeOne(next);
		return 'progress';
	}

	private _executeOne(event: VirtualEvent): void {
		try {
			TraceContext.instance.runAsHandler(
				event.trace ?? ROOT_TRACE,
				() => {
					const e = this._clock.runNext();
					if (e) {
						this._history.push(e);
						this._executedTotal++;
					}
				},
				{
					afterMicrotaskClosure: cb => nextMacrotask(this._realApi, cb),
				},
			);
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			for (const run of [...this._runs.keys()]) { this._settleRun(run, err); }
		}
	}


	private readonly _drive = (): void => {
		if (this._inDrive) { return; }
		this._inDrive = true;
		try {
			while (true) {
				const outcome = this._step();
				if (outcome === 'quiesce') { return; }
				if (outcome === 'park') { this._park(); return; }

				const next = this._clock.peekNext();
				if (next === undefined) { continue; }

				const choice = this._embedding(next, this._drive);
				if (choice === 'cbScheduled') { return; }
			}
		} finally {
			this._inDrive = false;
		}
	};


	private _park(): void {
		this._unpark();
		const store = new DisposableStore();
		store.add(this._clock.onEventScheduled(() => this._wake()));
		this._parkCleanup = store;
	}

	private _unpark(): void {
		this._parkCleanup?.dispose();
		this._parkCleanup = undefined;
	}

	private _wake(): void {
		if (this._disposed) { return; }
		this._unpark();
		nextMacrotask(this._realApi, this._drive);
	}


	private _settleFinishedRuns(): void {
		for (const run of [...this._runs.keys()]) {
			if (run.settled) { continue; }
			const status = run.evaluate(this._clock, this._executedTotal, () => this._buildOverflow(run));
			if (status === 'done') {
				this._settleRun(run);
			} else if (typeof status === 'object') {
				this._settleRun(run, status.error);
			}
		}
	}

	private _settleRun(run: Run, error?: Error): void {
		const cleanup = this._runs.get(run);
		if (!cleanup) { return; }
		this._runs.delete(run);
		cleanup.dispose();
		run.settle(error);
	}

	private _buildOverflow(run: Run): Error {
		const local = this._executedTotal - run.executedAtStart;
		return new Error(
			`[VirtualTimeProcessor] Run #${run.id} exceeded maxEvents (${run.maxEvents}) — ` +
			`executed ${local} virtual event(s) and the queue is still not empty.`
		);
	}

	private _buildDepthOverflow(run: Run, depth: number): Error {
		return new Error(
			`[VirtualTimeProcessor] Run #${run.id} exceeded maxTraceDepth (${run.options.maxTraceDepth}) — ` +
			`next event has trace depth ${depth}. ` +
			`This usually indicates a runaway self-rescheduling timer.`
		);
	}

	private _onDispose(): void {
		this._disposed = true;
		this._unpark();
		const err = new Error('VirtualTimeProcessor disposed');
		for (const run of [...this._runs.keys()]) { this._settleRun(run, err); }
	}
}
