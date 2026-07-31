export interface Event<T> { (listener: (e: T) => any): { dispose(): void }; }
export class Emitter<T> { event: Event<T> = () => ({ dispose: () => {} }); fire(event: T) {} }
export class PauseableEmitter<T> extends Emitter<T> {}
export class DebounceEmitter<T> extends Emitter<T> {}
export class Relay<T> {}
export function mapEvent() {}
export function filterEvent() {}
export function buffer() {}
export function once() {}
export function anyEvent() {}
export class EventMultiplexer<T> {}
export function signal() {}
