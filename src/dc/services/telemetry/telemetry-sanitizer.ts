/**
 * Dardcor Code - Telemetry PII Sanitizer (Task 123)
 */

import { homedir } from 'node:os';

export class TelemetrySanitizer {
	private static readonly _emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
	private static readonly _ipv4Regex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
	private static readonly _driveRegex = /^([A-Za-z]):/;
	private static readonly _maxDepth = 10;

	public static cleanPII(input: string): string {
		return input
			.replace(this._emailRegex, '<EMAIL>')
			.replace(this._ipv4Regex, '<IP>');
	}

	public static maskPath(input: string, protectedPaths: readonly string[]): string {
		let result = input;
		const home = homedir();
		if (home && result.includes(home)) {
			result = result.split(home).join('<HOME>');
		}
		for (const path of protectedPaths) {
			if (path && result.includes(path)) {
				result = result.split(path).join('<PROTECTED>');
			}
		}
		if (this._driveRegex.test(result)) {
			result = result.replace(this._driveRegex, '<DRIVE>:');
		}
		return result;
	}

	public static sanitize(value: any, protectedPaths: readonly string[] = [], depth: number = 0): any {
		if (depth > this._maxDepth) {
			return undefined;
		}
		if (value === null || value === undefined) {
			return value;
		}
		switch (typeof value) {
			case 'string':
				return this.cleanPII(this.maskPath(value, protectedPaths));
			case 'number':
			case 'boolean':
				return value;
			case 'object': {
				if (Array.isArray(value)) {
					return value.map((item) => this.sanitize(item, protectedPaths, depth + 1));
				}
				const result: Record<string, any> = {};
				for (const [key, item] of Object.entries(value)) {
					result[key] = this.sanitize(item, protectedPaths, depth + 1);
				}
				return result;
			}
			default:
				return undefined;
		}
	}

	public static sanitizeError(error: Error, protectedPaths: readonly string[] = []): { name: string; message: string; stack: string | undefined } {
		return {
			name: error.name,
			message: this.cleanPII(this.maskPath(error.message, protectedPaths)),
			stack: error.stack ? this.cleanPII(this.maskPath(error.stack, protectedPaths)) : undefined
		};
	}

	public static sanitizeObject(value: any, protectedPaths: readonly string[] = []): any {
		return this.sanitize(value, protectedPaths);
	}
}
