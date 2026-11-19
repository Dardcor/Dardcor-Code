/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DardcorNamedAnnotationList } from '../../../../../platform/completions-core/common/openai/dardcorAnnotations';
import { IInstantiationService, ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ICompletionsTelemetryService } from '../../bridge/src/completionsTelemetryServiceBridge';
import { ChangeTracker } from './changeTracker';
import { ICompletionsCitationManager, IPCitationDetail } from './citationManager';
import { createCompletionState } from './completionState';
import { ICompletionsFileReaderService } from './fileReader';
import { PostInsertionCategory, telemetryAccepted, telemetryRejected } from './ghostText/telemetry';
import { ICompletionsLogTargetService, Logger } from './logger';
import { contextIndentationFromText, indentationBlockFinished } from './prompt/parseBlock';
import { Prompt, extractPrompt } from './prompt/prompt';
import { editDistance, lexEditDistance } from './suggestions/editDistance';
import { SuggestionStatus, computeCompletionText } from './suggestions/partialSuggestions';
import { TelemetryStore, TelemetryWithExp, telemetry, telemetryCatch } from './telemetry';
import { ICompletionsTextDocumentManagerService } from './textDocumentManager';
import { ICompletionsPromiseQueueService } from './util/promiseQueue';
import { ICompletionsRuntimeModeService } from './util/runtimeMode';

const postInsertionLogger = new Logger('postInsertion');

type Timeout = {
	seconds: number;
	captureCode: boolean;
	captureRejection: boolean;
};
const captureTimeouts: Timeout[] = [
	{ seconds: 15, captureCode: false, captureRejection: false },
	{ seconds: 30, captureCode: true, captureRejection: true },
	{ seconds: 120, captureCode: false, captureRejection: false },
	{ seconds: 300, captureCode: false, captureRejection: false },
	{ seconds: 600, captureCode: false, captureRejection: false },
];

const stillInCodeNearMargin = 50;
const stillInCodeFarMargin = 1500;

const stillInCodeFraction = 0.5;

const captureCodeMargin = 500;

const postInsertConfiguration: {
	triggerPostInsertionSynchroneously: boolean;
	captureCode: boolean;
	captureRejection: boolean;
} = {
	triggerPostInsertionSynchroneously: false,
	captureCode: false,
	captureRejection: false,
};

async function captureCode(
	accessor: ServicesAccessor,
	uri: string,
	completionTelemetry: TelemetryWithExp,
	offset: number,
	suffixOffset?: number
): Promise<{ prompt: Prompt; capturedCode: string; terminationOffset: number }> {
	const instantiationService = accessor.get(IInstantiationService);
	const logTarget = accessor.get(ICompletionsLogTargetService);
	const result = await accessor.get(ICompletionsFileReaderService).getOrReadTextDocumentWithFakeClientProperties({ uri });
	if (result.status !== 'valid') {
		postInsertionLogger.info(logTarget, `Could not get document for ${uri}. Maybe it was closed by the editor.`);
		return {
			prompt: {
				prefix: '',
				suffix: '',
				isFimEnabled: false,
			},
			capturedCode: '',
			terminationOffset: 0,
		};
	}
	const document = result.document;
	const documentText = document.getText();
	const documentTextBefore = documentText.substring(0, offset);
	const position = document.positionAt(offset);

	const hypotheticalPromptResponse = await instantiationService.invokeFunction(extractPrompt,
		completionTelemetry.properties.headerRequestId,
		createCompletionState(document, position),
		completionTelemetry
	);
	const hypotheticalPrompt =
		hypotheticalPromptResponse.type === 'prompt'
			? hypotheticalPromptResponse.prompt
			: {
				prefix: documentTextBefore,
				suffix: '',
				isFimEnabled: false,
			};

	if (hypotheticalPrompt.isFimEnabled && suffixOffset !== undefined) {
		const capturedCode = documentText.substring(offset, suffixOffset);
		hypotheticalPrompt.suffix = documentText.substring(suffixOffset);

		return { prompt: hypotheticalPrompt, capturedCode, terminationOffset: 0 };
	} else {
		const hypotheticalResponse = documentText.substring(offset);

		const contextIndent = contextIndentationFromText(documentTextBefore, offset, document.detectedLanguageId);
		const indentTerminationFunction = indentationBlockFinished(contextIndent, undefined);
		const terminationResult = indentTerminationFunction(hypotheticalResponse);

		const maxOffset = Math.min(
			documentText.length,
			offset + (terminationResult ? terminationResult * 2 : captureCodeMargin)
		);

		const capturedCode = documentText.substring(offset, maxOffset);

		return { prompt: hypotheticalPrompt, capturedCode, terminationOffset: terminationResult ?? -1 };
	}
}

