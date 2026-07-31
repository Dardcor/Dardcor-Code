import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface ISignatureHelp {
	readonly label: string;
	readonly parameters: readonly string[];
	readonly documentation?: string;
	readonly activeParameter?: number;
}

export class ParameterHintsController extends Disposable {
	private _signatures: ISignatureHelp[] = [];
	private _activeSignature = 0;
	private _activeParameter = 0;
	private _isActive = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public trigger(signatures: ISignatureHelp[], activeParameter: number = 0): boolean {
		if (signatures.length === 0) {
			this.cancel();
			return false;
		}
		this._signatures = signatures.slice();
		this._activeSignature = 0;
		this._activeParameter = Math.max(0, signatures[0].activeParameter ?? activeParameter);
		this._isActive = true;
		this._onDidChange.fire();
		return true;
	}

	public cancel(): void {
		if (!this._isActive) {
			return;
		}
		this._isActive = false;
		this._signatures = [];
		this._activeSignature = 0;
		this._activeParameter = 0;
		this._onDidChange.fire();
	}

	public next(): void {
		if (!this._isActive || this._signatures.length <= 1) {
			return;
		}
		this._activeSignature = (this._activeSignature + 1) % this._signatures.length;
		this._syncActiveParameter();
		this._onDidChange.fire();
	}

	public previous(): void {
		if (!this._isActive || this._signatures.length <= 1) {
			return;
		}
		this._activeSignature = (this._activeSignature - 1 + this._signatures.length) % this._signatures.length;
		this._syncActiveParameter();
		this._onDidChange.fire();
	}

	public cycleParameterForward(): void {
		if (!this._isActive) {
			return;
		}
		const signature = this.getActiveSignature();
		if (!signature || signature.parameters.length === 0) {
			return;
		}
		this._activeParameter = (this._activeParameter + 1) % signature.parameters.length;
		this._onDidChange.fire();
	}

	public cycleParameterBackward(): void {
		if (!this._isActive) {
			return;
		}
		const signature = this.getActiveSignature();
		if (!signature || signature.parameters.length === 0) {
			return;
		}
		this._activeParameter = (this._activeParameter - 1 + signature.parameters.length) % signature.parameters.length;
		this._onDidChange.fire();
	}

	public setActiveParameter(activeParameter: number): void {
		if (!this._isActive) {
			return;
		}
		const signature = this.getActiveSignature();
		if (signature) {
			this._activeParameter = Math.max(0, Math.min(activeParameter, Math.max(0, signature.parameters.length - 1)));
			this._onDidChange.fire();
		}
	}

	public isActive(): boolean {
		return this._isActive;
	}

	public getSignatures(): ISignatureHelp[] {
		return this._signatures.slice();
	}

	public getSignatureCount(): number {
		return this._signatures.length;
	}

	public getActiveSignature(): ISignatureHelp | undefined {
		if (!this._isActive || this._activeSignature < 0 || this._activeSignature >= this._signatures.length) {
			return undefined;
		}
		return this._signatures[this._activeSignature];
	}

	public getActiveSignatureIndex(): number {
		return this._activeSignature;
	}

	public getActiveParameter(): number {
		return this._activeParameter;
	}

	public getActiveParameterLabel(): string {
		const signature = this.getActiveSignature();
		if (!signature || this._activeParameter < 0 || this._activeParameter >= signature.parameters.length) {
			return '';
		}
		return signature.parameters[this._activeParameter];
	}

	private _syncActiveParameter(): void {
		const signature = this.getActiveSignature();
		if (!signature) {
			this._activeParameter = 0;
			return;
		}
		this._activeParameter = Math.max(0, Math.min(signature.activeParameter ?? 0, Math.max(0, signature.parameters.length - 1)));
	}
}
