/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, MarkdownString, StatusBarAlignment, StatusBarItem, ThemeColor, Uri, window, workspace } from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { DebugRecorderBookmark } from '../../../../platform/inlineEdits/common/debugRecorderBookmark';
import { ILogger, ILogService } from '../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { deserializeEdit, ISerializedEdit, LogEntry, serializeEdit } from '../../../../platform/workspaceRecorder/common/workspaceLog';
import { Disposable } from '../../../../util/dardcor/base/common/lifecycle';
import { DebugRecorder } from '../../node/debugRecorder';
import { filterLogForSensitiveFiles } from './inlineEditDebugComponent';
import { NesFeedbackSubmitter } from './nesFeedbackSubmitter';

export const dardcorNesCaptureMode = 'dardcorNesCaptureMode';

interface CaptureState {
	active: boolean;
	startBookmark: DebugRecorderBookmark;
	endBookmark?: DebugRecorderBookmark;
	startDocumentId: DocumentId;
	startTime: number;
	trigger: 'rejection' | 'manual';
	originalNesMetadata?: {
		requestUuid: string;
		providerInfo?: string;
		modelName?: string;
		endpointUrl?: string;
		suggestionText?: string;
		suggestionRange?: [number, number, number, number];
		documentPath?: string;
	};
}

export class ExpectedEditCaptureController extends Disposable {

	private static readonly CAPTURE_FOLDER = '.dardcor/nes-feedback';

	private _state: CaptureState | undefined;
	private _statusBarItem: StatusBarItem | undefined;
	private _statusBarAnimationInterval: ReturnType<typeof setInterval> | undefined;
	private readonly _feedbackSubmitter: NesFeedbackSubmitter;
	private readonly _logger: ILogger;

	constructor(
		private readonly _debugRecorder: DebugRecorder,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
	) {
		super();
		this._logger = this._logService.createSubLogger(['NES', 'Capture']);
		this._feedbackSubmitter = new NesFeedbackSubmitter(
			this._logService,
			this._authenticationService,
			this._fetcherService
		);
	}

	public get isEnabled(): boolean {
		return this._configurationService.getConfig(ConfigKey.TeamInternal.RecordExpectedEditEnabled) ?? false;
	}

	public get captureOnReject(): boolean {
		return this._configurationService.getConfig(ConfigKey.TeamInternal.RecordExpectedEditOnReject) ?? true;
	}

	public get isCaptureActive(): boolean {
		return this._state?.active ?? false;
	}

	public async startCapture(
		trigger: 'rejection' | 'manual',
		nesMetadata?: CaptureState['originalNesMetadata']
	): Promise<void> {
		if (!this.isEnabled) {
			this._logger.trace('Feature disabled, ignoring start request');
			return;
		}

		if (this._state?.active) {
			this._logger.trace('Capture already active, ignoring start request');
			return;
		}

		const editor = window.activeTextEditor;
		if (!editor) {
			this._logger.trace('No active editor, cannot start capture');
			return;
		}

		const startBookmark = this._debugRecorder.createBookmark();
		const documentId = DocumentId.create(editor.document.uri.toString());

		this._state = {
			active: true,
			startBookmark,
			startDocumentId: documentId,
			startTime: Date.now(),
			trigger,
			originalNesMetadata: nesMetadata
		};

		await commands.executeCommand('setContext', dardcorNesCaptureMode, true);

		this._createStatusBarItem();

		this._logger.info(`Started capture session: trigger=${trigger}, documentUri=${editor.document.uri.toString()}, hasMetadata=${!!nesMetadata}`);
	}

