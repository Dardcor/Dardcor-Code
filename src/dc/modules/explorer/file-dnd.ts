/**
 * Dardcor Code - File Tree Drag & Drop Move Controller
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';
import { addDisposableListener } from '../../core/dom/element';
import { setupDragAndDrop } from '../../core/dom/drag-and-drop';
import { FileTreeModel, FileTreeNode } from './file-tree-model';
import { IDiskLikeProvider } from './file-actions';
import { IFileService } from '../../services/files/file-service';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';

export type FileDropMode = 'into' | 'before' | 'after';

export interface IFileDropEvent {
	readonly source: URI;
	readonly target: FileTreeNode;
	readonly mode: FileDropMode;
}

export class FileDragAndDropController extends Disposable {
	private readonly _dropIndicator: HTMLElement;
	private _draggedResource: URI | undefined;
	private _dragOverNode: FileTreeNode | undefined;
	private _dropMode: FileDropMode = 'into';

	private readonly _onDidDrop = this._register(new Emitter<IFileDropEvent>());
	private readonly _onDidError = this._register(new Emitter<string>());

	readonly onDidDrop = this._onDidDrop.event;
	readonly onDidError = this._onDidError.event;

	constructor(
		private readonly _container: HTMLElement,
		private readonly _model: FileTreeModel,
		private readonly _fileService: IFileService
	) {
		super();
		this._dropIndicator = document.createElement('div');
		this._dropIndicator.className = 'dc-drop-indicator';
		this._dropIndicator.style.position = 'absolute';
		this._dropIndicator.style.zIndex = '1000';
		this._dropIndicator.style.pointerEvents = 'none';
		this._dropIndicator.style.display = 'none';
		this._dropIndicator.style.height = '2px';
		this._dropIndicator.style.background = '#094771';
		this._container.style.position = 'relative';
		this._container.appendChild(this._dropIndicator);

		this._register(setupDragAndDrop(this._container, {
			onDragStart: e => this._onDragStart(e),
			onDragOver: e => this._onDragOver(e),
			onDragLeave: e => this._onDragLeave(e),
			onDrop: e => this._onDrop(e)
		}));
		this._register(addDisposableListener(this._container, 'dragend', () => this._clearDragState()));
	}

	private _getProvider(): IDiskLikeProvider {
		const provider = this._fileService.getProvider('file');
		if (!provider) {
			throw new Error('File provider tidak tersedia');
		}
		return provider as unknown as IDiskLikeProvider;
	}

	private _nodeFromEvent(e: DragEvent): FileTreeNode | undefined {
		const target = e.target as HTMLElement | null;
		const row = target?.closest?.('[data-dc-resource]') as HTMLElement | null;
		if (!row?.dataset['dcResource']) {
			return undefined;
		}
		return this._model.getNodeByPath(URI.parse(row.dataset['dcResource']).path);
	}

	private _onDragStart(e: DragEvent): void {
		const node = this._nodeFromEvent(e);
		if (!node || node === this._model.root) {
			e.preventDefault();
			return;
		}
		this._draggedResource = node.resource;
		e.dataTransfer?.setData('text/plain', node.resource.toString());
		e.dataTransfer!.effectAllowed = 'move';
		if (e.dataTransfer) {
			e.dataTransfer.setData('application/dc-file', node.resource.path);
		}
	}

	private _computeDropMode(e: DragEvent, node: FileTreeNode): FileDropMode {
		if (!node.isDirectory) {
			const rect = (e.target as HTMLElement).getBoundingClientRect();
			return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
		}
		if (node.collapsed) {
			return 'into';
		}
		const rect = (e.target as HTMLElement).getBoundingClientRect();
		if (e.clientY < rect.top + 6) {
			return 'before';
		}
		return 'into';
	}

	private _onDragOver(e: DragEvent): void {
		if (!this._draggedResource) {
			const external = e.dataTransfer?.types.includes('Files');
			if (!external) {
				return;
			}
		}
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';

		const node = this._nodeFromEvent(e);
		if (!node) {
			this._hideIndicator();
			this._dragOverNode = undefined;
			return;
		}
		const mode = this._computeDropMode(e, node);
		this._dragOverNode = node;
		this._dropMode = mode;
		this._showIndicator(node, mode);
	}

	private _showIndicator(node: FileTreeNode, mode: FileDropMode): void {
		const row = this._container.querySelector<HTMLElement>(`[data-dc-resource="${CSS.escape(node.resource.toString())}"]`);
		if (!row) {
			this._hideIndicator();
			return;
		}
		this._dropIndicator.style.display = 'block';
		const rect = row.getBoundingClientRect();
		const containerRect = this._container.getBoundingClientRect();
		const top = mode === 'before' ? rect.top - containerRect.top : mode === 'after' ? rect.bottom - containerRect.top : rect.top - containerRect.top + rect.height / 2;
		this._dropIndicator.style.left = `${rect.left - containerRect.left + 18}px`;
		this._dropIndicator.style.width = `${rect.width - 18}px`;
		this._dropIndicator.style.top = `${top}px`;
	}

	private _hideIndicator(): void {
		this._dropIndicator.style.display = 'none';
	}

	private _onDragLeave(e: DragEvent): void {
		if (!this._container.contains(e.relatedTarget as Node)) {
			this._hideIndicator();
		}
	}

	private _isDescendant(ancestor: FileTreeNode, node: FileTreeNode | undefined): boolean {
		let current: FileTreeNode | undefined = node;
		while (current) {
			if (current === ancestor) {
				return true;
			}
			current = current.parent;
		}
		return false;
	}

	private async _onDrop(e: DragEvent): Promise<void> {
		e.preventDefault();
		this._hideIndicator();
		const source = this._draggedResource;
		const target = this._dragOverNode;
		const mode = this._dropMode;
		this._clearDragState();
		if (!source || !target) {
			return;
		}

		try {
			if (this._isDescendant(target, this._model.getNodeByPath(source.path))) {
				return;
			}

			let targetDir: FileTreeNode;
			if (mode === 'into' && target.isDirectory) {
				targetDir = target;
			} else {
				targetDir = target.parent ?? target;
			}

			const destination = URI.from({
				scheme: source.scheme,
				authority: source.authority,
				path: Path.join(targetDir.resource.path, Path.basename(source.path))
			});

			const provider = this._getProvider();
			await provider.rename(source, destination, { overwrite: true });
			await this._model.refreshNode(targetDir);
			this._onDidDrop.fire({ source, target: targetDir, mode });
		} catch (err) {
			this._onDidError.fire(String(err));
		}
	}

	private _clearDragState(): void {
		this._draggedResource = undefined;
		this._dragOverNode = undefined;
		this._hideIndicator();
	}
}
