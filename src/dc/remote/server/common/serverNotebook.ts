import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerNotebookCell {
	readonly handle: number;
	readonly kind: 'code' | 'markup';
	readonly language: string;
	readonly value: string;
	readonly outputs: IServerNotebookCellOutput[];
	readonly metadata?: Record<string, any>;
}

export interface IServerNotebookCellOutput {
	readonly outputId: string;
	readonly items: { readonly mime: string; readonly data: Uint8Array }[];
}

export interface IServerNotebookDocument {
	readonly uri: string;
	readonly notebookType: string;
	readonly cells: IServerNotebookCell[];
	readonly metadata?: Record<string, any>;
	readonly isDirty: boolean;
	readonly version: number;
}

export interface IServerNotebookKernel {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly supportedLanguages?: string[];
	executeNotebookCellsRequest(uri: string, cellHandles: number[]): Promise<void>;
	cancelNotebookCellExecution(uri: string, cellHandles: number[]): Promise<void>;
}

export interface IServerNotebookService {
	readonly onDidOpenNotebook: Event<IServerNotebookDocument>;
	readonly onDidCloseNotebook: Event<string>;
	readonly onDidChangeCells: Event<{ uri: string; changes: any[] }>;
	readonly onDidChangeKernel: Event<{ uri: string; kernelId: string }>;
	openNotebook(uri: string, notebookType: string): Promise<IServerNotebookDocument>;
	closeNotebook(uri: string): void;
	getNotebook(uri: string): IServerNotebookDocument | undefined;
	getNotebooks(): IServerNotebookDocument[];
	addCell(uri: string, index: number, kind: 'code' | 'markup', language: string, value: string): void;
	removeCell(uri: string, index: number): void;
	editCell(uri: string, cellHandle: number, newValue: string): void;
	executeCells(uri: string, cellHandles: number[]): Promise<void>;
	cancelExecution(uri: string, cellHandles: number[]): void;
	registerKernel(kernel: IServerNotebookKernel): IDisposable;
	getKernels(notebookType?: string): IServerNotebookKernel[];
	setActiveKernel(uri: string, kernelId: string): void;
}

export class ServerNotebookCommon implements IServerNotebookService {
	private readonly _notebooks = new Map<string, IServerNotebookDocument>();
	private readonly _kernels = new Map<string, IServerNotebookKernel>();
	private readonly _activeKernels = new Map<string, string>();
	private _nextCellHandle = 1;

	private readonly _onDidOpenNotebook = new Emitter<IServerNotebookDocument>();
	readonly onDidOpenNotebook: Event<IServerNotebookDocument> = this._onDidOpenNotebook.event;

	private readonly _onDidCloseNotebook = new Emitter<string>();
	readonly onDidCloseNotebook: Event<string> = this._onDidCloseNotebook.event;

	private readonly _onDidChangeCells = new Emitter<{ uri: string; changes: any[] }>();
	readonly onDidChangeCells: Event<{ uri: string; changes: any[] }> = this._onDidChangeCells.event;

	private readonly _onDidChangeKernel = new Emitter<{ uri: string; kernelId: string }>();
	readonly onDidChangeKernel: Event<{ uri: string; kernelId: string }> = this._onDidChangeKernel.event;

	async openNotebook(uri: string, notebookType: string): Promise<IServerNotebookDocument> {
		const doc: IServerNotebookDocument = { uri, notebookType, cells: [], isDirty: false, version: 1 };
		this._notebooks.set(uri, doc);
		this._onDidOpenNotebook.fire(doc);
		return doc;
	}

	closeNotebook(uri: string): void {
		this._notebooks.delete(uri);
		this._activeKernels.delete(uri);
		this._onDidCloseNotebook.fire(uri);
	}

	getNotebook(uri: string): IServerNotebookDocument | undefined {
		return this._notebooks.get(uri);
	}

	getNotebooks(): IServerNotebookDocument[] {
		return Array.from(this._notebooks.values());
	}

	addCell(uri: string, index: number, kind: 'code' | 'markup', language: string, value: string): void {
		const doc = this._notebooks.get(uri);
		if (doc) {
			const cell: IServerNotebookCell = { handle: this._nextCellHandle++, kind, language, value, outputs: [] };
			(doc.cells as IServerNotebookCell[]).splice(index, 0, cell);
			this._onDidChangeCells.fire({ uri, changes: [{ type: 'insert', index, cell }] });
		}
	}

	removeCell(uri: string, index: number): void {
		const doc = this._notebooks.get(uri);
		if (doc && index >= 0 && index < doc.cells.length) {
			(doc.cells as IServerNotebookCell[]).splice(index, 1);
			this._onDidChangeCells.fire({ uri, changes: [{ type: 'remove', index }] });
		}
	}

	editCell(uri: string, cellHandle: number, newValue: string): void {
		const doc = this._notebooks.get(uri);
		if (doc) {
			const cell = doc.cells.find(c => c.handle === cellHandle);
			if (cell) {
				(cell as any).value = newValue;
				this._onDidChangeCells.fire({ uri, changes: [{ type: 'edit', handle: cellHandle }] });
			}
		}
	}

	async executeCells(uri: string, cellHandles: number[]): Promise<void> {
		const kernelId = this._activeKernels.get(uri);
		const kernel = kernelId ? this._kernels.get(kernelId) : undefined;
		if (kernel) {
			await kernel.executeNotebookCellsRequest(uri, cellHandles);
		}
	}

	cancelExecution(uri: string, cellHandles: number[]): void {
		const kernelId = this._activeKernels.get(uri);
		const kernel = kernelId ? this._kernels.get(kernelId) : undefined;
		if (kernel) {
			kernel.cancelNotebookCellExecution(uri, cellHandles);
		}
	}

	registerKernel(kernel: IServerNotebookKernel): IDisposable {
		this._kernels.set(kernel.id, kernel);
		return { dispose: () => { this._kernels.delete(kernel.id); } };
	}

	getKernels(_notebookType?: string): IServerNotebookKernel[] {
		return Array.from(this._kernels.values());
	}

	setActiveKernel(uri: string, kernelId: string): void {
		this._activeKernels.set(uri, kernelId);
		this._onDidChangeKernel.fire({ uri, kernelId });
	}
}
