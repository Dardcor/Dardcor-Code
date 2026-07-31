/**
 * Dardcor Code - Barrier Async Primitive
 */

export class Barrier {
	private _isOpen = false;
	private readonly _promise: Promise<boolean>;
	private _resolve!: (v: boolean) => void;

	constructor() {
		this._promise = new Promise<boolean>(resolve => {
			this._resolve = resolve;
		});
	}

	public isOpen(): boolean {
		return this._isOpen;
	}

	public open(): boolean {
		if (this._isOpen) {
			return false;
		}
		this._isOpen = true;
		this._resolve(true);
		return true;
	}

	public wait(): Promise<boolean> {
		return this._promise;
	}
}
