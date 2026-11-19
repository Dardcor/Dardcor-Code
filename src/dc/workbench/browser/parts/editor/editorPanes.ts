/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IAction } from '../../../../base/common/actions.js';
import { Emitter } from '../../../../base/common/event.js';
import Severity from '../../../../base/common/severity.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { EditorExtensions, EditorInputCapabilities, IEditorOpenContext, IVisibleEditorPane, isEditorOpenError } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Dimension, show, hide, IDomNodePagePosition, isAncestor, getActiveElement, getWindowById, isEditableElement, $ } from '../../../../base/browser/dom.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, IEditorPaneDescriptor } from '../../editor.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { EditorPane } from './editorPane.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorProgressService, LongRunningOperation } from '../../../../platform/progress/common/progress.js';
import { IEditorGroupView, DEFAULT_EDITOR_MIN_DIMENSIONS, DEFAULT_EDITOR_MAX_DIMENSIONS, IInternalEditorOpenOptions } from './editor.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ErrorPlaceholderEditor, IErrorEditorPlaceholderOptions, WorkspaceTrustRequiredPlaceholderEditor } from './editorPlaceholder.js';
import { EditorOpenSource, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IDialogService, IPromptButton, IPromptCancelButton } from '../../../../platform/dialogs/common/dialogs.js';
import { IBoundarySashes } from '../../../../base/browser/ui/sash/sash.js';
import { IHostService } from '../../../services/host/browser/host.js';

export interface IOpenEditorResult {

	readonly pane?: EditorPane;

	readonly changed?: boolean;

	readonly error?: Error;

	readonly cancelled?: boolean;
}

export class EditorPanes extends Disposable {


	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidChangeSizeConstraints = this._register(new Emitter<{ width: number; height: number } | undefined>());
	readonly onDidChangeSizeConstraints = this._onDidChangeSizeConstraints.event;


	get minimumWidth() { return this._activeEditorPane?.minimumWidth ?? DEFAULT_EDITOR_MIN_DIMENSIONS.width; }
	get minimumHeight() { return this._activeEditorPane?.minimumHeight ?? DEFAULT_EDITOR_MIN_DIMENSIONS.height; }
	get maximumWidth() { return this._activeEditorPane?.maximumWidth ?? DEFAULT_EDITOR_MAX_DIMENSIONS.width; }
	get maximumHeight() { return this._activeEditorPane?.maximumHeight ?? DEFAULT_EDITOR_MAX_DIMENSIONS.height; }

	private _activeEditorPane: EditorPane | null = null;
	get activeEditorPane(): IVisibleEditorPane | null { return this._activeEditorPane as IVisibleEditorPane | null; }

	private readonly editorPanes: EditorPane[] = [];
	private readonly mapEditorPaneToPendingSetInput = new Map<EditorPane, Promise<void>>();

	private readonly activeEditorPaneDisposables = this._register(new DisposableStore());

	private pagePosition: IDomNodePagePosition | undefined;
	private boundarySashes: IBoundarySashes | undefined;

