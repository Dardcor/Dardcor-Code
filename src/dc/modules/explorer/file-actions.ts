/**
 * Dardcor Code - File Explorer Context Actions
 */

import { IFileService, IFileSystemProvider } from '../../services/files/file-service';
import { FileTreeModel, FileTreeNode, IFileTreeElement } from './file-tree-model';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';
import { DataBuffer } from '../../core/binary/buffer';
import { layoutContextMenu, getAnchorFromMouseEvent } from '../../core/dom/context-menu';
import { addDisposableListener } from '../../core/dom/element';
import { toDisposable, IDisposable } from '../../core/lifecycle/disposable';
import { isWindows, isMacintosh } from '../../core/environment/platform';

declare const require: any;

export interface IDiskLikeProvider {
	mkdir(resource: URI): Promise<void>;
	delete(resource: URI, options?: { recursive?: boolean }): Promise<void>;
	rename(from: URI, to: URI, options?: { overwrite?: boolean }): Promise<void>;
}

export interface IFileActionContext {
	model: FileTreeModel;
	fileService: IFileService;
	provider: IDiskLikeProvider;
}

export interface IFileActionCallbacks {
	onDidChange?: () => void;
	onDidError?: (message: string) => void;
}

function getDiskProvider(fileService: IFileService): IDiskLikeProvider {
	const provider = fileService.getProvider('file');
	if (!provider) {
		throw new Error('File provider tidak tersedia');
	}
	return provider as unknown as IDiskLikeProvider;
}

function parentDirectoryUri(resource: URI): URI {
	const dir = Path.dirname(resource.path);
	return URI.from({ scheme: resource.scheme, authority: resource.authority, path: dir });
}

export namespace FileActions {
	export function createContext(ctx: IFileActionContext): IFileActionContext {
		return { model: ctx.model, fileService: ctx.fileService, provider: ctx.provider };
	}

	export async function newFile(ctx: IFileActionContext, parent: FileTreeNode, name: string): Promise<URI> {
		const uri = URI.from({ scheme: parent.resource.scheme, authority: parent.resource.authority, path: Path.join(parent.resource.path, name) });
		await ctx.fileService.writeFile(uri, DataBuffer.wrap(new Uint8Array(0)));
		await ctx.model.refreshNode(parent);
		return uri;
	}

	export async function newFolder(ctx: IFileActionContext, parent: FileTreeNode, name: string): Promise<URI> {
		const uri = URI.from({ scheme: parent.resource.scheme, authority: parent.resource.authority, path: Path.join(parent.resource.path, name) });
		await ctx.provider.mkdir(uri);
		await ctx.model.refreshNode(parent);
		return uri;
	}

	export async function deleteNode(ctx: IFileActionContext, node: FileTreeNode, recursive = true): Promise<void> {
		await ctx.provider.delete(node.resource, { recursive });
		ctx.model.deleteNode(node);
	}

	export async function renameNode(ctx: IFileActionContext, node: FileTreeNode, newName: string): Promise<URI> {
		if (!node.parent) {
			throw new Error('Root tidak bisa di-rename');
		}
		const target = URI.from({
			scheme: node.resource.scheme,
			authority: node.resource.authority,
			path: Path.join(Path.dirname(node.resource.path), newName)
		});
		await ctx.provider.rename(node.resource, target, { overwrite: false });
		await ctx.model.refreshNode(node.parent);
		return target;
	}

	export async function revealInOS(resource: URI): Promise<void> {
		const cp = require('node:child_process');
		const fsPath = resource.path.replace(/^\//, '');
		if (isWindows) {
			cp.spawn('explorer.exe', ['/select,', fsPath], { detached: true, stdio: 'ignore' }).unref();
		} else if (isMacintosh) {
			cp.spawn('open', ['-R', fsPath], { detached: true, stdio: 'ignore' }).unref();
		} else {
			cp.spawn('xdg-open', [Path.dirname(fsPath)], { detached: true, stdio: 'ignore' }).unref();
		}
	}
}

export interface IContextMenuItem {
	label: string;
	enabled?: boolean;
	onClick: () => void;
	separatorBefore?: boolean;
}

export class FileContextMenu {
	private _menuElement: HTMLElement | undefined;
	private _disposables: IDisposable[] = [];

	constructor(private readonly _callbacks?: IFileActionCallbacks) {}

	public show(e: MouseEvent, items: IContextMenuItem[]): void {
		this.hide();
		const menu = document.createElement('div');
		menu.className = 'dc-context-menu';
		menu.style.position = 'fixed';
		menu.style.zIndex = '10000';
		menu.style.background = '#252526';
		menu.style.border = '1px solid #454545';
		menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
		menu.style.padding = '4px 0';
		menu.style.minWidth = '200px';

		for (const item of items) {
			if (item.separatorBefore) {
				const sep = document.createElement('div');
				sep.style.height = '1px';
				sep.style.background = '#454545';
				sep.style.margin = '4px 8px';
				menu.appendChild(sep);
			}
			const entry = document.createElement('div');
			entry.textContent = item.label;
			entry.style.padding = '4px 12px';
			entry.style.fontSize = '13px';
			entry.style.color = item.enabled === false ? '#6a6a6a' : '#cccccc';
			entry.style.cursor = item.enabled === false ? 'default' : 'pointer';
			if (item.enabled !== false) {
				entry.addEventListener('mouseenter', () => {
					entry.style.background = '#2a2d2e';
				});
				entry.addEventListener('mouseleave', () => {
					entry.style.background = 'transparent';
				});
				entry.addEventListener('click', () => {
					this.hide();
					try {
						item.onClick();
					} catch (err) {
						this._callbacks?.onDidError?.(String(err));
					}
				});
			}
			menu.appendChild(entry);
		}

		const layout = layoutContextMenu(getAnchorFromMouseEvent(e), 200, items.length * 26 + 8, window.innerWidth, window.innerHeight);
		menu.style.left = `${layout.left}px`;
		menu.style.top = `${layout.top}px`;
		document.body.appendChild(menu);
		this._menuElement = menu;

		this._disposables.push(addDisposableListener(window, 'mousedown', (ev: Event) => {
			const target = ev.target as Node;
			if (menu.contains(target)) {
				return;
			}
			this.hide();
		}, true));
		this._disposables.push(addDisposableListener(window, 'blur', () => this.hide()));
	}

	public hide(): void {
		if (this._menuElement) {
			this._menuElement.remove();
			this._menuElement = undefined;
		}
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables = [];
	}

	public dispose(): void {
		this.hide();
		toDisposable(() => {});
	}
}
