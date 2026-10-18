/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEditSurvivalTrackerService, IEditSurvivalTrackingSession } from '../../../platform/editSurvivalTracking/common/editSurvivalTrackerService';
import { NotebookDocumentSnapshot } from '../../../platform/editing/common/notebookDocumentSnapshot';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { modelShouldUseReplaceStringHealing } from '../../../platform/endpoint/common/chatModelCapabilities';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILanguageDiagnosticsService } from '../../../platform/languages/common/languageDiagnosticsService';
import { ILogService } from '../../../platform/log/common/logService';
import { IAlternativeNotebookContentService } from '../../../platform/notebook/common/alternativeContent';
import { IAlternativeNotebookContentEditGenerator, NotebookEditGenerationTelemtryOptions, NotebookEditGenrationSource } from '../../../platform/notebook/common/alternativeContentEditGenerator';
import { INotebookService } from '../../../platform/notebook/common/notebookService';
import { emitEditSurvivalEvent } from '../../../platform/otel/common/genAiEvents';
import { GenAiMetrics } from '../../../platform/otel/common/genAiMetrics';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { ITelemetryService, multiplexProperties } from '../../../platform/telemetry/common/telemetry';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { removeLeadingFilepathComment } from '../../../util/common/markdown';
import { timeout } from '../../../util/dardcor/base/common/async';
import { Iterable } from '../../../util/dardcor/base/common/iterator';
import { ResourceMap, ResourceSet } from '../../../util/dardcor/base/common/map';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { isDefined } from '../../../util/dardcor/base/common/types';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatRequestEditorData, ChatResponseTextEditPart, EndOfLine, ExtendedLanguageModelToolResult, Position as ExtPosition, LanguageModelPromptTsxPart, LanguageModelToolResult, TextEdit } from '../../../dardcorTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { renderPromptElementJSON } from '../../prompts/node/base/promptRenderer';
import { CellOrNotebookEdit, processFullRewriteNotebookEdits } from '../../prompts/node/codeMapper/codeMapper';
import { EditTools, IEditToolLearningService } from '../common/editToolLearningService';
import { ToolName } from '../common/toolNames';
import { IAgentTool } from '../common/toolsRegistry';
import { IToolsService } from '../common/toolsService';
import { ActionType } from './applyPatch/parser';
import { CorrectedEditResult, healReplaceStringParams } from './editFileHealing';
import { EditFileResult, IEditedFile } from './editFileToolResult';
import { applyEdit, canExistingFileBeEdited, createEditConfirmation, EditError, formatDiffAsUnified, getDisallowedEditUriError, logEditToolResult, NoChangeError, NoMatchError, openDocumentAndSnapshot } from './editFileToolUtils';
import { sendEditNotebookTelemetry } from './editNotebookTool';
import { assertFileNotContentExcluded, resolveToolInputPath } from './toolUtils';
import { DoomLoopDetector } from '../../agent/doomLoopDetector';
import { GitCheckpointEngine } from '../../checkpoint/gitCheckpoint';

export interface IAbstractReplaceStringInput {
	filePath: string;
	oldString: string;
	newString: string;
}

export interface IPrepareEdit {
	document: NotebookDocumentSnapshot | TextDocumentSnapshot | undefined;
	uri: URI;
	healed?: IAbstractReplaceStringInput;
	input: IAbstractReplaceStringInput;
	generatedEdit:
	| { success: true; textEdits: vscode.TextEdit[]; notebookEdits?: CellOrNotebookEdit[]; updated: NotebookDocumentSnapshot | TextDocumentSnapshot | undefined }
	| { success: false; errorMessage: string };
}


export abstract class AbstractReplaceStringTool<T extends { explanation: string }> implements IAgentTool<T> {
	protected _promptContext: IBuildPromptContext | undefined;

	private lastOperation?: { inputKey: string; operation: Promise<IPrepareEdit[]> } | undefined;