	private readonly editorOperation: LongRunningOperation;
	private readonly editorPanesRegistry = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);

	constructor(
		private readonly editorGroupParent: HTMLElement,
		private readonly editorPanesParent: HTMLElement,
		private readonly groupView: IEditorGroupView,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorProgressService editorProgressService: IEditorProgressService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustService: IWorkspaceTrustManagementService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHostService private readonly hostService: IHostService
	) {
		super();

		this.editorOperation = this._register(new LongRunningOperation(editorProgressService));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.workspaceTrustService.onDidChangeTrust(() => this.onDidChangeWorkspaceTrust()));
	}

	private onDidChangeWorkspaceTrust() {

		const editor = this._activeEditorPane?.input;
		const options = this._activeEditorPane?.options;
		if (editor?.hasCapability(EditorInputCapabilities.RequiresTrust)) {
			this.groupView.openEditor(editor, options);
		}
	}

	async openEditor(editor: EditorInput, options: IEditorOptions | undefined, internalOptions: IInternalEditorOpenOptions | undefined, context: IEditorOpenContext = Object.create(null)): Promise<IOpenEditorResult> {
		try {
			return await this.doOpenEditor(this.getEditorPaneDescriptor(editor), editor, options, internalOptions, context);
		} catch (error) {

			if (options?.ignoreError) {
				return { error };
			}


			return this.doShowError(error, editor, options, internalOptions, context);
		}
	}

	private async doShowError(error: Error, editor: EditorInput, options: IEditorOptions | undefined, internalOptions: IInternalEditorOpenOptions | undefined, context?: IEditorOpenContext): Promise<IOpenEditorResult> {

		this.logService.error(error);

		let errorHandled = false;
		if (options?.source === EditorOpenSource.USER && (!isEditorOpenError(error) || error.allowDialog)) {
			errorHandled = await this.doShowErrorDialog(error, editor);
		}

		if (errorHandled) {
			return { error };
		}

		const editorPlaceholderOptions: IErrorEditorPlaceholderOptions = { ...options };
		if (!isCancellationError(error)) {
			editorPlaceholderOptions.error = error;
		}

		return {
			...(await this.doOpenEditor(ErrorPlaceholderEditor.DESCRIPTOR, editor, editorPlaceholderOptions, internalOptions, context)),
			error
		};
	}

	private async doShowErrorDialog(error: Error, editor: EditorInput): Promise<boolean> {
		let severity = Severity.Error;
		let message: string | undefined = undefined;
		let detail: string | undefined = toErrorMessage(error);
		let errorActions: readonly IAction[] | undefined = undefined;

		if (isEditorOpenError(error)) {
			errorActions = error.actions;
			severity = error.forceSeverity ?? Severity.Error;
			if (error.forceMessage) {
				message = error.message;
				detail = undefined;
			}
		}

		if (!message) {
			message = localize('editorOpenErrorDialog', "Unable to open '{0}'", editor.getName());
		}

		const buttons: IPromptButton<IAction | undefined>[] = [];
		if (errorActions && errorActions.length > 0) {
			for (const errorAction of errorActions) {
				buttons.push({
					label: errorAction.label,
					run: () => errorAction
				});
			}
		} else {
			buttons.push({
				label: localize({ key: 'ok', comment: ['&& denotes a mnemonic'] }, "&&OK"),
				run: () => undefined
			});
		}

		let cancelButton: IPromptCancelButton<undefined> | undefined = undefined;
		if (buttons.length === 1) {
			cancelButton = {
				run: () => {
					errorHandled = true;

					return undefined;
				}
			};
		}

		let errorHandled = false;

		const { result } = await this.dialogService.prompt({
			type: severity,
			message,
			detail,
			buttons,
			cancelButton
		});

		if (result) {
			const errorActionResult = result.run();
			if (errorActionResult instanceof Promise) {
				errorActionResult.catch(error => this.dialogService.error(toErrorMessage(error)));
			}

			errorHandled = true;
		}

		return errorHandled;
	}

	private async doOpenEditor(descriptor: IEditorPaneDescriptor, editor: EditorInput, options: IEditorOptions | undefined, internalOptions: IInternalEditorOpenOptions | undefined, context: IEditorOpenContext = Object.create(null)): Promise<IOpenEditorResult> {

		const pane = this.doShowEditorPane(descriptor);

		const activeElement = getActiveElement();

		const { changed, cancelled } = await this.doSetInput(pane, editor, options, context);

		if (!cancelled) {
			const focus = !options?.preserveFocus;
			if (focus && this.shouldRestoreFocus(activeElement)) {
				pane.focus();
			} else if (!internalOptions?.preserveWindowOrder) {
				this.hostService.moveTop(getWindowById(this.groupView.windowId, true).window);
			}
		}

		return { pane, changed, cancelled };
	}

	private shouldRestoreFocus(expectedActiveElement: Element | null): boolean {
		if (!this.layoutService.isRestored()) {
			return true;
		}

		if (!expectedActiveElement) {
			return true;
		}

		const activeElement = getActiveElement();
		if (!activeElement || activeElement === expectedActiveElement.ownerDocument.body) {
			return true;
		}

		const same = expectedActiveElement === activeElement;
		if (same) {
			return true;
		}

		if (!isEditableElement(activeElement)) {


			return true;
		}

		if (isAncestor(activeElement, this.editorGroupParent)) {
			return true;
		}

		return false;
	}

	private getEditorPaneDescriptor(editor: EditorInput): IEditorPaneDescriptor {
		if (editor.hasCapability(EditorInputCapabilities.RequiresTrust) && !this.workspaceTrustService.isWorkspaceTrusted()) {
			return WorkspaceTrustRequiredPlaceholderEditor.DESCRIPTOR;
		}

		return assertReturnsDefined(this.editorPanesRegistry.getEditorPane(editor));
	}

	private doShowEditorPane(descriptor: IEditorPaneDescriptor): EditorPane {

		if (this._activeEditorPane && descriptor.describes(this._activeEditorPane)) {
			return this._activeEditorPane;
		}

		this.doHideActiveEditorPane();

		const editorPane = this.doCreateEditorPane(descriptor);

		this.doSetActiveEditorPane(editorPane);

		const container = assertReturnsDefined(editorPane.getContainer());
		this.editorPanesParent.appendChild(container);
		show(container);

		editorPane.setVisible(true);

		if (this.pagePosition) {
			editorPane.layout(new Dimension(this.pagePosition.width, this.pagePosition.height), { top: this.pagePosition.top, left: this.pagePosition.left });
		}

		if (this.boundarySashes) {
			editorPane.setBoundarySashes(this.boundarySashes);
		}

		return editorPane;
	}

	private doCreateEditorPane(descriptor: IEditorPaneDescriptor): EditorPane {

		const editorPane = this.doInstantiateEditorPane(descriptor);

		if (!editorPane.getContainer()) {
			const editorPaneContainer = $('.editor-instance');

			this.editorPanesParent.appendChild(editorPaneContainer);

			try {
				editorPane.create(editorPaneContainer);
			} catch (error) {


				editorPaneContainer.remove();
				hide(editorPaneContainer);

				throw error;
			}
		}

		return editorPane;
	}

	private doInstantiateEditorPane(descriptor: IEditorPaneDescriptor): EditorPane {

		const existingEditorPane = this.editorPanes.find(editorPane => descriptor.describes(editorPane));
		if (existingEditorPane) {
			return existingEditorPane;
		}

		const editorPane = this._register(descriptor.instantiate(this.instantiationService, this.groupView));
		this.editorPanes.push(editorPane);

		return editorPane;
	}

	private doSetActiveEditorPane(editorPane: EditorPane | null) {
		this._activeEditorPane = editorPane;

		this.activeEditorPaneDisposables.clear();

		if (editorPane) {
			this.activeEditorPaneDisposables.add(editorPane.onDidChangeSizeConstraints(e => this._onDidChangeSizeConstraints.fire(e)));
			this.activeEditorPaneDisposables.add(editorPane.onDidFocus(() => this._onDidFocus.fire()));
		}

		this._onDidChangeSizeConstraints.fire(undefined);
	}

	private async doSetInput(editorPane: EditorPane, editor: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext): Promise<{ changed: boolean; cancelled: boolean }> {

		let inputMatches = editorPane.input?.matches(editor);
		if (inputMatches && !options?.forceReload) {

			if (this.mapEditorPaneToPendingSetInput.has(editorPane)) {
				await this.mapEditorPaneToPendingSetInput.get(editorPane);
			}

			inputMatches = editorPane.input?.matches(editor);
			if (inputMatches) {
				editorPane.setOptions(options);
			}

			return { changed: false, cancelled: !inputMatches };
		}

		const operation = this.editorOperation.start(this.layoutService.isRestored() ? 800 : 3200);

		let cancelled = false;
		try {

			editorPane.clearInput();

			const pendingSetInput = editorPane.setInput(editor, options, context, operation.token);
			this.mapEditorPaneToPendingSetInput.set(editorPane, pendingSetInput);
			await pendingSetInput;

			if (!operation.isCurrent()) {
				cancelled = true;
			}
		} catch (error) {
			if (!operation.isCurrent()) {
				cancelled = true;
			} else {
				throw error;
			}
		} finally {
			if (operation.isCurrent()) {
				this.mapEditorPaneToPendingSetInput.delete(editorPane);
			}
			operation.stop();
		}

		return { changed: !inputMatches, cancelled };
	}

	private doHideActiveEditorPane(): void {
		if (!this._activeEditorPane) {
			return;
		}

		this.editorOperation.stop();

		this.safeRun(() => this._activeEditorPane?.clearInput());
		this.safeRun(() => this._activeEditorPane?.setVisible(false));

		this.mapEditorPaneToPendingSetInput.delete(this._activeEditorPane);

		const editorPaneContainer = this._activeEditorPane.getContainer();
		if (editorPaneContainer) {
			editorPaneContainer.remove();
			hide(editorPaneContainer);
		}

		this.doSetActiveEditorPane(null);
	}

	closeEditor(editor: EditorInput): void {
		if (this._activeEditorPane?.input && editor.matches(this._activeEditorPane.input)) {
			this.doHideActiveEditorPane();
		}
	}

	setVisible(visible: boolean): void {
		this.safeRun(() => this._activeEditorPane?.setVisible(visible));
	}

	layout(pagePosition: IDomNodePagePosition): void {
		this.pagePosition = pagePosition;

		this.safeRun(() => this._activeEditorPane?.layout(new Dimension(pagePosition.width, pagePosition.height), pagePosition));
	}

	setBoundarySashes(sashes: IBoundarySashes): void {
		this.boundarySashes = sashes;

		this.safeRun(() => this._activeEditorPane?.setBoundarySashes(sashes));
	}

	private safeRun(fn: () => void): void {


		try {
			fn();
		} catch (error) {
			this.logService.error(error);
		}
	}
}
