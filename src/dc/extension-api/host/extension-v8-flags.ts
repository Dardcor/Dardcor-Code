export const extensionV8Flags: string[] = [
	'--max-old-space-size=2048',
	'--stack-size=984',
	'--optimize-for-size'
];

export function getExtensionV8Flags(): string[] {
	return extensionV8Flags.slice();
}

export function applyV8Flags(): void {
	if (typeof process === 'undefined' || !Array.isArray(process.execArgv)) {
		return;
	}
	const existing = new Set(process.execArgv);
	for (const flag of extensionV8Flags) {
		if (!existing.has(flag)) {
			process.execArgv.push(flag);
		}
	}
}

export function applyV8FlagsTo(args: string[]): string[] {
	const existing = new Set(args);
	const result = args.slice();
	for (const flag of extensionV8Flags) {
		if (!existing.has(flag)) {
			result.push(flag);
		}
	}
	return result;
}

export function removeV8Flags(args: string[]): string[] {
	return args.filter(arg => !extensionV8Flags.includes(arg));
}

export function hasV8Flags(args: string[]): boolean {
	return args.some(arg => extensionV8Flags.includes(arg));
}
