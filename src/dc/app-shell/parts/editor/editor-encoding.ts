/**
 * Dardcor Code - Status Bar File Encoding Picker & Converter
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { decodeUTF8, encodeUTF8 } from '../../../core/binary/encoding.js';
import { QuickPickItem } from '../../quickinput/quick-pick-item.js';
import { IQuickInputService } from '../../quickinput/quick-input-service.js';
import { EditorInput } from './editor-input.js';
import { StatusbarAlignment, IStatusbarEntry, StatusbarRegistry } from '../statusbar/statusbar-registry.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';

export const enum EditorEncoding {
	UTF8 = 'utf-8',
	UTF16LE = 'utf-16le',
	UTF16BE = 'utf-16be',
	ISO88591 = 'iso-8859-1',
}

export interface IEncodingInfo {
	readonly id: EditorEncoding;
	readonly label: string;
	readonly detail: string;
}

const ENCODING_LABEL: Record<EditorEncoding, string> = {
	[EditorEncoding.UTF8]: 'UTF-8',
	[EditorEncoding.UTF16LE]: 'UTF-16 LE',
	[EditorEncoding.UTF16BE]: 'UTF-16 BE',
	[EditorEncoding.ISO88591]: 'ISO-8859-1',
};

export const SUPPORTED_ENCODINGS: IEncodingInfo[] = [
	{ id: EditorEncoding.UTF8, label: ENCODING_LABEL[EditorEncoding.UTF8], detail: 'Default encoding' },
	{ id: EditorEncoding.UTF16LE, label: ENCODING_LABEL[EditorEncoding.UTF16LE], detail: 'Little-endian with BOM' },
	{ id: EditorEncoding.UTF16BE, label: ENCODING_LABEL[EditorEncoding.UTF16BE], detail: 'Big-endian with BOM' },
	{ id: EditorEncoding.ISO88591, label: ENCODING_LABEL[EditorEncoding.ISO88591], detail: 'Western European (Latin-1)' },
];

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = new Uint8Array([0xff, 0xfe]);
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff]);

export function detectEncodingFromBom(buffer: Uint8Array): EditorEncoding | null {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return EditorEncoding.UTF8;
	}
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return EditorEncoding.UTF16LE;
	}
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
		return EditorEncoding.UTF16BE;
	}
	return null;
}

export function stripBom(buffer: Uint8Array, encoding: EditorEncoding): Uint8Array {
	const bomLength = encoding === EditorEncoding.UTF8 ? 3 : encoding === EditorEncoding.UTF16LE || encoding === EditorEncoding.UTF16BE ? 2 : 0;
	if (bomLength === 0) {
		return buffer;
	}
	const detected = detectEncodingFromBom(buffer);
	if (detected === encoding && buffer.length >= bomLength) {
		return buffer.subarray(bomLength);
	}
	return buffer;
}

export function encodeText(text: string, encoding: EditorEncoding, withBom = false): Uint8Array {
	switch (encoding) {
		case EditorEncoding.UTF8:
			return withBom ? concatBytes(UTF8_BOM, encodeUTF8(text).buffer) : encodeUTF8(text).buffer;
		case EditorEncoding.UTF16LE: {
			const bytes = encodeUtf16(text, false);
			return withBom ? concatBytes(UTF16LE_BOM, bytes) : bytes;
		}
		case EditorEncoding.UTF16BE: {
			const bytes = encodeUtf16(text, true);
			return withBom ? concatBytes(UTF16BE_BOM, bytes) : bytes;
		}
		case EditorEncoding.ISO88591:
			return encodeLatin1(text);
		default:
			return encodeUTF8(text).buffer;
	}
}

export function decodeText(buffer: Uint8Array, encoding: EditorEncoding): string {
	const stripped = stripBom(buffer, encoding);
	switch (encoding) {
		case EditorEncoding.UTF8:
			return decodeUTF8(stripped);
		case EditorEncoding.UTF16LE:
			return decodeUtf16(stripped, false);
		case EditorEncoding.UTF16BE:
			return decodeUtf16(stripped, true);
		case EditorEncoding.ISO88591:
			return decodeLatin1(stripped);
		default:
			return decodeUTF8(stripped);
	}
}

export function convertEncoding(buffer: Uint8Array, from: EditorEncoding, to: EditorEncoding, withBom = false): Uint8Array {
	if (from === to) {
		return buffer;
	}
	const text = decodeText(buffer, from);
	return encodeText(text, to, withBom);
}

export function getEncodingLabel(encoding: EditorEncoding): string {
	return ENCODING_LABEL[encoding] ?? encoding;
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
	const bytes = new Uint8Array(text.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (bigEndian) {
			view.setUint16(i * 2, code, false);
		} else {
			view.setUint16(i * 2, code, true);
		}
	}
	return bytes;
}

function decodeUtf16(buffer: Uint8Array, bigEndian: boolean): string {
	if (buffer.length % 2 !== 0) {
		buffer = buffer.subarray(0, buffer.length - 1);
	}
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	let result = '';
	for (let i = 0; i < view.byteLength; i += 2) {
		result += String.fromCharCode(view.getUint16(i, !bigEndian));
	}
	return result;
}

function encodeLatin1(text: string): Uint8Array {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) {
		bytes[i] = text.charCodeAt(i) & 0xff;
	}
	return bytes;
}

function decodeLatin1(buffer: Uint8Array): string {
	let result = '';
	for (let i = 0; i < buffer.length; i++) {
		result += String.fromCharCode(buffer[i]);
	}
	return result;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

export class EditorEncodingSupport extends Disposable {
	private _currentEncoding: EditorEncoding = EditorEncoding.UTF8;
	private readonly _inputs = new Map<string, EditorEncoding>();
	private _statusbarRegistration: IDisposable | null = null;

	private readonly _onDidChangeEncoding = this._register(new Emitter<{ input: EditorInput; encoding: EditorEncoding }>());
	readonly onDidChangeEncoding: Event<{ input: EditorInput; encoding: EditorEncoding }> = this._onDidChangeEncoding.event;

	constructor(
		private readonly _quickInput: IQuickInputService | null = null,
		private readonly _statusbar: StatusbarRegistry = StatusbarRegistry.instance
	) {
		super();
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.editor.changeEncoding',
			handler: () => this.showEncodingPicker(null),
		}));
	}

	get currentEncoding(): EditorEncoding {
		return this._currentEncoding;
	}

	getEncodingFor(input: EditorInput): EditorEncoding {
		return this._inputs.get(input.toKey()) ?? this._currentEncoding;
	}

	setEncoding(input: EditorInput, encoding: EditorEncoding): void {
		const model = input.getTextModel();
		if (model) {
			const oldEncoding = this.getEncodingFor(input);
			const content = model.getValue();
			const bytes = encodeText(content, encoding, encoding !== EditorEncoding.UTF8);
			const converted = decodeText(bytes, encoding);
			if (converted !== content) {
				model.setValue(converted);
			}
			this._inputs.set(input.toKey(), encoding);
			this._currentEncoding = encoding;
			this._onDidChangeEncoding.fire({ input, encoding });
		}
	}

	removeEncodingOverride(input: EditorInput): void {
		this._inputs.delete(input.toKey());
	}

	createEncodingItems(): QuickPickItem[] {
		return SUPPORTED_ENCODINGS.map(info =>
			new QuickPickItem({
				label: info.label,
				description: info.id === this._currentEncoding ? 'Current' : undefined,
				detail: info.detail,
				icon: info.id === EditorEncoding.UTF8 ? '\u2713' : '',
				data: info.id,
			})
		);
	}

	async showEncodingPicker(input: EditorInput | null): Promise<EditorEncoding | undefined> {
		if (!this._quickInput) {
			return undefined;
		}
		const current = input ? this.getEncodingFor(input) : this._currentEncoding;
		const items = SUPPORTED_ENCODINGS.map(info =>
			new QuickPickItem({
				label: info.label,
				description: info.id === current ? 'Current' : undefined,
				detail: info.detail,
				icon: info.id === current ? '\u2713' : '',
				data: info.id,
			})
		);
		const picked = await this._quickInput.openQuickPick<QuickPickItem>({
			title: 'Select File Encoding',
			placeholder: 'Choose an encoding for the active file',
			items,
		});
		const encoding = picked?.data as EditorEncoding | undefined;
		if (encoding && input) {
			this.setEncoding(input, encoding);
		} else if (encoding) {
			this._currentEncoding = encoding;
		}
		return encoding;
	}

	updateStatusbar(entry: Pick<IStatusbarEntry, 'id' | 'alignment' | 'text' | 'tooltip' | 'commandId' | 'priority' | 'color'>): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = this._statusbar.register({
			...entry,
			text: `${ENCODING_LABEL[this._currentEncoding]}`,
			tooltip: `Encoding: ${ENCODING_LABEL[this._currentEncoding]}`,
			commandId: 'workbench.action.editor.changeEncoding',
			priority: entry.priority ?? 0,
		});
	}

	dispose(): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = null;
		this._inputs.clear();
		super.dispose();
	}
}
