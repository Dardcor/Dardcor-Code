export interface IDisposable { dispose(): void; }
export function dispose() {}
export class Disposable implements IDisposable { dispose() {} }
export class DisposableStore implements IDisposable { dispose() {} }
export class MutableDisposable<T> implements IDisposable { dispose() {} }
export function combinedDisposable() {}
export function toDisposable() {}
