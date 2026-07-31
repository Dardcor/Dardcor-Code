export class DeferredPromise<T> { public p: Promise<T>; public completeCallback!: (v: T) => void; constructor() { this.p = new Promise<T>(c => { this.completeCallback = c; }); } complete(v: T) { this.completeCallback(v); } }
export function timeout(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
export class RunOnceScheduler { constructor(private runner: () => void, private timeout: number) {} schedule() { setTimeout(this.runner, this.timeout); } }
