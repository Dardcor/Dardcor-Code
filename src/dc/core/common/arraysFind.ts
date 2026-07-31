export function findLast<T>(arr: T[], fn: (i: T) => boolean): T | undefined { for (let i = arr.length - 1; i >= 0; i--) { if (fn(arr[i])) return arr[i]; } return undefined; }
export function findFirst<T>(arr: T[], fn: (i: T) => boolean): T | undefined { return arr.find(fn); }
export function findMaxBy<T>(arr: T[], fn: (i: T, j: T) => number): T | undefined { if (arr.length === 0) return undefined; return arr.reduce((max, i) => fn(max, i) > 0 ? max : i); }