	public async confirmCapture(): Promise<void> {
		if (!this._state?.active) {
			this._logger.trace('No active capture to confirm');
			return;
		}

		try {
			const endBookmark = this._debugRecorder.createBookmark();
			this._state.endBookmark = endBookmark;

			const logUpToStart = this._debugRecorder.getRecentLog(this._state.startBookmark);
			const logUpToEnd = this._debugRecorder.getRecentLog(endBookmark);

			if (!logUpToStart || !logUpToEnd) {
				this._logger.warn('Failed to retrieve logs from debug recorder');
				await this.abortCapture();
				return;
			}

			const nextUserEdit = this._extractEditsBetweenBookmarks(
				logUpToStart,
				logUpToEnd,
				this._state.startDocumentId
			);

			const filteredLog = filterLogForSensitiveFiles(this._filterLogForNonInteractedDocuments(logUpToStart));
			const recording = {
				log: filteredLog,
				nextUserEdit: nextUserEdit
			};

			const noEditExpected = nextUserEdit?.edit && typeof nextUserEdit.edit === 'object' && '__marker__' in nextUserEdit.edit && nextUserEdit.edit.__marker__ === 'NO_EDIT_EXPECTED';
			await this._saveRecording(recording, this._state, noEditExpected);

			const durationMs = Date.now() - this._state.startTime;
			this._logger.info(`Capture confirmed and saved: durationMs=${durationMs}, hasEdit=${!noEditExpected}, noEditExpected=${noEditExpected}, trigger=${this._state.trigger}`);

			if (noEditExpected) {
				window.showInformationMessage('Captured: No edit expected (this is valid feedback!).');
			} else {
				window.showInformationMessage('Expected edit captured successfully!');
			}
		} catch (error) {
			this._logger.error(error instanceof Error ? error : String(error), 'Error confirming capture');
			window.showErrorMessage('Failed to save expected edit capture');
		} finally {
			await this.cleanup();
		}
	}

	public async abortCapture(): Promise<void> {
		if (!this._state?.active) {
			return;
		}

		this._logger.info('Capture aborted');
		await this.cleanup();
	}

	private async cleanup(): Promise<void> {
		this._state = undefined;
		await commands.executeCommand('setContext', dardcorNesCaptureMode, false);
		this._disposeStatusBarItem();
	}

	private _createStatusBarItem(): void {
		if (this._statusBarItem) {
			this._statusBarItem.dispose();
		}
		if (this._statusBarAnimationInterval) {
			clearInterval(this._statusBarAnimationInterval);
		}

		this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 10000);
		this._statusBarItem.backgroundColor = new ThemeColor('statusBarItem.errorBackground');

		const ctrlOrCmd = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
		const tooltip = new MarkdownString();
		tooltip.appendMarkdown('### 🔴 NES CAPTURE MODE ACTIVE\n\n');
		tooltip.appendMarkdown('Type your expected edit, then:\n\n');
		tooltip.appendMarkdown(`- **${ctrlOrCmd}+Enter** — Save your edits\n`);
		tooltip.appendMarkdown(`- **${ctrlOrCmd}+Enter (empty)** — No edit expected\n`);
		tooltip.appendMarkdown('- **Esc** — Cancel capture\n');
		tooltip.isTrusted = true;
		this._statusBarItem.tooltip = tooltip;

		const icons = ['$(record)', '$(alert)', '$(warning)', '$(zap)'];
		let iconIndex = 0;
		let isExpanded = false;

		const updateText = () => {
			if (!this._statusBarItem) {
				return;
			}
			const icon = icons[iconIndex];
			if (isExpanded) {
				this._statusBarItem.text = `${icon} NES CAPTURE MODE: ${ctrlOrCmd}+Enter=Save, Esc=Cancel ${icon}`;
			} else {
				this._statusBarItem.text = `${icon} NES CAPTURE MODE ACTIVE ${icon}`;
			}
			iconIndex = (iconIndex + 1) % icons.length;
			isExpanded = !isExpanded;
		};

		updateText();
		this._statusBarAnimationInterval = setInterval(updateText, 1000);

