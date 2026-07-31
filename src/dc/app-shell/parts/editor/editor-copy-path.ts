/**
 * Dardcor Code - Copy Path / Copy Relative Path Actions On Editor Tabs
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { URI } from '../../../core/types/uri.js';
import { Path } from '../../../core/types/path.js';
import { IClipboardService, BrowserClipboardService } from '../../../core/system/clipboard.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';
import { EditorInput } from './editor-input.js';

export interface IEditorCopyPathEvent {
	readonly uri: URI;
	readonly action: 'absolute' | 'relative' | 'name' | 'folder';
	readonly copiedText: string;
}

export interface IEditorCopyPathOptions {
	readonly workspaceRoot?: string;
	readonly clipboard?: IClipboardService;
}

export class EditorCopyPath extends Disposable {
	private readonly _workspaceRoot: string | null;
	private readonly _clipboard: IClipboardService;
	private _activeEditorProvider: (() => EditorInput | null) | null = null;

	private readonly _onDidCopy = this._register(new Emitter<IEditorCopyPathEvent>());
	readonly onDidCopy: Event<IEditorCopyPathEvent> = this._onDidCopy.event;

	constructor(options: IEditorCopyPathOptions = {}) {
		super();
		this._workspaceRoot = options.workspaceRoot ?? null;
		this._clipboard = options.clipboard ?? new BrowserClipboardService();
	}

	setActiveEditorProvider(provider: (() => EditorInput | null) | null): void {
		this._activeEditorProvider = provider;
	}

	async copyPath(input: EditorInput): Promise<boolean> {
		const text = input.uri.path;
		await this._clipboard.writeText(text);
		this._onDidCopy.fire({ uri: input.uri, action: 'absolute', copiedText: text });
		return true;
	}

	async copyRelativePath(input: EditorInput): Promise<boolean> {
		const relative = this.getRelativePath(input.uri);
		await this._clipboard.writeText(relative);
		this._onDidCopy.fire({ uri: input.uri, action: 'relative', copiedText: relative });
		return true;
	}

	async copyName(input: EditorInput): Promise<boolean> {
		const name = Path.basename(input.uri.path);
		await this._clipboard.writeText(name);
		this._onDidCopy.fire({ uri: input.uri, action: 'name', copiedText: name });
		return true;
	}

	async copyFolderPath(input: EditorInput): Promise<boolean> {
		const folder = Path.dirname(input.uri.path);
		await this._clipboard.writeText(folder);
		this._onDidCopy.fire({ uri: input.uri, action: 'folder', copiedText: folder });
		return true;
	}

	async copyActiveEditorPath(action: 'absolute' | 'relative' | 'name' = 'absolute'): Promise<boolean> {
		const input = this._activeEditorProvider?.() ?? null;
		if (!input) {
			return false;
		}
		switch (action) {
			case 'relative':
				return this.copyRelativePath(input);
			case 'name':
				return this.copyName(input);
			default:
				return this.copyPath(input);
		}
	}

	async copyAllPaths(inputs: EditorInput[]): Promise<boolean> {
		if (inputs.length === 0) {
			return false;
		}
		const text = inputs.map(input => input.uri.path).join('\n');
		await this._clipboard.writeText(text);
		this._onDidCopy.fire({ uri: inputs[0].uri, action: 'absolute', copiedText: text });
		return true;
	}

	getRelativePath(uri: URI): string {
		const full = uri.path;
		if (!this._workspaceRoot) {
			return full;
		}
		const root = Path.normalize(this._workspaceRoot);
		const norm = Path.normalize(full);
		if (norm === root) {
			return Path.basename(norm);
		}
		if (norm.startsWith(root.endsWith('/') ? root : root + '/')) {
			return norm.substring(root.endsWith('/') ? root.length : root.length + 1);
		}
		return full;
	}

	registerCommands(): { dispose(): void }[] {
		return [
			CommandRegistry.registerCommand({
				id: 'workbench.action.files.copyPathOfActiveFile',
				handler: () => this.copyActiveEditorPath('absolute'),
			}),
			CommandRegistry.registerCommand({
				id: 'workbench.action.files.copyRelativePathOfActiveFile',
				handler: () => this.copyActiveEditorPath('relative'),
			}),
			CommandRegistry.registerCommand({
				id: 'workbench.action.files.copyNameOfActiveFile',
				handler: () => this.copyActiveEditorPath('name'),
			}),
		];
	}

	dispose(): void {
		super.dispose();
	}
}
