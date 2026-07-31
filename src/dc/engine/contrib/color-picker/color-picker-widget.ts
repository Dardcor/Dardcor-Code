/**
 * Dardcor Code - Inline CSS Color Preview & Picker Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IRange, IPosition } from "../../model/text-model.js";

export interface IColorRegion {
	readonly range: IRange;
	readonly text: string;
	readonly hex: string;
}

export interface IColorPickerHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
}

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+)?\s*\)/g;
const HSL_RE = /hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+)?\s*\)/g;

function componentToHex(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function parseRgbToHex(text: string): string {
	const match = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text);
	if (!match) {
		return "#000000";
	}
	return rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseHslToHex(text: string): string {
	const match = /hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(text);
	if (!match) {
		return "#000000";
	}
	const h = Number(match[1]);
	const s = Number(match[2]) / 100;
	const l = Number(match[3]) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h / 60) % 2 - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) { r = c; g = x; }
	else if (h < 120) { r = x; g = c; }
	else if (h < 180) { g = c; b = x; }
	else if (h < 240) { g = x; b = c; }
	else if (h < 300) { r = x; b = c; }
	else { r = c; b = x; }
	return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export class ColorPickerWidget extends Disposable {
	private readonly _host: IColorPickerHost;
	private readonly _domNode: HTMLElement;
	private readonly _swatchesNode: HTMLElement;
	private readonly _pickerNode: HTMLElement;
	private _regions: IColorRegion[] = [];
	private _activeRegion: IColorRegion | null = null;
	private _model: ITextModel | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidApply = this._register(new Emitter<IColorRegion>());
	readonly onDidApply: Event<IColorRegion> = this._onDidApply.event;

	constructor(host: IColorPickerHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-color-picker-widget");
		this._swatchesNode = $<HTMLElement>("div", "dc-color-swatches");
		this._pickerNode = $<HTMLElement>("div", "dc-color-picker");

		this._domNode.appendChild(this._swatchesNode);
		this._domNode.appendChild(this._pickerNode);
		this._domNode.style.cssText = "position:absolute;z-index:57;display:none;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:8px;font-family:Segoe UI, sans-serif;font-size:12px;color:#d4d4d4;";
		this._swatchesNode.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;max-width:220px;";
		this._pickerNode.style.cssText = "margin-top:8px;display:flex;gap:6px;align-items:center;";
		host.getContainer().appendChild(this._domNode);
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.refresh();
	}

	public refresh(): void {
		const model = this._model;
		this._regions = [];
		if (model) {
			this._regions = this.scan(model);
		}
		this._renderSwatches();
		this._onDidChange.fire();
	}

	public scan(model: ITextModel): IColorRegion[] {
		const regions: IColorRegion[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			for (const regex of [HEX_RE, RGB_RE, HSL_RE]) {
				for (const m of text.matchAll(regex)) {
					const found = m[0];
					const start = m.index ?? 0;
					let hex: string;
					if (found.startsWith("#")) {
						hex = this._normalizeHex(found);
					} else if (/^rgb/i.test(found)) {
						hex = parseRgbToHex(found);
					} else {
						hex = parseHslToHex(found);
					}
					regions.push({
						range: { startLineNumber: line, startColumn: start + 1, endLineNumber: line, endColumn: start + found.length + 1 },
						text: found,
						hex
					});
				}
			}
		}
		regions.sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		return regions;
	}

	private _normalizeHex(value: string): string {
		if (value.length === 4 || value.length === 5) {
			return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
		}
		return value.substring(0, 7);
	}

	public findRegionAt(model: ITextModel, position: IPosition): IColorRegion | null {
		const regions = this._regions.length > 0 ? this._regions : this.scan(model);
		for (const region of regions) {
			if (region.range.startLineNumber === position.lineNumber &&
				position.column >= region.range.startColumn && position.column <= region.range.endColumn) {
				return region;
			}
		}
		return null;
	}

	public showPicker(anchor: { x: number; y: number }, region: IColorRegion): void {
		this._activeRegion = region;
		clearNode(this._pickerNode);

		const colorInput = $<HTMLInputElement>("input", "dc-color-picker-native");
		colorInput.type = "color";
		colorInput.value = region.hex;
		colorInput.style.cssText = "width:34px;height:26px;border:none;padding:0;background:transparent;cursor:pointer;";

		const hexInput = $<HTMLInputElement>("input", "dc-color-picker-hex");
		hexInput.value = region.hex;
		hexInput.style.cssText = "width:84px;background:#3c3c3c;border:1px solid #454545;color:#d4d4d4;padding:3px 6px;border-radius:2px;outline:none;";

		const applyButton = $<HTMLButtonElement>("button", "dc-color-picker-apply");
		applyButton.textContent = "Apply";
		applyButton.style.cssText = "background:#0e639c;color:white;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;";

		this._pickerNode.appendChild(colorInput);
		this._pickerNode.appendChild(hexInput);
		this._pickerNode.appendChild(applyButton);

		this._register(addDisposableListener(colorInput, "input", () => {
			hexInput.value = colorInput.value;
			this._preview(hexInput.value);
		}));
		this._register(addDisposableListener(hexInput, "input", () => {
			if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
				colorInput.value = hexInput.value;
				this._preview(hexInput.value);
			}
		}));
		this._register(addDisposableListener(applyButton, "click", () => {
			this._apply(hexInput.value);
		}));

		this._domNode.style.display = "block";
		this._position(anchor);
	}

	public hidePicker(): void {
		this._domNode.style.display = "none";
		this._activeRegion = null;
	}

	public applyToRegion(model: ITextModel, region: IColorRegion, hex: string): void {
		const text = model.getValue();
		const lines = text.split(/\r?\n/);
		const line = lines[region.range.startLineNumber - 1] ?? "";
		lines[region.range.startLineNumber - 1] =
			line.substring(0, region.range.startColumn - 1) + hex + line.substring(region.range.endColumn - 1);
		model.setValue(lines.join("\n"));
		this.refresh();
	}

	private _preview(hex: string): void {
		if (!this._activeRegion) {
			return;
		}
		this._apply(hex, true);
	}

	private _apply(hex: string, isPreview: boolean = false): void {
		const model = this._model;
		const region = this._activeRegion;
		if (!model || !region || !/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
			return;
		}
		this.applyToRegion(model, region, hex);
		if (!isPreview) {
			this.hidePicker();
			this._onDidApply.fire(region);
		}
	}

	private _renderSwatches(): void {
		clearNode(this._swatchesNode);
		for (const region of this._regions) {
			const swatch = $<HTMLElement>("span", "dc-color-swatch");
			swatch.style.cssText = `width:16px;height:16px;border-radius:3px;background:${region.hex};border:1px solid #666;cursor:pointer;display:inline-block;`;
			swatch.title = `${region.text} (line ${region.range.startLineNumber})`;
			this._register(addDisposableListener(swatch, "click", () => {
				const anchor = this._host.getCoordinates(region.range.startLineNumber, region.range.startColumn);
				if (anchor) {
					this.showPicker({ x: anchor.x, y: anchor.y + anchor.height }, region);
				}
			}));
			this._swatchesNode.appendChild(swatch);
		}
	}

	private _position(anchor: { x: number; y: number }): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		let left = anchor.x;
		let top = anchor.y;
		if (left + this._domNode.offsetWidth > rect.width) {
			left = Math.max(0, rect.width - this._domNode.offsetWidth);
		}
		if (top + this._domNode.offsetHeight > rect.height) {
			top = Math.max(0, anchor.y - this._domNode.offsetHeight);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
	}

	public getRegions(): readonly IColorRegion[] {
		return this._regions;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
