/**
 * Dardcor Code - Function Signature Help UI Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { IHoverAnchor } from "../hover/hover-widget.js";
import { ParameterHintsModel } from "./parameter-hints-model.js";

export class ParameterHintsWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _signaturesNode: HTMLElement;
	private readonly _detailsNode: HTMLElement;
	private readonly _model: ParameterHintsModel;
	private _isVisible: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(parent: HTMLElement, model: ParameterHintsModel) {
		super();
		this._model = model;

		this._domNode = $<HTMLElement>("div", "dc-parameter-hints-widget");
		this._signaturesNode = $<HTMLElement>("div", "dc-parameter-hints-signatures");
		this._detailsNode = $<HTMLElement>("div", "dc-parameter-hints-details");

		this._domNode.appendChild(this._signaturesNode);
		this._domNode.appendChild(this._detailsNode);
		this._domNode.style.cssText = "position:absolute;z-index:61;display:none;max-width:560px;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:6px 10px;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;line-height:1.5;";
		this._detailsNode.style.cssText = "color:#b5b5b5;font-size:12px;margin-top:4px;border-top:1px solid #3a3a3a;padding-top:4px;";
		parent.appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(this._model.onDidChange(() => {
			if (this._isVisible) {
				this._render();
			}
		}));
	}

	public show(anchor: IHoverAnchor): void {
		this._isVisible = true;
		this._render();
		this._position(anchor);
		this._domNode.style.display = "block";
	}

	public hide(): void {
		this._isVisible = false;
		this._domNode.style.display = "none";
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public nextSignature(): void {
		this._model.nextSignature();
	}

	public previousSignature(): void {
		this._model.previousSignature();
	}

	private _render(): void {
		const state = this._model.getState();
		clearNode(this._signaturesNode);
		clearNode(this._detailsNode);
		if (!state.signatureHelp || state.signatureHelp.signatures.length === 0) {
			return;
		}
		const signatures = state.signatureHelp.signatures;
		for (let i = 0; i < signatures.length; i++) {
			const signature = signatures[i];
			const row = $<HTMLElement>("div", i === state.activeSignature ? "dc-parameter-hints-signature active" : "dc-parameter-hints-signature");
			row.style.cssText = "padding:1px 0;";
			if (i !== state.activeSignature) {
				row.style.opacity = "0.5";
			}
			if (signatures.length > 1 && i === state.activeSignature) {
				const counter = $<HTMLElement>("span", "dc-parameter-hints-counter");
				counter.textContent = `${i + 1}/${signatures.length}`;
				counter.style.cssText = "color:#969696;margin-right:8px;";
				row.appendChild(counter);
			}
			row.appendChild(this._renderSignatureLabel(signature.label, state.activeSignature, state.activeParameter));
			this._signaturesNode.appendChild(row);
		}
		const active = signatures[state.activeSignature];
		const doc = active?.documentation;
		if (doc) {
			this._detailsNode.textContent = doc;
			this._detailsNode.style.display = "block";
		} else {
			this._detailsNode.style.display = "none";
		}
	}

	private _renderSignatureLabel(label: string, activeSignature: number, activeParameter: number): HTMLElement {
		const span = $<HTMLElement>("span", "dc-parameter-hints-label");
		const paramStart = label.indexOf("(");
		const paramEnd = label.lastIndexOf(")");
		if (paramStart === -1 || paramEnd <= paramStart) {
			span.textContent = label;
			return span;
		}
		span.appendChild(document.createTextNode(label.substring(0, paramStart + 1)));
		const paramsText = label.substring(paramStart + 1, paramEnd);
		const params = paramsText.split(",").map(p => p.trim());
		for (let i = 0; i < params.length; i++) {
			const isActive = i === activeParameter && activeSignature === this._model.activeSignature;
			if (i > 0) {
				span.appendChild(document.createTextNode(", "));
			}
			const p = $<HTMLElement>("span", isActive ? "dc-parameter-hints-parameter active" : "dc-parameter-hints-parameter");
			if (isActive) {
				p.style.cssText = "background:#04395e;color:#9cdcfe;border-radius:2px;padding:0 2px;";
			}
			p.textContent = params[i];
			span.appendChild(p);
		}
		span.appendChild(document.createTextNode(label.substring(paramEnd)));
		return span;
	}

	private _position(anchor: IHoverAnchor): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		const nodeHeight = this._domNode.offsetHeight;
		let left = anchor.x;
		let top = anchor.y + anchor.height;
		if (top + nodeHeight > rect.height) {
			top = Math.max(0, anchor.y - nodeHeight);
		}
		if (left + this._domNode.offsetWidth > rect.width) {
			left = Math.max(0, rect.width - this._domNode.offsetWidth);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
	}

	public layout(): void {
		if (this._isVisible) {
			this._domNode.style.maxWidth = "560px";
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
