export class Lazy<T> { constructor(private factory: () => T) {} get value(): T { return this.factory(); } }
