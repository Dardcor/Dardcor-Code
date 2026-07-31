import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { addDisposableListener } from '../../core/dom/element.js';

export interface IDroppedFileText {
	readonly name: string;
	readonly text: string;
}

export class DropIntoEditorController extends Disposable {
	private readonly _onDidDropFiles = this._register(new Emitter<File[]>());
	readonly onDidDropFiles: Event<File[]> = this._onDidDropFiles.event;

	private readonly _onDidDropText = this._register(new Emitter<string>());
	readonly onDidDropText: Event<string> = this._onDidDropText.event;

	private readonly _onDidDropFileTexts = this._register(new Emitter<IDroppedFileText[]>());
	readonly onDidDropFileTexts: Event<IDroppedFileText[]> = this._onDidDropFileTexts.event;

	constructor(
		container: HTMLElement,
		private readonly _onDropText?: (text: string) => void
	) {
		super();
		this._register(addDisposableListener(container, 'dragover', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			container.classList.add('dc-drop-active');
		}));
		this._register(addDisposableListener(container, 'dragleave', () => {
			container.classList.remove('dc-drop-active');
		}));
		this._register(addDisposableListener(container, 'drop', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			container.classList.remove('dc-drop-active');
			this._handleDrop(e.dataTransfer);
		}));
	}

	public isFileDrag(dataTransfer: DataTransfer | null): boolean {
		if (!dataTransfer) {
			return false;
		}
		return Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file');
	}

	private _handleDrop(dataTransfer: DataTransfer | null): void {
		if (!dataTransfer) {
			return;
		}
		const files = Array.from(dataTransfer.files ?? []);
		if (files.length > 0) {
			this._onDidDropFiles.fire(files);
			this._readFiles(files);
			return;
		}
		const text = dataTransfer.getData('text/plain');
		if (text) {
			this._onDidDropText.fire(text);
			this._onDropText?.(text);
		}
	}

	private _readFiles(files: File[]): void {
		const results: IDroppedFileText[] = [];
		let pending = 0;
		const complete = () => {
			pending--;
			if (pending === 0) {
				this._onDidDropFileTexts.fire(results);
			}
		};
		for (const file of files) {
			pending++;
			const reader = new FileReader();
			reader.onload = () => {
				const text = typeof reader.result === 'string' ? reader.result : '';
				results.push({ name: file.name, text });
				this._onDropText?.(text);
				this._onDidDropText.fire(text);
				complete();
			};
			reader.onerror = () => complete();
			reader.readAsText(file);
		}
	}
}
