/**
 * Dardcor Code - dc.notebooks API Bridge (Task 624)
 * Mirrors: vs/workbench/api/common/extHostNotebook.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { CancellationToken } from '../../core/async/cancellation.js';
import { URI } from '../../core/types/uri.js';

export enum NotebookCellKind {
	Markup = 1,
	Code = 2
}

export interface NotebookCellOutputItem {
	readonly mime: string;
	readonly data: Uint8Array;
}

export interface NotebookCellOutput {
	readonly id?: string;
	readonly items: NotebookCellOutputItem[];
	readonly metadata?: Record<string, unknown>;
}

export interface NotebookCellData {
	kind: NotebookCellKind;
	value: string;
	languageId: string;
	mime?: string;
	outputs?: NotebookCellOutput[];
	metadata?: Record<string, unknown>;
	executionSummary?: { executionOrder?: number; success?: boolean };
}

export class NotebookData {
	constructor(
		public readonly cells: NotebookCellData[],
		public readonly metadata?: Record<string, unknown>
	) {}

	public toJSON(): any {
		return {
			cells: this.cells.map(cell => ({
				kind: cell.kind,
				value: cell.value,
				languageId: cell.languageId,
				mime: cell.mime,
				outputs: (cell.outputs ?? []).map(o => ({
					id: o.id,
					items: (o.items ?? []).map(i => ({ mime: i.mime, data: Array.from(i.data) })),
					metadata: o.metadata
				})),
				metadata: cell.metadata,
				executionSummary: cell.executionSummary
			})),
			metadata: this.metadata
		};
	}
}

export interface NotebookCell {
	readonly index: number;
	readonly kind: NotebookCellKind;
	readonly text: string;
	readonly languageId: string;
	readonly outputs: NotebookCellOutput[];
	readonly metadata: Record<string, unknown> | undefined;
	readonly executionSummary: { executionOrder?: number; success?: boolean } | undefined;
}

export interface NotebookDocument {
	readonly uri: import('../../core/types/uri.js').URI;
	readonly notebookType: string;
	readonly version: number;
	readonly isDirty: boolean;
	readonly cellCount: number;
	cellAt(index: number): NotebookCell;
	getCells(): NotebookCell[];
}export interface NotebookSerializer {
	deserializeNotebook(content: Uint8Array, token: CancellationToken): NotebookData | Promise<NotebookData>;
	serializeNotebook?(data: NotebookData, token: CancellationToken): Uint8Array | Promise<Uint8Array>;
}

export interface NotebookControllerOptions {
	label: string;
	description?: string;
	detail?: string;
	supportsExecutionOrder?: boolean;
	supportsInterrupt?: boolean;
}

export interface NotebookCellExecution {
	start(startTime?: number): void;
	end(success: boolean | undefined, endTime?: number): void;
	clearOutput(): void;
	replaceOutput(output: NotebookCellOutput | NotebookCellOutput[]): void;
	replaceOutputItems(outputItems: NotebookCellOutputItem[], output: NotebookCellOutput): void;
	appendOutputItems(outputItems: NotebookCellOutputItem[], output: NotebookCellOutput): void;
}

export interface NotebookController {
	readonly id: string;
	readonly notebookType: string;
	label: string;
	description?: string;
	detail?: string;
	supportsExecutionOrder?: boolean;
	supportsInterrupt?: boolean;
	executeHandler?: (cells: NotebookCell[], notebook: NotebookDocument, controller: NotebookController) => void | Promise<void>;
	interruptHandler?: (notebook: NotebookDocument) => void | Promise<void>;
	readonly onDidReceiveMessage: Event<{ editor: unknown; message: any }>;
	createNotebookCellExecution(cell: NotebookCell): NotebookCellExecution;
	setStatusBarMessage(message: string | undefined): void;
	dispose(): void;
}

export interface INotebooksApi {
	registerNotebookSerializer(notebookType: string, serializer: NotebookSerializer, options?: { transientOutputs?: boolean; transientCellMetadata?: Record<string, boolean>; transientDocumentMetadata?: Record<string, boolean> }): IDisposable;
	createNotebookController(id: string, notebookType: string, options: NotebookControllerOptions | string): NotebookController;
}

/**
 * Notebook bridge. Serializers run here (content <-> NotebookData);
 * controllers are registered with the main notebook editor.
 */
export class ExtHostNotebooks extends Disposable {
	private _nextSerializerId = 1;
	private readonly _serializers = new Map<number, { notebookType: string; serializer: NotebookSerializer }>();
	private _nextControllerId = 1;
	private readonly _controllers = new Map<number, NotebookController>();

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public registerNotebookSerializer(notebookType: string, serializer: NotebookSerializer, _options?: { transientOutputs?: boolean; transientCellMetadata?: Record<string, boolean>; transientDocumentMetadata?: Record<string, boolean> }): IDisposable {
		const id = this._nextSerializerId++;
		this._serializers.set(id, { notebookType, serializer });
		this._rpc.notify('main', 'notebooks.registerSerializer', { id, notebookType });
		return toDisposable(() => this._serializers.delete(id));
	}