	constructor(
		@IPromptPathRepresentationService protected readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IWorkspaceService protected readonly workspaceService: IWorkspaceService,
		@IToolsService protected readonly toolsService: IToolsService,
		@INotebookService protected readonly notebookService: INotebookService,
		@IFileSystemService protected readonly fileSystemService: IFileSystemService,
		@IAlternativeNotebookContentService protected readonly alternativeNotebookContent: IAlternativeNotebookContentService,
		@IAlternativeNotebookContentEditGenerator private readonly alternativeNotebookEditGenerator: IAlternativeNotebookContentEditGenerator,
		@IEditSurvivalTrackerService private readonly _editSurvivalTrackerService: IEditSurvivalTrackerService,
		@ILanguageDiagnosticsService private readonly languageDiagnosticsService: ILanguageDiagnosticsService,
		@ITelemetryService protected readonly telemetryService: ITelemetryService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IEditToolLearningService private readonly editToolLearningService: IEditToolLearningService,
		@ILogService private readonly logService: ILogService,
		@IOTelService private readonly _otelService: IOTelService,
	) { }

	public abstract invoke(options: vscode.LanguageModelToolInvocationOptions<T>, token: vscode.CancellationToken): Promise<LanguageModelToolResult>;

	protected abstract toolName(): ToolName;

	protected abstract extractReplaceInputs(input: T): IAbstractReplaceStringInput[];

	protected prepareEdits(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, token: vscode.CancellationToken): Promise<IPrepareEdit[]> {
		const input = this.extractReplaceInputs(options.input);
		const cacheKey = JSON.stringify(input);
		if (this.lastOperation?.inputKey !== cacheKey) {
			this.lastOperation = {
				inputKey: cacheKey,
				operation: this._prepareEdits(options, input, token)
			};
		}

		return this.lastOperation.operation;
	}

	private async _prepareEdits(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, input: IAbstractReplaceStringInput[], token: vscode.CancellationToken) {
		const doomCheck = DoomLoopDetector.getInstance().recordAndCheck(this.toolName(), input);
		if (doomCheck.isDoomLoop) {
			throw new Error(doomCheck.message);
		}

		try {
			const workspaceFolders = this.workspaceService.getWorkspaceFolders();
			const rootPath = workspaceFolders?.[0]?.fsPath || process.cwd();
			void GitCheckpointEngine.getInstance(rootPath).capture(`AI edit via ${this.toolName()}`);
		} catch {
		}

		const results = await Promise.all(input.map(i => this._prepareEditsForFile(options, i, token)));
		this._errorConflictingEdits(results);
		return results;
	}

	private _errorConflictingEdits(results: IPrepareEdit[]) {
		for (let i = 1; i < results.length; i++) {
			const current = results[i];
			if (!current.generatedEdit.success) {
				continue;
			}

			for (let k = 0; k < i; k++) {
				const other = results[k];
				if (!other.generatedEdit.success || !extUriBiasedIgnorePathCase.isEqual(current.uri, other.uri)) {
					continue;
				}

				const allEdits = [
					...current.generatedEdit.textEdits,
					...other.generatedEdit.textEdits,
				].sort((a, b) => a.range.start.compareTo(b.range.start));

				const hasOverlap = allEdits.some((e2, i) => {
					if (i === 0) { return false; }
					const e1 = allEdits[i - 1];
					return !e1.range.end.isBeforeOrEqual(e2.range.start);
				});

				if (hasOverlap) {
					current.generatedEdit = {
						success: false,
						errorMessage: `Edit at index ${i} conflicts with another replacement in ${this.promptPathRepresentationService.getFilePath(current.uri)}. You can make another call to try again.`
					};
					break;
				}
			}
		}
	}

