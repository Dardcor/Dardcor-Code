/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IHostService, IToastOptions, IToastResult } from './host.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWindowSettings, IWindowOpenable, IOpenWindowOptions, isFolderToOpen, isWorkspaceToOpen, isFileToOpen, IOpenEmptyWindowOptions, IPathData, IFileToOpen, IOpenedMainWindow, IOpenedAuxiliaryWindow } from '../../../../platform/window/common/window.js';
import { isResourceEditorInput, pathsToEditors } from '../../../common/editor.js';
import { whenEditorClosed } from '../../../browser/editor.js';
import { IWorkspace, IWorkspaceProvider } from '../../../browser/web.api.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { EventType, ModifierKeyEmitter, addDisposableListener, addDisposableThrottledListener, detectFullscreen, disposableWindowInterval, getActiveDocument, getActiveWindow, getWindowId, onDidRegisterWindow, trackFocus, getWindows as getDOMWindows } from '../../../../base/browser/dom.js';
import { Disposable, DisposableSet, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IBrowserWorkbenchEnvironmentService } from '../../environment/browser/environmentService.js';
import { memoize } from '../../../../base/common/decorators.js';
import { parseLineAndColumnAware } from '../../../../base/common/extpath.js';
import { IWorkspaceFolderCreationData } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkspaceEditingService } from '../../workspaces/common/workspaceEditing.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILifecycleService, BeforeShutdownEvent, ShutdownReason } from '../../lifecycle/common/lifecycle.js';
import { BrowserLifecycleService } from '../../lifecycle/browser/lifecycleService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { getWorkspaceIdentifier } from '../../../../platform/workspaces/common/workspaceIdentifier.js';
import { localize } from '../../../../nls.js';
import Severity from '../../../../base/common/severity.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { DomEmitter } from '../../../../base/browser/event.js';
import { isUndefined } from '../../../../base/common/types.js';
import { isTemporaryWorkspace, IWorkspaceContextService, toWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Schemas } from '../../../../base/common/network.js';
import { ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { mainWindow, isAuxiliaryWindow } from '../../../../base/browser/window.js';
import { isIOS, isMacintosh } from '../../../../base/common/platform.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { showBrowserToast } from './toasts.js';

enum HostShutdownReason {

	Unknown = 1,

	Keyboard = 2,

	Api = 3
}

export class BrowserHostService extends Disposable implements IHostService {

	declare readonly _serviceBrand: undefined;

	private workspaceProvider: IWorkspaceProvider;

	private shutdownReason = HostShutdownReason.Unknown;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IBrowserWorkbenchEnvironmentService private readonly environmentService: IBrowserWorkbenchEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILifecycleService private readonly lifecycleService: BrowserLifecycleService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService
	) {
		super();

		if (environmentService.options?.workspaceProvider) {
			this.workspaceProvider = environmentService.options.workspaceProvider;
		} else {
			this.workspaceProvider = new class implements IWorkspaceProvider {
				readonly workspace = undefined;
				readonly trusted = undefined;
				async open() { return true; }
			};
		}

		this.registerListeners();
	}


	private registerListeners(): void {

		this._register(this.lifecycleService.onBeforeShutdown(e => this.onBeforeShutdown(e)));

		this._register(ModifierKeyEmitter.getInstance().event(() => this.updateShutdownReasonFromEvent()));

		this._register(this.onDidChangeFocus(focus => {
			if (focus) {
				this.clearToasts();
			}
		}));
	}

	private onBeforeShutdown(e: BeforeShutdownEvent): void {

		switch (this.shutdownReason) {

			case HostShutdownReason.Unknown:
			case HostShutdownReason.Keyboard: {
				const confirmBeforeClose = this.configurationService.getValue('window.confirmBeforeClose');
				if (confirmBeforeClose === 'always' || (confirmBeforeClose === 'keyboardOnly' && this.shutdownReason === HostShutdownReason.Keyboard)) {
					e.veto(true, 'veto.confirmBeforeClose');
				}
				break;
			}
			case HostShutdownReason.Api:
				break;
		}

		this.shutdownReason = HostShutdownReason.Unknown;
	}

	private updateShutdownReasonFromEvent(): void {
		if (this.shutdownReason === HostShutdownReason.Api) {
			return;
		}

		if (ModifierKeyEmitter.getInstance().isModifierPressed) {
			this.shutdownReason = HostShutdownReason.Keyboard;
		} else {
			this.shutdownReason = HostShutdownReason.Unknown;
		}
	}


	@memoize
	get onDidChangeFocus(): Event<boolean> {
		const emitter = this._register(new Emitter<boolean>());

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			const focusTracker = disposables.add(trackFocus(window));
			const visibilityTracker = disposables.add(new DomEmitter(window.document, 'visibilitychange'));

			Event.any(
				Event.map(focusTracker.onDidFocus, () => this.hasFocus, disposables),
				Event.map(focusTracker.onDidBlur, () => this.hasFocus, disposables),
				Event.map(visibilityTracker.event, () => this.hasFocus, disposables),
				Event.map(this.onDidChangeActiveWindow, () => this.hasFocus, disposables),
			)(focus => emitter.fire(focus), undefined, disposables);
		}, { window: mainWindow, disposables: this._store }));

		return Event.latch(emitter.event, undefined, this._store);
	}

	get hasFocus(): boolean {
		return getActiveDocument().hasFocus();
	}

	async hadLastFocus(): Promise<boolean> {
		return true;
	}

	async focus(targetWindow: Window): Promise<void> {
		targetWindow.focus();
	}




	@memoize
	get onDidChangeActiveWindow(): Event<number> {
		const emitter = this._register(new Emitter<number>());

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			const windowId = getWindowId(window);

			const focusTracker = disposables.add(trackFocus(window));
			disposables.add(focusTracker.onDidFocus(() => emitter.fire(windowId)));

			if (isAuxiliaryWindow(window)) {
				disposables.add(disposableWindowInterval(window, () => {
					const hasFocus = window.document.hasFocus();
					if (hasFocus) {
						emitter.fire(windowId);
					}

					return hasFocus;
				}, 100, 20));
			}
		}, { window: mainWindow, disposables: this._store }));

		return Event.latch(emitter.event, undefined, this._store);
	}

	@memoize
	get onDidChangeFullScreen(): Event<{ windowId: number; fullscreen: boolean }> {
		const emitter = this._register(new Emitter<{ windowId: number; fullscreen: boolean }>());

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			const windowId = getWindowId(window);
			const viewport = isIOS && window.visualViewport ? window.visualViewport : window ;

			for (const event of [EventType.FULLSCREEN_CHANGE, EventType.WK_FULLSCREEN_CHANGE]) {
				disposables.add(addDisposableListener(window.document, event, () => emitter.fire({ windowId, fullscreen: !!detectFullscreen(window) })));
			}

			disposables.add(addDisposableThrottledListener(viewport, EventType.RESIZE, () => emitter.fire({ windowId, fullscreen: !!detectFullscreen(window) }), undefined, isMacintosh ? 2000 : 800 ));
		}, { window: mainWindow, disposables: this._store }));

		return emitter.event;
	}

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		if (Array.isArray(arg1)) {
			return this.doOpenWindow(arg1, arg2);
		}

		return this.doOpenEmptyWindow(arg1);
	}

	private async doOpenWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void> {
		const payload = this.preservePayload(false , options);
		const fileOpenables: IFileToOpen[] = [];

		const foldersToAdd: IWorkspaceFolderCreationData[] = [];
		const foldersToRemove: URI[] = [];

		for (const openable of toOpen) {
			openable.label = openable.label || this.getRecentLabel(openable);

			if (isFolderToOpen(openable)) {
				if (options?.addMode) {
					foldersToAdd.push({ uri: openable.folderUri });
				} else if (options?.removeMode) {
					foldersToRemove.push(openable.folderUri);
				} else {
					this.doOpen({ folderUri: openable.folderUri }, { reuse: this.shouldReuse(options, false ), payload });
				}
			}

			else if (isWorkspaceToOpen(openable)) {
				this.doOpen({ workspaceUri: openable.workspaceUri }, { reuse: this.shouldReuse(options, false ), payload });
			}

			else if (isFileToOpen(openable)) {
				fileOpenables.push(openable);
			}
		}

		if (foldersToAdd.length > 0 || foldersToRemove.length > 0) {
			this.withServices(async accessor => {
				const workspaceEditingService: IWorkspaceEditingService = accessor.get(IWorkspaceEditingService);
				if (foldersToAdd.length > 0) {
					await workspaceEditingService.addFolders(foldersToAdd);
				}

				if (foldersToRemove.length > 0) {
					await workspaceEditingService.removeFolders(foldersToRemove);
				}
			});
		}

		if (fileOpenables.length > 0) {
			this.withServices(async accessor => {
				const editorService = accessor.get(IEditorService);

				if (options?.mergeMode && fileOpenables.length === 4) {
					const editors = coalesce(await pathsToEditors(fileOpenables, this.fileService, this.logService));
					if (editors.length !== 4 || !isResourceEditorInput(editors[0]) || !isResourceEditorInput(editors[1]) || !isResourceEditorInput(editors[2]) || !isResourceEditorInput(editors[3])) {
						return;
					}

					if (this.shouldReuse(options, true )) {
						editorService.openEditor({
							input1: { resource: editors[0].resource },
							input2: { resource: editors[1].resource },
							base: { resource: editors[2].resource },
							result: { resource: editors[3].resource },
							options: { pinned: true }
						});
					}

					else {
						const environment = new Map<string, string>();
						environment.set('mergeFile1', editors[0].resource.toString());
						environment.set('mergeFile2', editors[1].resource.toString());
						environment.set('mergeFileBase', editors[2].resource.toString());
						environment.set('mergeFileResult', editors[3].resource.toString());

						this.doOpen(undefined, { payload: Array.from(environment.entries()) });
					}
				}

				else if (options?.diffMode && fileOpenables.length === 2) {
					const editors = coalesce(await pathsToEditors(fileOpenables, this.fileService, this.logService));
					if (editors.length !== 2 || !isResourceEditorInput(editors[0]) || !isResourceEditorInput(editors[1])) {
						return;
					}

					if (this.shouldReuse(options, true )) {
						editorService.openEditor({
							original: { resource: editors[0].resource },
							modified: { resource: editors[1].resource },
							options: { pinned: true }
						});
					}

					else {
						const environment = new Map<string, string>();
						environment.set('diffFileSecondary', editors[0].resource.toString());
						environment.set('diffFilePrimary', editors[1].resource.toString());

						this.doOpen(undefined, { payload: Array.from(environment.entries()) });
					}
				}

				else {
					for (const openable of fileOpenables) {

						if (this.shouldReuse(options, true )) {
							let openables: IPathData<ITextEditorOptions>[] = [];

							if (options?.gotoLineMode) {
								const pathColumnAware = parseLineAndColumnAware(openable.fileUri.path);
								openables = [{
									fileUri: openable.fileUri.with({ path: pathColumnAware.path }),
									options: {
										selection: !isUndefined(pathColumnAware.line) ? { startLineNumber: pathColumnAware.line, startColumn: pathColumnAware.column || 1 } : undefined
									}
								}];
							} else {
								openables = [openable];
							}

							editorService.openEditors(coalesce(await pathsToEditors(openables, this.fileService, this.logService)), undefined, { validateTrust: true });
						}

						else {
							const environment = new Map<string, string>();
							environment.set('openFile', openable.fileUri.toString());

							if (options?.gotoLineMode) {
								environment.set('gotoLineMode', 'true');
							}

							this.doOpen(undefined, { payload: Array.from(environment.entries()) });
						}
					}
				}

				const waitMarkerFileURI = options?.waitMarkerFileURI;
				if (waitMarkerFileURI) {
					(async () => {

						const filesToWaitFor: URI[] = [];
						if (options.mergeMode) {
							filesToWaitFor.push(fileOpenables[3].fileUri );
						} else {
							filesToWaitFor.push(...fileOpenables.map(fileOpenable => fileOpenable.fileUri));
						}
						await this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, filesToWaitFor));

						await this.fileService.del(waitMarkerFileURI);
					})();
				}
			});
		}
	}

	private withServices(fn: (accessor: ServicesAccessor) => unknown): void {
		this.instantiationService.invokeFunction(accessor => fn(accessor));
	}

	private preservePayload(isEmptyWindow: boolean, options?: IOpenWindowOptions): Array<unknown> | undefined {

		const newPayload: Array<unknown> = [];
		if (!isEmptyWindow && this.environmentService.extensionDevelopmentLocationURI) {
			newPayload.push(['extensionDevelopmentPath', this.environmentService.extensionDevelopmentLocationURI.toString()]);

			if (this.environmentService.debugExtensionHost.debugId) {
				newPayload.push(['debugId', this.environmentService.debugExtensionHost.debugId]);
			}

			if (this.environmentService.debugExtensionHost.port) {
				newPayload.push(['inspect-brk-extensions', String(this.environmentService.debugExtensionHost.port)]);
			}
		}

		const newWindowProfile = options?.forceProfile
			? this.userDataProfilesService.profiles.find(profile => profile.name === options?.forceProfile)
			: undefined;
		if (newWindowProfile && !newWindowProfile.isDefault) {
			newPayload.push(['profile', newWindowProfile.name]);
		}

		return newPayload.length ? newPayload : undefined;
	}

	private getRecentLabel(openable: IWindowOpenable): string {
		if (isFolderToOpen(openable)) {
			return this.labelService.getWorkspaceLabel(openable.folderUri, { verbose: Verbosity.LONG });
		}

		if (isWorkspaceToOpen(openable)) {
			return this.labelService.getWorkspaceLabel(getWorkspaceIdentifier(openable.workspaceUri), { verbose: Verbosity.LONG });
		}

		return this.labelService.getUriLabel(openable.fileUri, { appendWorkspaceSuffix: true });
	}

	private shouldReuse(options: IOpenWindowOptions = Object.create(null), isFile: boolean): boolean {
		if (options.waitMarkerFileURI) {
			return true;
		}

		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
		const openInNewWindowConfig = isFile ? (windowConfig?.openFilesInNewWindow || 'off' ) : (windowConfig?.openFoldersInNewWindow || 'default' );

		let openInNewWindow = (options.preferNewWindow || !!options.forceNewWindow) && !options.forceReuseWindow;
		if (!options.forceNewWindow && !options.forceReuseWindow && (openInNewWindowConfig === 'on' || openInNewWindowConfig === 'off')) {
			openInNewWindow = (openInNewWindowConfig === 'on');
		}

		return !openInNewWindow;
	}

	private async doOpenEmptyWindow(options?: IOpenEmptyWindowOptions): Promise<void> {
		return this.doOpen(undefined, {
			reuse: options?.forceReuseWindow,
			payload: this.preservePayload(true , options)
		});
	}

	private async doOpen(workspace: IWorkspace, options?: { reuse?: boolean; payload?: object }): Promise<void> {

		if (workspace && isFolderToOpen(workspace) && workspace.folderUri.scheme === Schemas.file && isTemporaryWorkspace(this.contextService.getWorkspace())) {
			this.withServices(async accessor => {
				const workspaceEditingService: IWorkspaceEditingService = accessor.get(IWorkspaceEditingService);

				await workspaceEditingService.updateFolders(0, this.contextService.getWorkspace().folders.length, [{ uri: workspace.folderUri }]);
			});

			return;
		}

		if (options?.reuse) {
			await this.handleExpectedShutdown(ShutdownReason.LOAD);
		}

		const opened = await this.workspaceProvider.open(workspace, options);
		if (!opened) {
			await this.dialogService.prompt({
				type: Severity.Warning,
				message: workspace ?
					localize('unableToOpenExternalWorkspace', "The browser blocked opening a new tab or window for '{0}'. Press 'Retry' to try again.", this.getRecentLabel(workspace)) :
					localize('unableToOpenExternal', "The browser blocked opening a new tab or window. Press 'Retry' to try again."),
				custom: {
					markdownDetails: [{ markdown: new MarkdownString(localize('unableToOpenWindowDetail', "Please allow pop-ups for this website in your [browser settings]({0}).", 'https://www.dardcor-code.web.id/docs/troubleshooting/browser-popups'), true) }]
				},
				buttons: [
					{
						label: localize({ key: 'retry', comment: ['&& denotes a mnemonic'] }, "&&Retry"),
						run: () => this.workspaceProvider.open(workspace, options)
					}
				],
				cancelButton: true
			});
		}
	}

	async toggleFullScreen(targetWindow: Window): Promise<void> {
		const target = this.layoutService.getContainer(targetWindow);

		if (targetWindow.document.fullscreen !== undefined) {
			if (!targetWindow.document.fullscreen) {
				try {
					return await target.requestFullscreen();
				} catch (error) {
					this.logService.warn('toggleFullScreen(): requestFullscreen failed');
				}
			} else {
				try {
					return await targetWindow.document.exitFullscreen();
				} catch (error) {
					this.logService.warn('toggleFullScreen(): exitFullscreen failed');
				}
			}
		}


		interface WebkitDocument extends Document {
			webkitFullscreenElement: Element | null;
			webkitExitFullscreen(): Promise<void>;
			webkitIsFullScreen: boolean;
		}

		interface WebkitHTMLElement extends HTMLElement {
			webkitRequestFullscreen(): Promise<void>;
		}

		const webkitDocument = targetWindow.document as WebkitDocument;
		const webkitElement = target as WebkitHTMLElement;
		if (webkitDocument.webkitIsFullScreen !== undefined) {
			try {
				if (!webkitDocument.webkitIsFullScreen) {
					webkitElement.webkitRequestFullscreen();
				} else {
					webkitDocument.webkitExitFullscreen();
				}
			} catch {
				this.logService.warn('toggleFullScreen(): requestFullscreen/exitFullscreen failed');
			}
		}
	}

	async moveTop(targetWindow: Window): Promise<void> {
	}

	async setWindowDimmed(_targetWindow: Window, _dimmed: boolean): Promise<void> {
	}

	async getCursorScreenPoint(): Promise<undefined> {
		return undefined;
	}

	getWindows(options: { includeAuxiliaryWindows: true }): Promise<Array<IOpenedMainWindow | IOpenedAuxiliaryWindow>>;
	getWindows(options: { includeAuxiliaryWindows: false }): Promise<Array<IOpenedMainWindow>>;
	async getWindows(options: { includeAuxiliaryWindows: boolean }): Promise<Array<IOpenedMainWindow | IOpenedAuxiliaryWindow>> {
		const activeWindow = getActiveWindow();
		const activeWindowId = getWindowId(activeWindow);

		const result: Array<IOpenedMainWindow | IOpenedAuxiliaryWindow> = [{
			id: activeWindowId,
			title: activeWindow.document.title,
			workspace: toWorkspaceIdentifier(this.contextService.getWorkspace()),
			dirty: false
		}];

		if (options.includeAuxiliaryWindows) {
			for (const { window } of getDOMWindows()) {
				const windowId = getWindowId(window);
				if (windowId !== activeWindowId && isAuxiliaryWindow(window)) {
					result.push({
						id: windowId,
						title: window.document.title,
						parentId: activeWindowId
					});
				}
			}
		}

		return result;
	}



	async restart(): Promise<void> {
		this.reload();
	}

	async reload(): Promise<void> {
		await this.handleExpectedShutdown(ShutdownReason.RELOAD);

		mainWindow.location.reload();
	}

	async close(): Promise<void> {
		await this.handleExpectedShutdown(ShutdownReason.CLOSE);

		mainWindow.close();
	}

	async shutdown(): Promise<void> {
		return this.close();
	}

	async withExpectedShutdown<T>(expectedShutdownTask: () => Promise<T>): Promise<T> {
		const previousShutdownReason = this.shutdownReason;
		try {
			this.shutdownReason = HostShutdownReason.Api;
			return await expectedShutdownTask();
		} finally {
			this.shutdownReason = previousShutdownReason;
		}
	}

	private async handleExpectedShutdown(reason: ShutdownReason): Promise<void> {

		this.shutdownReason = HostShutdownReason.Api;

		return this.lifecycleService.withExpectedShutdown(reason);
	}



	async getScreenshot(): Promise<VSBuffer | undefined> {
		const store = new DisposableStore();

		const video = document.createElement('video');
		store.add(toDisposable(() => video.remove()));
		let stream: MediaStream | undefined;
		try {
			stream = await navigator.mediaDevices.getDisplayMedia({
				audio: false,
				video: true
			});

			video.srcObject = stream;
			video.play();

			await Promise.all([
				new Promise<void>(r => store.add(addDisposableListener(video, 'loadedmetadata', () => r()))),
				new Promise<void>(r => store.add(addDisposableListener(video, 'canplaythrough', () => r())))
			]);

			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				return undefined;
			}

			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

			const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95));
			if (!blob) {
				throw new Error('Failed to create blob from canvas');
			}

			const buf = await blob.bytes();
			return VSBuffer.wrap(buf);

		} catch (error) {
			console.error('Error taking screenshot:', error);
			return undefined;
		} finally {
			store.dispose();
			if (stream) {
				for (const track of stream.getTracks()) {
					track.stop();
				}
			}
		}
	}

	async getBrowserId(): Promise<string | undefined> {
		return undefined;
	}



	async getNativeWindowHandle(_windowId: number) {
		return undefined;
	}



	private readonly activeToasts = this._register(new DisposableSet());

	async showToast(options: IToastOptions, token: CancellationToken): Promise<IToastResult> {
		return showBrowserToast({
			onDidCreateToast: disposable => this.activeToasts.add(disposable),
			onDidDisposeToast: disposable => this.activeToasts.deleteAndDispose(disposable)
		}, options, token);
	}

	private async clearToasts(): Promise<void> {
		this.activeToasts.clearAndDisposeAll();
	}

}

registerSingleton(IHostService, BrowserHostService, InstantiationType.Delayed);