export function postRejectionTasks(
	accessor: ServicesAccessor,
	insertionCategory: PostInsertionCategory,
	insertionOffset: number,
	uri: string,
	completions: { completionText: string; completionTelemetryData: TelemetryWithExp }[]
) {
	const logTarget = accessor.get(ICompletionsLogTargetService);
	const instantiationService = accessor.get(IInstantiationService);
	const telemetryService = accessor.get(ICompletionsTelemetryService);
	const promiseQueueService = accessor.get(ICompletionsPromiseQueueService);

	completions.forEach(({ completionText, completionTelemetryData }) => {
		postInsertionLogger.debug(
			logTarget,
			`${insertionCategory}.rejected choiceIndex: ${completionTelemetryData.properties.choiceIndex}`
		);
		instantiationService.invokeFunction(telemetryRejected, insertionCategory, completionTelemetryData);
	});
	const positionTracker = instantiationService.createInstance(ChangeTracker, uri, insertionOffset - 1);
	const suffixTracker = instantiationService.createInstance(ChangeTracker, uri, insertionOffset);

	const checkInCode = async (t: Timeout) => {
		postInsertionLogger.debug(
			logTarget,
			`Original offset: ${insertionOffset}, Tracked offset: ${positionTracker.offset}`
		);
		const { completionTelemetryData } = completions[0];

		const { prompt, capturedCode, terminationOffset } = await instantiationService.invokeFunction(captureCode,
			uri,
			completionTelemetryData,
			positionTracker.offset + 1,
			suffixTracker.offset
		);

		const promptTelemetry = {
			hypotheticalPromptJson: JSON.stringify({ prefix: prompt.prefix, context: prompt.context }),
			hypotheticalPromptSuffixJson: JSON.stringify(prompt.suffix),
		};

		const customTelemetryData = completionTelemetryData.extendedBy(
			{
				...promptTelemetry,
				capturedCodeJson: JSON.stringify(capturedCode),
			},
			{
				timeout: t.seconds,
				insertionOffset: insertionOffset,
				trackedOffset: positionTracker.offset,
				terminationOffsetInCapturedCode: terminationOffset,
			}
		);
		postInsertionLogger.debug(
			logTarget,
			`${insertionCategory}.capturedAfterRejected choiceIndex: ${completionTelemetryData.properties.choiceIndex}`,
			customTelemetryData
		);
		instantiationService.invokeFunction(telemetry, insertionCategory + '.capturedAfterRejected', customTelemetryData, TelemetryStore.Enhanced);
	};
	captureTimeouts
		.filter(t => t.captureRejection)
		.map(t =>
			positionTracker.push(
				telemetryCatch(telemetryService, promiseQueueService, () => checkInCode(t), 'postRejectionTasks'),
				t.seconds * 1000
			)
		);
}