	private async _prepareEditsForFile(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, input: IAbstractReplaceStringInput, token: vscode.CancellationToken): Promise<IPrepareEdit> {
		const uri = resolveToolInputPath(input.filePath, this.promptPathRepresentationService);

		const disallowedUriError = getDisallowedEditUriError(uri, this._promptContext?.allowedEditUris, this.promptPathRepresentationService);
		if (disallowedUriError) {
			return {
				uri,
				document: undefined,
				generatedEdit: {
					success: false,
					errorMessage: disallowedUriError
				},
				input,
			};
		}

		try {
			await this.instantiationService.invokeFunction(accessor => assertFileNotContentExcluded(accessor, uri));
		} catch (error) {
			this.sendReplaceTelemetry('invalidFile', options, input, undefined, undefined, undefined);
			throw error;
		}

		if (!input.filePath || input.oldString === undefined || input.newString === undefined || !this._promptContext) {
			this.sendReplaceTelemetry('invalidStrings', options, input, undefined, undefined, undefined);
			throw new Error('Invalid input');
		}

		const exists = await this.instantiationService.invokeFunction(canExistingFileBeEdited, uri);
		if (!exists) {
			return {
				uri,
				document: undefined,
				generatedEdit: input.oldString
					? { success: false, errorMessage: `File does not exist: ${input.filePath}. Use the ${ToolName.CreateFile} tool to create it, or correct your filepath.` }
					: { success: true, textEdits: [TextEdit.insert(new ExtPosition(0, 0), input.newString)], updated: undefined },
				input,
			};
		}

		const isNotebook = this.notebookService.hasSupportedNotebooks(uri);
		const document = await this.instantiationService.invokeFunction(openDocumentAndSnapshot, this._promptContext, uri);

		const didHealRef: { healed?: IAbstractReplaceStringInput } = {};
		try {
			if (input.oldString === input.newString) {
				throw new NoChangeError('Input and output are identical', input.filePath);
			}

			const { updatedFile, edits } = await this.generateEdit(uri, document, options, input, didHealRef, token);
			let notebookEdits: (vscode.NotebookEdit | [URI, vscode.TextEdit[]])[] | undefined;
			let updated: NotebookDocumentSnapshot | TextDocumentSnapshot;
			if (document instanceof NotebookDocumentSnapshot) {
				const model = await this.modelForTelemetry(options);
				const telemetryOptions: NotebookEditGenerationTelemtryOptions = {
					model,
					requestId: this._promptContext.requestId,
					source: NotebookEditGenrationSource.stringReplace,
				};

				notebookEdits = await Iterable.asyncToArray(processFullRewriteNotebookEdits(document.document, updatedFile, this.alternativeNotebookEditGenerator, telemetryOptions, token));
				sendEditNotebookTelemetry(this.telemetryService, this.endpointProvider, 'stringReplace', document.uri, this._promptContext.requestId, model || 'unknown');
				updated = NotebookDocumentSnapshot.fromNewText(updatedFile, document);
			} else {
				updated = TextDocumentSnapshot.fromNewText(updatedFile, document);
			}

			void this.sendReplaceTelemetry('success', options, input, document.getText(), isNotebook, !!didHealRef.healed);
			return {
				document,
				uri,
				input,
				healed: didHealRef.healed,
				generatedEdit: { success: true, textEdits: edits, notebookEdits, updated }
			};
		} catch (error) {
			let errorMessage = 'String replacement failed: ';
			let outcome: string;

			if (error instanceof NoMatchError) {
				outcome = input.oldString.match(/Lines \d+-\d+ omitted/) ?
					'oldStringHasOmittedLines' :
					input.oldString.includes('{…}') ?
						'oldStringHasSummarizationMarker' :
						input.oldString.includes('/*...*/') ?
							'oldStringHasSummarizationMarkerSemanticSearch' :
							error.kindForTelemetry;
				errorMessage += `${error.message}`;
			} else if (error instanceof EditError) {
				outcome = error.kindForTelemetry;
				errorMessage += error.message;
			} else {
				outcome = 'other';
				errorMessage += `${error.message}`;
			}

			void this.sendReplaceTelemetry(outcome, options, input, document.getText(), isNotebook, !!didHealRef.healed);

			return { document, uri, input, healed: didHealRef.healed, generatedEdit: { success: false, errorMessage } };
		}
	}

