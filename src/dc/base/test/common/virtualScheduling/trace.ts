/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../common/errors.js';

export class Trace {
	private static _idCounter = 0;
	public readonly id: number = ++Trace._idCounter;
	public readonly root: Trace;
	public readonly depth: number;

	constructor(
		public readonly parent: Trace | undefined,
		public readonly label: string,
		public readonly stack: string | undefined = undefined,
	) {
		this.root = parent?.root ?? this;
		this.depth = (parent?.depth ?? -1) + 1;
	}

	child(label: string, stack?: string): Trace {
		return new Trace(this, label, stack);
	}

	describe(): string {
		const parts: string[] = [];
		for (let t: Trace | undefined = this; t; t = t.parent) {
			parts.push(`#${t.id} ${t.label}`);
		}
		return parts.join(' ← ');
	}

	toString(): string { return this.describe(); }
}

export const ROOT_TRACE: Trace = new Trace(undefined, '<root>');

export function createTraceRoot(label: string, stack?: string): Trace {
	return new Trace(undefined, label, stack);
}

interface Frame {
	readonly trace: Trace;
	readonly prev: Frame | undefined;
}

const ROOT_FRAME: Frame = { trace: ROOT_TRACE, prev: undefined };

export interface RunAsHandlerOptions {
	readonly afterMicrotaskClosure: (reset: () => void) => void;
}

export class TraceContext {
	public static readonly instance = new TraceContext();

	private _current: Frame = ROOT_FRAME;
	private _isHandlerRunning = false;

	currentTrace(): Trace { return this._current.trace; }

	runWithTrace<T>(t: Trace, fn: () => T): T {
		const prev = this._current;
		const next: Frame = { trace: t, prev };
		this._current = next;
		try {
			return fn();
		} finally {
			if (this._current !== next) {
				// eslint-disable-next-line no-unsafe-finally
				throw new BugIndicatingError(
					`runWithTrace: unexpected mutation of current frame.`
				);
			}
			this._current = prev;
		}
	}

	runAsHandler<T>(t: Trace, fn: () => T, opts: RunAsHandlerOptions): T {
		if (this._isHandlerRunning) {
			throw new Error(
				`runAsHandler: re-entrant invocation. ` +
				`current=${this._current.trace.describe()}, incoming=${t.describe()}`
			);
		}
		const prev = this._current;
		const next: Frame = { trace: t, prev };
		this._current = next;
		this._isHandlerRunning = true;
		try {
			return fn();
		} finally {
			this._isHandlerRunning = false;
			opts.afterMicrotaskClosure(() => {
				if (this._current === next) { this._current = prev; }
			});
		}
	}

	_resetForTesting(): void {
		this._current = ROOT_FRAME;
		this._isHandlerRunning = false;
	}
}