export function postInsertionTasks(
	accessor: ServicesAccessor,
	insertionCategory: PostInsertionCategory,
	completionText: string,
	insertionOffset: number,
	uri: string,
	telemetryData: TelemetryWithExp,
	suggestionStatus: SuggestionStatus,
	dardcorAnnotations?: DardcorNamedAnnotationList
) {
	const logTarget = accessor.get(ICompletionsLogTargetService);
	const instantiationService = accessor.get(IInstantiationService);
	const promiseQueueService = accessor.get(ICompletionsPromiseQueueService);
	const telemetryService = accessor.get(ICompletionsTelemetryService);
	const runtimeModeService = accessor.get(ICompletionsRuntimeModeService);

	const telemetryDataWithStatus = telemetryData.extendedBy(
		{
			compType: suggestionStatus.compType,
		},
		{
			compCharLen: suggestionStatus.acceptedLength,
			numLines: suggestionStatus.acceptedLines,
		}
	);
	postInsertionLogger.debug(
		logTarget,
		`${insertionCategory}.accepted choiceIndex: ${telemetryDataWithStatus.properties.choiceIndex}`
	);
	instantiationService.invokeFunction(telemetryAccepted, insertionCategory, telemetryDataWithStatus);

	const fullCompletionText = completionText;
	completionText = computeCompletionText(completionText, suggestionStatus);
	const trimmedCompletion = completionText.trim();
	const tracker = instantiationService.createInstance(ChangeTracker, uri, insertionOffset);
	const suffixTracker = instantiationService.createInstance(ChangeTracker, uri, insertionOffset + completionText.length);

	const stillInCodeCheck = async (timeout: Timeout) => {
		const check = instantiationService.invokeFunction(checkStillInCode,
			insertionCategory,
			trimmedCompletion,
			insertionOffset,
			uri,
			timeout,
			telemetryDataWithStatus,
			tracker,
			suffixTracker
		);
		await check;
	};

	if (postInsertConfiguration.triggerPostInsertionSynchroneously && runtimeModeService.isRunningInTest()) {
		const check = stillInCodeCheck({
			seconds: 0,
			captureCode: postInsertConfiguration.captureCode,
			captureRejection: postInsertConfiguration.captureRejection,
		});
		promiseQueueService.register(check);
	} else {
		captureTimeouts.map(timeout =>
			tracker.push(
				telemetryCatch(telemetryService, promiseQueueService, () => stillInCodeCheck(timeout), 'postInsertionTasks'),
				timeout.seconds * 1000
			)
		);
	}

	instantiationService.invokeFunction(acc => telemetryCatch(telemetryService, promiseQueueService, citationCheck, 'post insertion citation check')(
		acc,
		uri,
		fullCompletionText,
		completionText,
		insertionOffset,
		dardcorAnnotations
	));
}

async function citationCheck(
	accessor: ServicesAccessor,
	uri: string,
	fullCompletionText: string,
	insertedText: string,
	insertionOffset: number,
	dardcorAnnotations?: DardcorNamedAnnotationList
) {
	const logTarget = accessor.get(ICompletionsLogTargetService);
	const textDocumentManagerService = accessor.get(ICompletionsTextDocumentManagerService);
	const citationManagerService = accessor.get(ICompletionsCitationManager);

	if (!dardcorAnnotations || (dardcorAnnotations.ip_code_citations?.length ?? 0) < 1) {
		return;
	}

	const doc = await textDocumentManagerService.getTextDocument({ uri });

	if (doc) {
		const found = find(doc.getText(), insertedText, stillInCodeNearMargin, insertionOffset);
		if (found.stillInCodeHeuristic) {
			insertionOffset = found.foundOffset;
		}
	}

	for (const citation of dardcorAnnotations.ip_code_citations) {
		const citationStart = computeCitationStart(
			fullCompletionText.length,
			insertedText.length,
			citation.start_offset
		);
		if (citationStart === undefined) {
			postInsertionLogger.info(
				logTarget,
				`Full completion for ${uri} contains a reference matching public code, but the partially inserted text did not include the match.`
			);
			continue;
		}
		const offsetStart = insertionOffset + citationStart;
		const start = doc?.positionAt(offsetStart);
		const offsetEnd =
			insertionOffset + computeCitationEnd(fullCompletionText.length, insertedText.length, citation.stop_offset);
		const end = doc?.positionAt(offsetEnd);
		const text = start && end ? doc?.getText({ start, end }) : '<unknown>';

		await citationManagerService.handleIPCodeCitation({
			inDocumentUri: uri,
			offsetStart,
			offsetEnd,
			version: doc?.version,
			location: start && end ? { start, end } : undefined,
			matchingText: text,
			details: citation.details.citations as IPCitationDetail[],
		});
	}
}

function computeCitationStart(
	completionLength: number,
	insertedLength: number,
	citationStartOffset: number
): number | undefined {
	if (insertedLength < completionLength && citationStartOffset > insertedLength) {
		return undefined;
	}
	return citationStartOffset;
}