	protected async applyAllEdits(options: vscode.LanguageModelToolInvocationOptions<T>, edits: IPrepareEdit[], token: vscode.CancellationToken) {
		if (!this._promptContext?.stream) {
			throw new Error('no prompt context found');
		}

		logEditToolResult(this.logService, options.chatRequestId, ...edits.map(e => ({ input: e.input, success: e.generatedEdit.success, healed: e.healed })));

		const fileResults: IEditedFile[] = [];
		const existingDiagnosticMap = new ResourceMap<vscode.Diagnostic[]>();

		for (const { document, uri, generatedEdit, healed } of edits) {
			if (document && !existingDiagnosticMap.has(document.uri)) {
				existingDiagnosticMap.set(document.uri, this.languageDiagnosticsService.getDiagnostics(document.uri));
			}
			const existingDiagnostics = document ? existingDiagnosticMap.get(document.uri)! : [];
			const isNotebook = this.notebookService.hasSupportedNotebooks(uri);

			if (!generatedEdit.success) {
				fileResults.push({ operation: ActionType.UPDATE, uri, isNotebook, existingDiagnostics, error: generatedEdit.errorMessage });
				continue;
			}

			let editSurvivalTracker: IEditSurvivalTrackingSession | undefined;
			let responseStream = this._promptContext.stream;
			if (document && document instanceof TextDocumentSnapshot) {
				const tracker = editSurvivalTracker = this._editSurvivalTrackerService.initialize(document.document);
				responseStream = ChatResponseStreamImpl.spy(this._promptContext.stream, (part) => {
					if (part instanceof ChatResponseTextEditPart) {
						tracker.collectAIEdits(part.edits);
					}
				});
			}

			this._promptContext.stream.markdown('\n```\n');
			this._promptContext.stream.codeblockUri(uri, true);

			if (generatedEdit.notebookEdits) {
				const uriToEdit = document?.uri ?? uri;
				this._promptContext.stream.notebookEdit(uriToEdit, []);
				for (const edit of generatedEdit.notebookEdits) {
					if (edit instanceof Array) {
						this._promptContext.stream.textEdit(edit[0], edit[1]);
					} else {
						this._promptContext.stream.notebookEdit(uriToEdit, edit);
					}
				}
				this._promptContext.stream.notebookEdit(uriToEdit, true);
			} else {
				for (const edit of generatedEdit.textEdits) {
					responseStream.textEdit(uri, edit);
				}
				responseStream.textEdit(uri, true);

				timeout(2000).then(() => {
					editSurvivalTracker?.startReporter(res => {
						res.telemetryService.sendMSFTTelemetryEvent('codeMapper.trackEditSurvival', { requestId: this._promptContext?.requestId, requestSource: 'agent', mapper: 'stringReplaceTool' }, {
							survivalRateFourGram: res.fourGram,
							survivalRateNoRevert: res.noRevert,
							timeDelayMs: res.timeDelayMs,
							didBranchChange: res.didBranchChange ? 1 : 0,
						});
						res.telemetryService.sendInternalMSFTTelemetryEvent('codeMapper.trackEditSurvival', {
							requestId: this._promptContext?.requestId,
							requestSource: 'agent',
							mapper: 'stringReplaceTool',
							textBeforeAiEdits: res.textBeforeAiEdits ? JSON.stringify(res.textBeforeAiEdits) : undefined,
							textAfterAiEdits: res.textAfterAiEdits ? JSON.stringify(res.textAfterAiEdits) : undefined,
							textAfterUserEdits: res.textAfterUserEdits ? JSON.stringify(res.textAfterUserEdits) : undefined,
						}, {
							survivalRateFourGram: res.fourGram,
							survivalRateNoRevert: res.noRevert,
							timeDelayMs: res.timeDelayMs,
							didBranchChange: res.didBranchChange ? 1 : 0,
						});
						res.telemetryService.sendGHTelemetryEvent('replaceString/trackEditSurvival', {
							headerRequestId: this._promptContext?.requestId,
							requestSource: 'agent',
							mapper: 'stringReplaceTool',
							headBranchName: res.workspace?.headBranchName,
							headCommitHash: res.workspace?.headCommitHash,
							remoteUrl: res.workspace?.remoteUrl,
							fileRelativePath: res.workspace?.fileRelativePath,
						}, {
							survivalRateFourGram: res.fourGram,
							survivalRateNoRevert: res.noRevert,
							timeDelayMs: res.timeDelayMs,
							didBranchChange: res.didBranchChange ? 1 : 0,
						});

						emitEditSurvivalEvent(this._otelService, 'replace_string', res.fourGram, res.noRevert, res.timeDelayMs, res.didBranchChange, this._promptContext?.requestId ?? '', res.workspace);
						GenAiMetrics.recordEditSurvivalFourGram(this._otelService, 'replace_string', res.fourGram, res.timeDelayMs);
						GenAiMetrics.recordEditSurvivalNoRevert(this._otelService, 'replace_string', res.noRevert, res.timeDelayMs);
					});
				});

				fileResults.push({
					operation: ActionType.UPDATE,
					uri,
					isNotebook,
					existingDiagnostics,
					healed: healed ? JSON.stringify({ oldString: healed.oldString, newString: healed.newString }, null, 2) : undefined
				});
			}

			this._promptContext.stream.markdown('\n```\n');

			if (generatedEdit.updated) {
				this._promptContext.turnEditedDocuments ??= new ResourceMap();
				this._promptContext.turnEditedDocuments.set(uri, generatedEdit.updated);
			}
		}

		const isInlineChat = this._promptContext.request?.location2 instanceof ChatRequestEditorData;

		const result = new ExtendedLanguageModelToolResult([
			new LanguageModelPromptTsxPart(
				await renderPromptElementJSON(
					this.instantiationService,
					EditFileResult,
					{ files: fileResults, diagnosticsTimeout: isInlineChat ? -1 : 2000, toolName: this.toolName(), requestId: options.chatRequestId, model: options.model },
					options.tokenizationOptions ?? {
						tokenBudget: 5000,
						countTokens: (t) => Promise.resolve(t.length * 3 / 4)
					},
					token,
				),
			)
		]);

		result.hasError = fileResults.some(f => f.error);
		return result;
	}

