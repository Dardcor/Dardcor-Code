/**
 * Dardcor Code - SyncDescriptor & AsyncDescriptor
 */

export class SyncDescriptor<T> {
	readonly ctor: new (...args: any[]) => T;
	readonly staticArguments: any[];
	readonly supportsDelayedInstantiation: boolean;

	constructor(ctor: new (...args: any[]) => T, staticArguments: any[] = [], supportsDelayedInstantiation = false) {
		this.ctor = ctor;
		this.staticArguments = staticArguments;
		this.supportsDelayedInstantiation = supportsDelayedInstantiation;
	}
}

export class AsyncDescriptor<T> {
	readonly ctor: Promise<new (...args: any[]) => T>;
	readonly staticArguments: any[];

	constructor(ctor: Promise<new (...args: any[]) => T>, staticArguments: any[] = []) {
		this.ctor = ctor;
		this.staticArguments = staticArguments;
	}
}