function computeCitationEnd(completionLength: number, insertedLength: number, citationStopOffset: number): number {
	if (insertedLength < completionLength) {
		return Math.min(citationStopOffset, insertedLength);
	}
	return citationStopOffset;
}

function find(documentText: string, completion: string, margin: number, offset: number) {
	const window = documentText.substring(
		Math.max(0, offset - margin),
		Math.min(documentText.length, offset + completion.length + margin)
	);
	const lexAlignment = lexEditDistance(window, completion);
	const fraction = lexAlignment.lexDistance / lexAlignment.needleLexLength;
	const { distance: charEditDistance } = editDistance(
		window.substring(lexAlignment.startOffset, lexAlignment.endOffset),
		completion
	);
	return {
		relativeLexEditDistance: fraction,
		charEditDistance,
		completionLexLength: lexAlignment.needleLexLength,
		foundOffset: lexAlignment.startOffset + Math.max(0, offset - margin),
		lexEditDistance: lexAlignment.lexDistance,
		stillInCodeHeuristic: fraction <= stillInCodeFraction ? 1 : 0,
	};
}

async function checkStillInCode(
	accessor: ServicesAccessor,
	insertionCategory: string,
	completion: string,
	insertionOffset: number,
	uri: string,
	timeout: Timeout,
	telemetryData: TelemetryWithExp,
	tracker: ChangeTracker,
	suffixTracker: ChangeTracker
) {
	const instantiationService = accessor.get(IInstantiationService);
	const logTarget = accessor.get(ICompletionsLogTargetService);
	const result = await accessor.get(ICompletionsFileReaderService).getOrReadTextDocument({ uri });
	if (result.status === 'valid') {
		const document = result.document;
		const documentText = document.getText();

		let finding = find(documentText, completion, stillInCodeNearMargin, tracker.offset);
		if (!finding.stillInCodeHeuristic) {
			finding = find(documentText, completion, stillInCodeFarMargin, tracker.offset);
		}
		postInsertionLogger.debug(
			logTarget,
			`stillInCode: ${finding.stillInCodeHeuristic ? 'Found' : 'Not found'}! Completion '${completion}' in file ${uri
			}. lexEditDistance fraction was ${finding.relativeLexEditDistance}. Char edit distance was ${finding.charEditDistance
			}. Inserted at ${insertionOffset}, tracked at ${tracker.offset}, found at ${finding.foundOffset
			}. choiceIndex: ${telemetryData.properties.choiceIndex}`
		);
		const customTelemetryData = telemetryData
			.extendedBy({}, { timeout: timeout.seconds, insertionOffset: insertionOffset, trackedOffset: tracker.offset })
			.extendedBy({}, finding);
		instantiationService.invokeFunction(telemetry, insertionCategory + '.stillInCode', customTelemetryData);

		if (timeout.captureCode) {
			const { prompt, capturedCode, terminationOffset } = await instantiationService.invokeFunction(
				captureCode,
				uri,
				customTelemetryData,
				tracker.offset,
				suffixTracker.offset
			);
			const promptTelemetry = {
				hypotheticalPromptJson: JSON.stringify({ prefix: prompt.prefix, context: prompt.context }),
				hypotheticalPromptSuffixJson: JSON.stringify(prompt.suffix),
			};

			const afterAcceptedTelemetry = telemetryData.extendedBy(
				{
					...promptTelemetry,
					capturedCodeJson: JSON.stringify(capturedCode),
				},
				{
					timeout: timeout.seconds,
					insertionOffset: insertionOffset,
					trackedOffset: tracker.offset,
					terminationOffsetInCapturedCode: terminationOffset,
				}
			);
			postInsertionLogger.debug(
				logTarget,
				`${insertionCategory}.capturedAfterAccepted choiceIndex: ${telemetryData.properties.choiceIndex}`,
				customTelemetryData
			);
			instantiationService.invokeFunction(
				telemetry,
				insertionCategory + '.capturedAfterAccepted',
				afterAcceptedTelemetry,
				TelemetryStore.Enhanced
			);
		}
	}
}
