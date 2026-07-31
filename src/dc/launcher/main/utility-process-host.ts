import { UtilityProcessRpc } from './utility-process-rpc.js';

export type ServiceMethod = (args: unknown[]) => unknown | Promise<unknown>;
export type ServiceMethods = Record<string, ServiceMethod>;

export interface UtilityProcessHostOptions {
	serviceName?: string;
}

const DEFAULT_METHODS: ServiceMethods = {
	'memory:getStats': () => {
		const usage = process.memoryUsage();
		return {
			pid: process.pid,
			heapUsed: usage.heapUsed,
			heapTotal: usage.heapTotal,
			rss: usage.rss,
			external: usage.external,
			timestamp: Date.now()
		};
	},
	'process:info': () => ({
		pid: process.pid,
		title: process.title,
		platform: process.platform,
		arch: process.arch,
		versions: {
			node: process.versions.node,
			v8: process.versions.v8
		},
		uptime: process.uptime(),
		cwd: process.cwd()
	}),
	'echo': (args: unknown[]) => args,
	'ping': () => 'pong'
};

export class UtilityProcessHost {
	private readonly _rpc = new UtilityProcessRpc();
	private readonly _methods: ServiceMethods;
	private _port: any = null;
	private _started = false;

	constructor(options: UtilityProcessHostOptions = {}) {
		this._methods = { ...DEFAULT_METHODS };
	}

	public registerService(name: string, methods: ServiceMethods): void {
		for (const [method, handler] of Object.entries(methods)) {
			this._methods[`${name}:${method}`] = handler;
		}
	}

	public registerMethod(method: string, handler: ServiceMethod): void {
		this._methods[method] = handler;
	}

	public getMethodNames(): string[] {
		return Object.keys(this._methods);
	}

	public hasMethod(method: string): boolean {
		return method in this._methods;
	}

	public start(): boolean {
		if (this._started) {
			return true;
		}
		const parentPort = (process as any).parentPort;
		if (!parentPort) {
			console.error('[utility-process-host] no parent port available');
			return false;
		}
		this._port = parentPort;
		this._rpc.expose(this._port, this._methods);
		this._started = true;
		return true;
	}

	public isStarted(): boolean {
		return this._started;
	}

	public getPid(): number {
		return process.pid;
	}

	public dispose(): void {
		this._rpc.dispose();
		this._started = false;
	}
}

export function startUtilityProcessHost(options?: UtilityProcessHostOptions): UtilityProcessHost {
	const host = new UtilityProcessHost(options);
	host.start();
	return host;
}

export function getParentPortOrExit(): any {
	const parentPort = (process as any).parentPort;
	if (!parentPort) {
		process.exit(1);
	}
	return parentPort;
}

export function runUtilityProcessHost(registerServices?: (host: UtilityProcessHost) => void): UtilityProcessHost {
	const host = new UtilityProcessHost();
	registerServices?.(host);
	host.start();
	return host;
}