	public createNotebookController(id: string, notebookType: string, options: NotebookControllerOptions | string): NotebookController {
		const self = this;
		const normalized: NotebookControllerOptions = typeof options === 'string' ? { label: options } : options;
		const handle = this._nextControllerId++;
		let executionHandler: NotebookController['executeHandler'];
		let interruptHandler: NotebookController['interruptHandler'];
		const controller: NotebookController = {
			get id() {
				return id;
			},
			get notebookType() {
				return notebookType;
			},
			label: normalized.label,
			description: normalized.description,
			detail: normalized.detail,
			supportsExecutionOrder: normalized.supportsExecutionOrder ?? false,
			supportsInterrupt: normalized.supportsInterrupt ?? false,
			get executeHandler() {
				return executionHandler;
			},
			set executeHandler(handler: NotebookController['executeHandler']) {
				executionHandler = handler;
				self._rpc.notify('main', 'notebooks.controllerHandler', { handle, hasHandler: !!handler });
			},
			get interruptHandler() {
				return interruptHandler;
			},
			set interruptHandler(handler: NotebookController['interruptHandler']) {
				interruptHandler = handler;
			},
			onDidReceiveMessage: Event.None,
			createNotebookCellExecution: () => new NotebookCellExecutionImpl(controller, self._rpc),
			setStatusBarMessage: (message: string | undefined) => self._rpc.notify('main', 'notebooks.controllerStatusBar', { handle, message }),
			dispose: () => self._controllers.delete(handle)
		};
		this._controllers.set(handle, controller);
		this._rpc.notify('main', 'notebooks.createController', {
			handle,
			id,
			notebookType,
			label: normalized.label,
			description: normalized.description,
			detail: normalized.detail
		});
		return controller;
	}

	public get api(): INotebooksApi {
		return {
			registerNotebookSerializer: (notebookType: string, serializer: NotebookSerializer, options?: { transientOutputs?: boolean; transientCellMetadata?: Record<string, boolean>; transientDocumentMetadata?: Record<string, boolean> }) =>
				this.registerNotebookSerializer(notebookType, serializer, options),
			createNotebookController: (id: string, notebookType: string, options: NotebookControllerOptions | string) =>
				this.createNotebookController(id, notebookType, options)
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$deserialize': {
						const registration = this._serializers.get(payload.handle);
						if (!registration) {
							throw new Error(`Serializer notebook tidak dikenal: ${payload.handle}`);
						}
						return Promise.resolve(registration.serializer.deserializeNotebook(new Uint8Array(payload.content), CancellationToken.None))
							.then(data => data instanceof NotebookData ? data : new NotebookData((data as any).cells, (data as any).metadata))
							.then(data => data.toJSON());
					}
					case '$serialize': {
						const registration = this._serializers.get(payload.handle);
						if (!registration?.serializer.serializeNotebook) {
							return Array.from(new Uint8Array(0));
						}
						const data = new NotebookData(
							(payload.data.cells as any[]).map((c: any) => ({
								kind: c.kind,
								value: c.value,
								languageId: c.languageId,
								outputs: (c.outputs ?? []).map((o: any) => ({ id: o.id, items: (o.items ?? []).map((i: any) => ({ mime: i.mime, data: new Uint8Array(i.data) })), metadata: o.metadata })),
								metadata: c.metadata
							})),
							payload.data.metadata
						);
						return Promise.resolve(registration.serializer.serializeNotebook(data, CancellationToken.None)).then(bytes => Array.from(bytes));
					}
					case '$executeController': {
						const controller = this._controllers.get(payload.handle);
						if (!controller?.executeHandler) {
							throw new Error(`Controller notebook tidak dikenal: ${payload.handle}`);
						}
						const cells = (payload.cells as any[]).map((c: any, index: number) => ({
							index,
							kind: c.kind,
							text: c.value,
							languageId: c.languageId,
							outputs: (c.outputs ?? []) as NotebookCellOutput[],
							metadata: c.metadata,
							executionSummary: c.executionSummary
						}));
						const notebook = {
							uri: URI.parse(payload.uri),
							notebookType: payload.notebookType,
							version: 1,
							isDirty: false,
							cellCount: cells.length,
							cellAt: (index: number) => cells[index],
							getCells: () => cells
						} as NotebookDocument;
						return Promise.resolve(controller.executeHandler(cells, notebook, controller)).then(() => undefined);
					}
					default:
						throw new Error(`Perintah notebooks tidak dikenal: ${command}`);
				}
			}
		};
	}
}

class NotebookCellExecutionImpl implements NotebookCellExecution {
	constructor(
		private readonly _controller: NotebookController,
		private readonly _rpc: RPCProtocol
	) {}

	public start(_startTime?: number): void {
		this._rpc.notify('main', 'notebooks.cellExecutionStart', { controllerId: this._controller.id });
	}

	public end(success: boolean | undefined, _endTime?: number): void {
		this._rpc.notify('main', 'notebooks.cellExecutionEnd', { controllerId: this._controller.id, success });
	}

	public clearOutput(): void {
		this._rpc.notify('main', 'notebooks.cellExecutionClear', { controllerId: this._controller.id });
	}

	public replaceOutput(output: NotebookCellOutput | NotebookCellOutput[]): void {
		this._rpc.notify('main', 'notebooks.cellExecutionOutput', { controllerId: this._controller.id, outputs: Array.isArray(output) ? output : [output] });
	}

	public replaceOutputItems(outputItems: NotebookCellOutputItem[], output: NotebookCellOutput): void {
		this._rpc.notify('main', 'notebooks.cellExecutionOutputItems', { controllerId: this._controller.id, outputId: output.id, items: outputItems });
	}

	public appendOutputItems(outputItems: NotebookCellOutputItem[], output: NotebookCellOutput): void {
		this._rpc.notify('main', 'notebooks.cellExecutionOutputItemsAppend', { controllerId: this._controller.id, outputId: output.id, items: outputItems });
	}
}
