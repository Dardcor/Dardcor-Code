/**
 * Dardcor Code - Cross-Platform Process Environment Reader
 */

declare const process: any;

export namespace Process {
	export const env: Record<string, string | undefined> =
		typeof process !== 'undefined' && process.env ? process.env : {};

	export const cwd: string =
		typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '/';

	export const pid: number =
		typeof process !== 'undefined' ? process.pid : 0;
}
