/**
 * Dardcor Code - Signature Help Active Parameter Index Calculator
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";

export interface IParameterInfo {
	readonly label: string;
	readonly documentation?: string;
}

export interface ISignatureInformation {
	readonly label: string;
	readonly documentation?: string;
	readonly parameters?: readonly IParameterInfo[];
}

export interface ISignatureHelp {
	readonly signatures: readonly ISignatureInformation[];
	readonly activeSignature?: number;
	readonly activeParameter?: number;
}

export interface IParameterHintsState {
	readonly signatureHelp: ISignatureHelp | null;
	readonly activeSignature: number;
	readonly activeParameter: number;
}

export class ParameterHintsModel extends Disposable {
	private _signatureHelp: ISignatureHelp | null = null;
	private _activeSignature: number = 0;
	private _activeParameter: number = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public update(signatureHelp: ISignatureHelp, textBeforeCursor: string): void {
		this._signatureHelp = signatureHelp;
		if (signatureHelp.signatures.length === 0) {
			this._activeSignature = 0;
			this._activeParameter = 0;
			this._onDidChange.fire();
			return;
		}
		const hintSignature = signatureHelp.activeSignature ?? 0;
		this._activeSignature = Math.max(0, Math.min(hintSignature, signatureHelp.signatures.length - 1));
		this._activeParameter = this.computeActiveParameter(textBeforeCursor, signatureHelp, this._activeSignature);
		this._onDidChange.fire();
	}

	public setSignatureHelp(signatureHelp: ISignatureHelp | null): void {
		this._signatureHelp = signatureHelp;
		if (!signatureHelp) {
			this._activeSignature = 0;
			this._activeParameter = 0;
		}
		this._onDidChange.fire();
	}

	public nextSignature(): void {
		if (!this._signatureHelp || this._signatureHelp.signatures.length <= 1) {
			return;
		}
		this._activeSignature = (this._activeSignature + 1) % this._signatureHelp.signatures.length;
		this._activeParameter = Math.min(
			this._activeParameter,
			Math.max(0, (this._signatureHelp.signatures[this._activeSignature]?.parameters?.length ?? 0) - 1)
		);
		this._onDidChange.fire();
	}

	public previousSignature(): void {
		if (!this._signatureHelp || this._signatureHelp.signatures.length <= 1) {
			return;
		}
		this._activeSignature = (this._activeSignature - 1 + this._signatureHelp.signatures.length) % this._signatureHelp.signatures.length;
		this._activeParameter = Math.min(
			this._activeParameter,
			Math.max(0, (this._signatureHelp.signatures[this._activeSignature]?.parameters?.length ?? 0) - 1)
		);
		this._onDidChange.fire();
	}

	public computeActiveParameter(textBeforeCursor: string, signatureHelp: ISignatureHelp, signatureIndex: number): number {
		const signature = signatureHelp.signatures[signatureIndex];
		if (!signature) {
			return 0;
		}
		const parameterCount = Math.max(0, signature.parameters?.length ?? 0);
		if (parameterCount === 0) {
			return 0;
		}
		let depth = 0;
		let commaCount = 0;
		let quote: string | null = null;
		for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
			const ch = textBeforeCursor[i];
			if (quote) {
				if (ch === quote && (i === 0 || textBeforeCursor[i - 1] !== "\\")) {
					quote = null;
				}
				continue;
			}
			if (ch === "'" || ch === "\"" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === ")") {
				depth++;
				continue;
			}
			if (ch === "(") {
				if (depth === 0) {
					break;
				}
				depth--;
				continue;
			}
			if (depth === 0 && ch === ",") {
				commaCount++;
			}
		}
		return Math.min(commaCount, parameterCount - 1);
	}

	public getState(): IParameterHintsState {
		return {
			signatureHelp: this._signatureHelp,
			activeSignature: this._activeSignature,
			activeParameter: this._activeParameter
		};
	}

	public get signatureHelp(): ISignatureHelp | null {
		return this._signatureHelp;
	}

	public get activeSignature(): number {
		return this._activeSignature;
	}

	public get activeParameter(): number {
		return this._activeParameter;
	}
}
