import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCustomEditorInfo {
	readonly id: string;
	readonly displayName: string;
	readonly selector: { readonly filenamePattern?: string }[];
	readonly priority: 'default' | 'option' | 'builtin';
}

export interface IServerCustomEditorService {
	readonly onDidRegisterCustomEditor: Event<IServerCustomEditorInfo>;
	readonly onDidUnregisterCustomEditor: Event<string>;
	registerCustomEditor(info: IServerCustomEditorInfo): IDisposable;
	getCustomEditors(resource: string): IServerCustomEditorInfo[];
	getCustomEditor(id: string): IServerCustomEditorInfo | undefined;
	getAllCustomEditors(): IServerCustomEditorInfo[];
}

export class ServerCustomEditorCommon implements IServerCustomEditorService {
	private readonly _editors = new Map<string, IServerCustomEditorInfo>();

	private readonly _onDidRegisterCustomEditor = new Emitter<IServerCustomEditorInfo>();
	readonly onDidRegisterCustomEditor: Event<IServerCustomEditorInfo> = this._onDidRegisterCustomEditor.event;

	private readonly _onDidUnregisterCustomEditor = new Emitter<string>();
	readonly onDidUnregisterCustomEditor: Event<string> = this._onDidUnregisterCustomEditor.event;

	registerCustomEditor(info: IServerCustomEditorInfo): IDisposable {
		this._editors.set(info.id, info);
		this._onDidRegisterCustomEditor.fire(info);
		return { dispose: () => { this._editors.delete(info.id); this._onDidUnregisterCustomEditor.fire(info.id); } };
	}

	getCustomEditors(resource: string): IServerCustomEditorInfo[] {
		return Array.from(this._editors.values()).filter(e =>
			e.selector.some(s => !s.filenamePattern || new RegExp(s.filenamePattern.replace(/\*/g, '.*')).test(resource))
		);
	}

	getCustomEditor(id: string): IServerCustomEditorInfo | undefined {
		return this._editors.get(id);
	}

	getAllCustomEditors(): IServerCustomEditorInfo[] {
		return Array.from(this._editors.values());
	}
}
