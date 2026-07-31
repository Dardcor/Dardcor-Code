export interface IIsolationContextOptions {
	readonly timeoutMs?: number;
}

const RESTRICTED_GLOBALS: Record<string, unknown> = {
	Math,
	JSON,
	Object,
	Array,
	String,
	Number,
	Boolean,
	Date,
	RegExp,
	Error,
	TypeError,
	RangeError,
	SyntaxError,
	Map,
	Set,
	WeakMap,
	WeakSet,
	Promise,
	Symbol,
	BigInt,
	parseInt,
	parseFloat,
	isNaN,
	isFinite,
	encodeURIComponent,
	decodeURIComponent,
	encodeURI,
	decodeURI,
	escape,
	unescape,
	console: {
		log: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		debug: () => undefined
	}
};

interface IVmLike {
	runInNewContext(code: string, sandbox: Record<string, unknown>, options?: { timeout?: number }): unknown;
}

export class ExtensionIsolation {
	private _vm: IVmLike | undefined;
	private _vmFailed = false;
	private readonly _vmPromise: Promise<IVmLike | undefined>;
	private readonly _timeoutMs: number;

	constructor(options: IIsolationContextOptions = {}) {
		this._timeoutMs = options.timeoutMs ?? 2000;
		this._vmPromise = this._initVm();
	}

	public async ready(): Promise<void> {
		await this._vmPromise;
	}

	public runInIsolatedContext<T>(code: string, sandbox: Record<string, unknown>): T {
		const merged = { ...RESTRICTED_GLOBALS, ...sandbox };
		if (this._vm) {
			return this._vm.runInNewContext(code, merged, { timeout: this._timeoutMs }) as T;
		}
		return this._runWithFunction(code, merged) as T;
	}

	public async runInIsolatedContextAsync<T>(code: string, sandbox: Record<string, unknown>): Promise<T> {
		await this._vmPromise;
		return this.runInIsolatedContext<T>(code, sandbox);
	}

	public usesVm(): boolean {
		return this._vm !== undefined;
	}

	private async _initVm(): Promise<IVmLike | undefined> {
		if (typeof process === 'undefined') {
			return undefined;
		}
		if (this._vmFailed) {
			return undefined;
		}
		try {
			const vm = await import('node:vm');
			this._vm = vm;
			return vm;
		} catch {
			this._vmFailed = true;
			return undefined;
		}
	}

	private _runWithFunction(code: string, sandbox: Record<string, unknown>): unknown {
		const keys = Object.keys(sandbox);
		const values = keys.map(key => sandbox[key]);
		const factory = new Function(...keys, `"use strict";\n${code}`);
		return factory(...values);
	}
}
