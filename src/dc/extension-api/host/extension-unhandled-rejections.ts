export class ExtensionUnhandledRejections {
	private readonly _errors: unknown[] = [];
	private _installed = false;
	private _listener: ((reason: unknown) => void) | undefined;

	public install(): void {
		if (this._installed) {
			return;
		}
		this._installed = true;
		if (typeof process === 'undefined' || typeof process.on !== 'function') {
			return;
		}
		this._listener = (reason: unknown) => {
			this._errors.push(reason);
			console.error('[extension-host] Unhandled rejection:', reason);
		};
		process.on('unhandledRejection', this._listener);
	}

	public uninstall(): void {
		if (!this._installed) {
			return;
		}
		this._installed = false;
		if (typeof process === 'undefined' || typeof process.removeListener !== 'function' || !this._listener) {
			return;
		}
		process.removeListener('unhandledRejection', this._listener);
		this._listener = undefined;
	}

	public getErrors(): unknown[] {
		return this._errors.slice();
	}

	public getErrorCount(): number {
		return this._errors.length;
	}

	public clear(): void {
		this._errors.length = 0;
	}

	public isInstalled(): boolean {
		return this._installed;
	}
}