	protected doGenerateEdit(uri: URI, oldString: string, newString: string, options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>) {
		return applyEdit(
			uri,
			oldString,
			newString,
			this.workspaceService,
			this.notebookService,
			this.alternativeNotebookContent,
			this._promptContext?.request?.model
		);
	}

	private async generateEdit(uri: URI, document: TextDocumentSnapshot | NotebookDocumentSnapshot, options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, input: IAbstractReplaceStringInput, didHealRef: { healed?: IAbstractReplaceStringInput }, token: vscode.CancellationToken) {
		const model = this.modelObjectForTelemetry(options);
		const filePath = this.promptPathRepresentationService.getFilePath(document.uri);
		const eol = document instanceof TextDocumentSnapshot && document.eol === EndOfLine.CRLF ? '\r\n' : '\n';
		const oldString = removeLeadingFilepathComment(input.oldString, document.languageId, filePath).replace(/\r?\n/g, eol);
		const newString = removeLeadingFilepathComment(input.newString, document.languageId, filePath).replace(/\r?\n/g, eol);

		let updatedFile: string;
		let edits: vscode.TextEdit[] = [];
		try {
			const result = await this.doGenerateEdit(uri, oldString, newString, options);
			updatedFile = result.updatedFile;
			edits = result.edits;
			this.recordEditSuccess(options, true);
		} catch (e) {
			if (!(e instanceof NoMatchError)) {
				throw e;
			}
			this.recordEditSuccess(options, false);

			if (model && !modelShouldUseReplaceStringHealing(model)) {
				throw e;
			}

			let healed: CorrectedEditResult;
			try {
				healed = await healReplaceStringParams(
					model,
					document.getText(),
					{
						explanation: options.input.explanation,
						filePath: filePath,
						oldString,
						newString,
					},
					eol,
					await this.endpointProvider.getChatEndpoint('dardcor-utility-small'),
					token
				);
				if (healed.params.oldString === healed.params.newString) {
					throw new NoChangeError('change was identical after healing', document.uri.fsPath);
				}
			} catch (e2) {
				this.sendHealingTelemetry(options, String(e2), undefined);
				throw e;
			}

			didHealRef.healed = healed.params;

			try {
				const result = await applyEdit(
					uri,
					healed.params.oldString,
					healed.params.newString,
					this.workspaceService,
					this.notebookService,
					this.alternativeNotebookContent,
					this._promptContext?.request?.model
				);
				updatedFile = result.updatedFile;
				edits = result.edits;
			} catch (e2) {
				this.sendHealingTelemetry(options, undefined, String(e2));
				throw e;
			}
		}

		return { edits, updatedFile };
	}

