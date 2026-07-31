export function ok(value: any, message?: string): asserts value { if (!value) throw new Error(message || 'Assertion failed'); }
export function assertNever(value: never, message?: string): never { throw new Error(message || 'Unreachable'); }
export function checkNull<T>(value: T | null | undefined): T { if (value == null) throw new Error('Value is null or undefined'); return value; }
