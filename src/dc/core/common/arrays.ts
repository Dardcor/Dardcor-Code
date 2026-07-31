export function pushToStart<T>(arr: T[], item: T): void { arr.unshift(item); }
export function move<T>(arr: T[], from: number, to: number): void { arr.splice(to, 0, arr.splice(from, 1)[0]); }
export function findFirst<T>(arr: T[], fn: (i: T) => boolean): T | undefined { return arr.find(fn); }
export function groupBy<T, R>(arr: T[], fn: (i: T) => R): Record<string, T[]> { return arr.reduce((acc, i) => { const k = String(fn(i)); acc[k] = acc[k] || []; acc[k].push(i); return acc; }, {} as Record<string, T[]>); }
