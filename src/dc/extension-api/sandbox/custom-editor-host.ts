import { Disposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';

export interface ICustomEditorDescriptor {
	id: string;
	uri: URI;
	viewType: string;
	title: string;
	iframe?: HTMLIFrameElement;
}

export interface IResolveCustomEditorOptions {
	uri: URI | string;
	viewType: string;
	title: string;
}

export class CustomEditorHost extends Disposable {
	private readonly _editors: ICustomEditorDescriptor[] = [];
	private readonly _pendingResolvers = new Map<string, (html: string) => void>();
	private _activeId: string | undefined;

	public openEditor(uri: URI | string, viewType: string): ICustomEditorDescriptor {
		const resolved = typeof uri === 'string' ? URI.parse(uri) : uri;
		const id = `${viewType}:${resolved.toString()}`;
		let editor = this._editors.find(candidate => candidate.id === id);
		if (!editor) {
			editor = { id, uri: resolved, viewType, title: viewType };
			this._editors.push(editor);
		}
		this._activeId = editor.id;
		return editor;
	}

	public getActiveEditor(): ICustomEditorDescriptor | undefined {
		return this._editors.find(editor => editor.id === this._activeId);
	}

	public closeEditor(editor: ICustomEditorDescriptor): void {
		const index = this._editors.indexOf(editor);
		if (index !== -1) {
			this._editors.splice(index, 1);
		}
		this._pendingResolvers.delete(editor.id);
		editor.iframe?.remove();
		if (this._activeId === editor.id) {
			this._activeId = undefined;
		}
	}

	public resolveCustomEditor(options: IResolveCustomEditorOptions): { iframe: HTMLIFrameElement; resolve: (html: string) => void } {
		const editor = this.openEditor(options.uri, options.viewType);
		editor.title = options.title;
		const iframe = document.createElement('iframe');
		iframe.style.border = 'none';
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-same-origin');
		editor.iframe = iframe;
		const resolve = (html: string): void => {
			iframe.srcdoc = html;
			this._pendingResolvers.delete(editor.id);
		};
		this._pendingResolvers.set(editor.id, resolve);
		return { iframe, resolve };
	}

	public override dispose(): void {
		for (const editor of this._editors) {
			editor.iframe?.remove();
		}
		this._editors.length = 0;
		this._pendingResolvers.clear();
		this._activeId = undefined;
		super.dispose();
	}
}
