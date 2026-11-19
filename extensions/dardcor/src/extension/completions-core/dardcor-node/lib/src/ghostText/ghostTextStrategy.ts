/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { isSupportedLanguageId } from '../../../prompt/src/parse';
import { CompletionState } from '../completionState';
import { BlockMode } from '../config';
import { ICompletionsFeaturesService } from '../experiments/featuresService';
import { FinishedCallback } from '../openai/fetch';
import { APIChoice } from '../openai/openai';
import { isEmptyBlockStartUtil, parsingBlockFinished } from '../prompt/parseBlock';
import { Prompt, PromptResponsePresent } from '../prompt/prompt';
import { telemetry, TelemetryData, TelemetryWithExp } from '../telemetry';
import { IPosition, LocationFactory, TextDocumentContents } from '../textDocument';
import { BlockPositionType, BlockTrimmer, getBlockPositionType } from './blockTrimmer';
import { appendToCache } from './cacheUtils';
import { ICompletionsCacheService } from './completionsCache';
import { ICompletionsBlockModeConfig } from './configBlockMode';
import { requestMultilineScore } from './multilineModel';
import { StreamedCompletionSplitter } from './streamedCompletionSplitter';

const maxSinglelineTokens = 20;

type GhostTextStrategy = {
	blockMode: BlockMode;
	requestMultiline: boolean;
	finishedCb: FinishedCallback;
	stop?: string[];
	maxTokens?: number;
};

function takeNLines(n: number): FinishedCallback {
	return (text: string): number | undefined => {
		const lines = text?.split('\n') ?? [];
		if (lines.length > n + 1) {
			return lines.slice(0, n + 1).join('\n').length;
		}
	};
}

export async function getGhostTextStrategy(
	accessor: ServicesAccessor,
	completionState: CompletionState,
	prefix: string,
	prompt: PromptResponsePresent,
	inlineSuggestion: boolean,
	hasAcceptedCurrentCompletion: boolean,
	preIssuedTelemetryData: TelemetryWithExp,
): Promise<GhostTextStrategy> {
	const instantiationService = accessor.get(IInstantiationService);
	const featuresService = accessor.get(ICompletionsFeaturesService);
	const blockModeConfig = accessor.get(ICompletionsBlockModeConfig);
	const multilineAfterAcceptLines = featuresService.multilineAfterAcceptLines(preIssuedTelemetryData);
	const blockMode = blockModeConfig.forLanguage(completionState.textDocument.detectedLanguageId, preIssuedTelemetryData);
	switch (blockMode) {
		case BlockMode.Server:
			if (hasAcceptedCurrentCompletion) {
				return {
					blockMode: BlockMode.Parsing,
					requestMultiline: true,
					finishedCb: takeNLines(multilineAfterAcceptLines),
					stop: ['\n\n'],
					maxTokens: maxSinglelineTokens * multilineAfterAcceptLines,
				};
			}
			return {
				blockMode: BlockMode.Server,
				requestMultiline: true,
				finishedCb: _ => undefined,
			};
		case BlockMode.Parsing:
		case BlockMode.ParsingAndServer:
		case BlockMode.MoreMultiline:
		default: {
			let requestMultiline: MultilineDetermination;
			try {
				requestMultiline = await instantiationService.invokeFunction(shouldRequestMultiline,
					blockMode,
					completionState.textDocument,
					completionState.position,
					inlineSuggestion,
					hasAcceptedCurrentCompletion,
					prompt
				);
			} catch (err) {
				requestMultiline = { requestMultiline: false };
			}
			if (!hasAcceptedCurrentCompletion &&
				requestMultiline.requestMultiline &&
				featuresService.singleLineUnlessAccepted(preIssuedTelemetryData)) {
				requestMultiline.requestMultiline = false;
			}
			if (requestMultiline.requestMultiline) {
				let adjustedPosition;
				if (prompt.trailingWs.length > 0 && !prompt.prompt.prefix.endsWith(prompt.trailingWs)) {
					adjustedPosition = LocationFactory.position(
						completionState.position.line,
						Math.max(completionState.position.character - prompt.trailingWs.length, 0)
					);
				} else {
					adjustedPosition = completionState.position;
				}
				return {
					blockMode: blockMode,
					requestMultiline: true,
					...instantiationService.invokeFunction(buildFinishedCallback,
						blockMode,
						completionState.textDocument,
						adjustedPosition,
						requestMultiline.blockPosition,
						prefix,
						true,
						prompt.prompt,
						preIssuedTelemetryData
					),
				};
			}
			if (hasAcceptedCurrentCompletion) {
				const result: GhostTextStrategy = {
					blockMode: BlockMode.Parsing,
					requestMultiline: true,
					finishedCb: takeNLines(multilineAfterAcceptLines),
					stop: ['\n\n'],
					maxTokens: maxSinglelineTokens * multilineAfterAcceptLines,
				};
				if (blockMode === BlockMode.MoreMultiline) {
					result.blockMode = BlockMode.MoreMultiline;
				}
				return result;
			}
			return {
				blockMode: blockMode,
				requestMultiline: false,
				...instantiationService.invokeFunction(buildFinishedCallback,
					blockMode,
					completionState.textDocument,
					completionState.position,
					requestMultiline.blockPosition,
					prefix,
					false,
					prompt.prompt,
					preIssuedTelemetryData
				),
			};
		}
	}
}