	private async sendReplaceTelemetry(outcome: string, options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, input: IAbstractReplaceStringInput, file: string | undefined, isNotebookDocument: boolean | undefined, didHeal: boolean | undefined) {
		const model = await this.modelForTelemetry(options);
		const isNotebook = isNotebookDocument ? 1 : (isNotebookDocument === false ? 0 : -1);
		const isMulti = this.toolName() === ToolName.MultiReplaceString ? 1 : 0;
		this.telemetryService.sendMSFTTelemetryEvent('replaceStringToolInvoked',
			{
				requestId: options.chatRequestId,
				interactionId: options.chatRequestId,
				outcome,
				model
			}, { isNotebook, didHeal: didHeal === undefined ? -1 : (didHeal ? 1 : 0), isMulti }
		);

		void multiplexProperties({
			headerRequestId: options.chatRequestId,
			baseModel: model,
			messageText: file,
			completionTextJson: JSON.stringify(input),
			postProcessingOutcome: outcome,
		}).then(properties => this.telemetryService.sendEnhancedGHTelemetryEvent('replaceStringTool', properties, { isNotebook })).catch(() => { });
	}

	private async sendHealingTelemetry(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, healError: string | undefined, applicationError: string | undefined) {
		this.telemetryService.sendMSFTTelemetryEvent('replaceStringHealingStat',
			{
				requestId: options.chatRequestId,
				interactionId: options.chatRequestId,
				model: await this.modelForTelemetry(options),
				healError,
				applicationError,
			}, { success: healError === undefined && applicationError === undefined ? 1 : 0 }
		);
	}

	protected async modelForTelemetry(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>) {
		const model = this.modelObjectForTelemetry(options);
		return model && (await this.endpointProvider.getChatEndpoint(model)).model;
	}

	protected modelObjectForTelemetry(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>) {
		const model = 'model' in options ? options.model : this._promptContext?.request?.model;
		return model;
	}

	private async recordEditSuccess(options: vscode.LanguageModelToolInvocationOptions<T> | vscode.LanguageModelToolInvocationPrepareOptions<T>, success: boolean) {
		const model = this.modelObjectForTelemetry(options);
		if (model) {
			this.editToolLearningService.didMakeEdit(model, this.toolName() as EditTools, success);
		}
	}

	async resolveInput(input: T, promptContext: IBuildPromptContext): Promise<T> {
		this._promptContext = promptContext;
		return input;
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<T>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		const replaceInputs = this.extractReplaceInputs(options.input);
		const allUris = replaceInputs.map(input => resolveToolInputPath(input.filePath, this.promptPathRepresentationService));

		return this.instantiationService.invokeFunction(
			createEditConfirmation,
			allUris,
			this._promptContext?.allowedEditUris,
			(urisNeedingConfirmation) => this.generateConfirmationDetails(replaceInputs, urisNeedingConfirmation, options, token),
			options.forceConfirmationReason,
			undefined,
			options.workingDirectory,
		);
	}

	private async generateConfirmationDetails(
		replaceInputs: IAbstractReplaceStringInput[],
		urisNeedingConfirmation: readonly URI[],
		options: vscode.LanguageModelToolInvocationPrepareOptions<T>,
		token: vscode.CancellationToken
	): Promise<string> {
		const urisNeedingConfirmationSet = new ResourceSet(urisNeedingConfirmation);

		const allPreparedEdits = await this.prepareEdits(options, token);

		const diffResults = await Promise.all(
			allPreparedEdits.map(async (preparedEdit) => {
				const uri = preparedEdit.uri;

				if (!urisNeedingConfirmationSet.has(uri)) {
					return;
				}

				if (preparedEdit.generatedEdit.success) {
					const oldContent = preparedEdit.document?.getText() || '';
					const newContent = preparedEdit.generatedEdit.updated?.getText() || '';

					return await this.instantiationService.invokeFunction(
						formatDiffAsUnified,
						uri,
						oldContent,
						newContent
					);
				}
			})
		);

		return diffResults.filter(isDefined).join('\n\n');
	}
}
