export function compareAnything(a: any, b: any) { return a === b ? 0 : (a < b ? -1 : 1); }
export function compareIgnoreCase(a: string, b: string) { return a.toLowerCase().localeCompare(b.toLowerCase()); }
