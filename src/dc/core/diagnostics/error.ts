/**
 * Dardcor Code - Custom Error Hierarchy
 */

export class CancelledError extends Error {
	constructor() {
		super('Canceled');
		this.name = 'CancelledError';
	}
}

export class BugError extends Error {
	constructor(message: string) {
		super(`BugIndicatingError: ${message}`);
		this.name = 'BugError';
	}
}

export function isCancelledError(err: any): boolean {
	return err instanceof CancelledError || (err && err.name === 'CancelledError');
}