		this._statusBarItem.show();
	}

	private _disposeStatusBarItem(): void {
		if (this._statusBarAnimationInterval) {
			clearInterval(this._statusBarAnimationInterval);
			this._statusBarAnimationInterval = undefined;
		}
		if (this._statusBarItem) {
			this._statusBarItem.dispose();
			this._statusBarItem = undefined;
		}
	}

	private _extractEditsBetweenBookmarks(
		logBefore: LogEntry[],
		logAfter: LogEntry[],
		targetDocId: DocumentId
	): { relativePath: string; edit: ISerializedEdit | { __marker__: 'NO_EDIT_EXPECTED' } } | undefined {
		let docNumericId: number | undefined;
		let relativePath: string | undefined;

		for (const entry of logBefore) {
			if (entry.kind === 'documentEncountered') {
				const entryPath = entry.relativePath;
				if (entryPath && this._pathMatchesDocument(entryPath, targetDocId)) {
					docNumericId = entry.id;
					relativePath = entry.relativePath;
					break;
				}
			}
		}

		if (docNumericId === undefined || !relativePath) {
			this._logger.trace('Could not find document in log');
			return undefined;
		}

		const newEntries = logAfter.slice(logBefore.length);

		const editEntries = newEntries.filter(e =>
			e.kind === 'changed' && e.id === docNumericId
		);

		if (editEntries.length === 0) {
			this._logger.trace('No edits found between bookmarks - marking as NO_EDIT_EXPECTED');
			return {
				relativePath,
				edit: { __marker__: 'NO_EDIT_EXPECTED' as const }
			};
		}

		let composedEdit: ISerializedEdit = [];
		for (const entry of editEntries) {
			if (entry.kind === 'changed') {
				composedEdit = this._composeSerializedEdits(composedEdit, entry.edit);
			}
		}

		return {
			relativePath,
			edit: composedEdit
		};
	}

	private _pathMatchesDocument(logPath: string, documentId: DocumentId): boolean {
		const docPath = documentId.path;
		return logPath.endsWith(docPath) || docPath.endsWith(logPath);
	}

	private _composeSerializedEdits(
		first: ISerializedEdit,
		second: ISerializedEdit
	): ISerializedEdit {
		const firstEdit = deserializeEdit(first);
		const secondEdit = deserializeEdit(second);
		const composed = firstEdit.compose(secondEdit);
		return serializeEdit(composed);
	}

	private _filterLogForNonInteractedDocuments(log: LogEntry[]): LogEntry[] {
		const interactedDocIds = new Set<number>();

		for (const entry of log) {
			if (entry.kind === 'selectionChanged' ||
				entry.kind === 'changed') {
				if ('id' in entry && typeof entry.id === 'number') {
					interactedDocIds.add(entry.id);
				}
			}
		}

		const excludedDocIds = new Set<number>();
		for (const entry of log) {
			if (entry.kind === 'documentEncountered') {
				if (!interactedDocIds.has(entry.id)) {
					excludedDocIds.add(entry.id);
					this._logger.trace(`Filtering out background document: ${entry.relativePath}`);
				}
			}
		}

		return log.filter(entry => {
			if (entry.kind === 'header') {
				return true;
			}
			if ('id' in entry && typeof entry.id === 'number') {
				return !excludedDocIds.has(entry.id);
			}
			return true;
		});
	}

	private async _saveRecording(
		recording: { log: LogEntry[]; nextUserEdit?: { relativePath: string; edit: ISerializedEdit | { __marker__: 'NO_EDIT_EXPECTED' } } },
		state: CaptureState,
		noEditExpected: boolean = false
	): Promise<void> {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			throw new Error('No workspace folder found');
		}

		const folderUri = Uri.joinPath(workspaceFolder.uri, ExpectedEditCaptureController.CAPTURE_FOLDER);
		try {
			await workspace.fs.createDirectory(folderUri);
		} catch (error) {
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
		const filename = `capture-${timestamp}.recording.w.json`;
		const fileUri = Uri.joinPath(folderUri, filename);

		const content = JSON.stringify(recording, null, 2);
		await workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

		await this._saveMetadata(folderUri, filename, state, noEditExpected);

		this._logger.info(`Saved recording: path=${fileUri.fsPath}, noEditExpected=${noEditExpected}`);
	}

	private async _saveMetadata(
		folderUri: Uri,
		recordingFilename: string,
		state: CaptureState,
		noEditExpected: boolean = false
	): Promise<void> {
		const metadataFilename = recordingFilename.replace('.recording.w.json', '.metadata.json');
		const metadataUri = Uri.joinPath(folderUri, metadataFilename);

		const metadata = {
			captureTimestamp: new Date(state.startTime).toISOString(),
			trigger: state.trigger,
			durationMs: Date.now() - state.startTime,
			noEditExpected,
			originalNesContext: state.originalNesMetadata
		};

		const content = JSON.stringify(metadata, null, 2);
		await workspace.fs.writeFile(metadataUri, Buffer.from(content, 'utf8'));
	}

	public async submitCaptures(): Promise<void> {
		const workspaceFolder = workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			window.showErrorMessage('No workspace folder found');
			return;
		}

		const feedbackFolderUri = Uri.joinPath(workspaceFolder.uri, ExpectedEditCaptureController.CAPTURE_FOLDER);
		await this._feedbackSubmitter.submitFromFolder(feedbackFolderUri);
	}

	override dispose(): void {
		if (this._state?.active) {
			this._state = undefined;
			void commands.executeCommand('setContext', dardcorNesCaptureMode, false);
		}
		this._disposeStatusBarItem();
		super.dispose();
	}
}