function buildFinishedCallback(
	accessor: ServicesAccessor,
	blockMode: BlockMode,
	document: TextDocumentContents,
	position: IPosition,
	positionType: BlockPositionType | undefined,
	prefix: string,
	multiline: boolean,
	prompt: Prompt,
	telemetryData: TelemetryWithExp
): { finishedCb: FinishedCallback; maxTokens?: number } {
	const featuresService = accessor.get(ICompletionsFeaturesService);
	const instantiationService = accessor.get(IInstantiationService);
	if (multiline && blockMode === BlockMode.MoreMultiline && BlockTrimmer.isSupported(document.detectedLanguageId)) {
		const lookAhead = positionType === BlockPositionType.EmptyBlock || positionType === BlockPositionType.BlockEnd
			? featuresService.longLookaheadSize(telemetryData)
			: featuresService.shortLookaheadSize(telemetryData);

		const completionsCacheService = accessor.get(ICompletionsCacheService);
		const finishedCb = instantiationService.createInstance(StreamedCompletionSplitter,
			prefix,
			document.detectedLanguageId,
			false,
			lookAhead,
			(extraPrefix: string, item: APIChoice) => {
				const cacheContext = {
					prefix: prefix + extraPrefix,
					prompt: { ...prompt, prefix: prompt.prefix + extraPrefix },
				};
				appendToCache(completionsCacheService, cacheContext, item);
			}
		).getFinishedCallback();

		return {
			finishedCb,
			maxTokens: featuresService.maxMultilineTokens(telemetryData),
		};
	}

	return { finishedCb: multiline ? parsingBlockFinished(document, position) : _ => undefined };
}

type MultilineDetermination = {
	requestMultiline: boolean;
	blockPosition?: BlockPositionType;
};

async function shouldRequestMultiline(
	accessor: ServicesAccessor,
	blockMode: BlockMode,
	document: TextDocumentContents,
	position: IPosition,
	inlineSuggestion: boolean,
	afterAccept: boolean,
	prompt: PromptResponsePresent
): Promise<MultilineDetermination> {

	if (document.lineCount >= 8000) {
		telemetry(
			accessor,
			'ghostText.longFileMultilineSkip',
			TelemetryData.createAndMarkAsIssued({
				languageId: document.detectedLanguageId,
				lineCount: String(document.lineCount),
				currentLine: String(position.line),
			})
		);
	} else {
		if (blockMode === BlockMode.MoreMultiline && BlockTrimmer.isSupported(document.detectedLanguageId)) {
			if (!afterAccept) {
				return { requestMultiline: false };
			}
			const blockPosition = await getBlockPositionType(document, position);
			return { requestMultiline: true, blockPosition };
		}

		const targetLanguagesNewLine = ['typescript', 'typescriptreact'];
		if (targetLanguagesNewLine.includes(document.detectedLanguageId)) {
			const newLine = isNewLine(position, document);
			if (newLine) {
				return { requestMultiline: true };
			}
		}
		let requestMultiline = false;
		if (!inlineSuggestion && isSupportedLanguageId(document.detectedLanguageId)) {
			requestMultiline = await isEmptyBlockStartUtil(document, position);
		} else if (inlineSuggestion && isSupportedLanguageId(document.detectedLanguageId)) {
			requestMultiline =
				(await isEmptyBlockStartUtil(document, position)) ||
				(await isEmptyBlockStartUtil(document, document.lineAt(position).range.end));
		}
		if (!requestMultiline) {
			const requestMultiModelThreshold = 0.5;
			const targetLanguagesModel = ['javascript', 'javascriptreact', 'python'];
			if (targetLanguagesModel.includes(document.detectedLanguageId)) {
				const multiModelScore = requestMultilineScore(prompt.prompt, document.detectedLanguageId);
				requestMultiline = multiModelScore > requestMultiModelThreshold;
			}
		}
		return { requestMultiline };
	}
	return { requestMultiline: false };
}

function isNewLine(selectionPosition: IPosition, doc: TextDocumentContents): boolean {
	const line = doc.lineAt(selectionPosition);
	const lineTrimmed = line.text.trim();
	return lineTrimmed.length === 0;
}

