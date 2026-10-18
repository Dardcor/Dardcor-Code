/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../../../../platform/log/common/logService';
import { IInstantiationService, type ServicesAccessor } from '../../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { asyncIterableMapFilter } from '../../../../lib/src/helpers/iterableHelpers';
import { Logger } from '../../../../lib/src/logger';
import { DardcorInlineUiKind, ICompletionsOpenAIFetcherService } from '../../../../lib/src/openai/fetch';
import { APIChoice } from '../../../../lib/src/openai/openai';
import { ICompletionsStatusReporter } from '../../../../lib/src/progress';
import { getNodeStartUtil } from '../../../../lib/src/prompt/parseBlock';
import { trimLastLine } from '../../../../lib/src/prompt/prompt';
import { postProcessChoiceInContext } from '../../../../lib/src/suggestions/suggestions';
import { LocationFactory } from '../../../../lib/src/textDocument';
import {
	generateSolutionsStream,
	reportSolutions,
	setupCompletionParams,
	setupPromptAndTelemetry,
	SolutionManager,
	trimChoices,
} from '../panelShared/common';
import { ISolutionHandler, SolutionsStream, UnformattedSolution } from '../panelShared/panelTypes';

const solutionsLogger = new Logger('solutions');

export async function launchSolutions(accessor: ServicesAccessor, solutionManager: SolutionManager): Promise<SolutionsStream> {
	const instantiationService = accessor.get(IInstantiationService);
	const fetcherService = accessor.get(ICompletionsOpenAIFetcherService);
	const logger = accessor.get(ILogService).createSubLogger('solutions');
	const position = solutionManager.targetPosition;
	const document = solutionManager.textDocument;

	const promptSetup = await setupPromptAndTelemetry(accessor, solutionManager, 'open dardcor', solutionsLogger);
	if ('status' in promptSetup) {
		return promptSetup;
	}

	const { prompt, trailingWs, telemetryData, repoInfo, ourRequestId } = promptSetup;

	const { extra, postOptions, finishedCb, engineInfo } = instantiationService.invokeFunction(setupCompletionParams,
		document,
		position,
		prompt,
		solutionManager,
		telemetryData
	);

	const cancellationToken = solutionManager.cancellationToken;

	const completionParams = {
		prompt,
		languageId: document.detectedLanguageId,
		repoInfo,
		ourRequestId,
		engineModelId: engineInfo.modelId,
		count: solutionManager.solutionCountTarget,
		uiKind: DardcorInlineUiKind.Panel,
		postOptions,
		headers: engineInfo.headers,
		extra,
	};

	const res = await fetcherService.fetchAndStreamCompletions(completionParams, telemetryData.extendedBy(), finishedCb, cancellationToken);

	if (res.type === 'failed' || res.type === 'canceled') {
		return { status: 'FinishedWithError', error: `${res.type}: ${res.reason}` };
	}

	let choices: AsyncIterable<APIChoice> = res.choices;
	choices = trimChoices(choices);
	choices = asyncIterableMapFilter(choices, choice => instantiationService.invokeFunction(postProcessChoiceInContext, document, position, choice, false, logger));

	const solutions = asyncIterableMapFilter(choices, async (apiChoice: APIChoice) => {
		let display = apiChoice.completionText;
		logger.info(`Open panel completion: [${apiChoice.completionText}]`);

		const displayStartPos =
			(await getNodeStartUtil(document, position, apiChoice.completionText)) ??
			LocationFactory.position(position.line, 0);
		const [displayBefore] = trimLastLine(document.getText(LocationFactory.range(displayStartPos, position)));

		display = displayBefore + display;
		let completionText = apiChoice.completionText;

		if (trailingWs.length > 0 && completionText.startsWith(trailingWs)) {
			completionText = completionText.substring(trailingWs.length);
		}

		const meanLogProb = apiChoice.meanLogProb;
		const meanProb: number = meanLogProb !== undefined ? Math.exp(meanLogProb) : 0;

		const solutionTelemetryData = telemetryData.extendedBy({
			choiceIndex: apiChoice.choiceIndex.toString(),
		});
		const solution: UnformattedSolution = {
			completionText,
			insertText: display,
			range: LocationFactory.range(displayStartPos, position),
			meanProb: meanProb,
			meanLogProb: meanLogProb || 0,
			requestId: apiChoice.requestId,
			choiceIndex: apiChoice.choiceIndex,
			telemetryData: solutionTelemetryData,
			dardcorAnnotations: apiChoice.dardcorAnnotations,
		};
		return solution;
	});
	const solutionsStream = generateSolutionsStream(cancellationToken, solutions[Symbol.asyncIterator]());
	return solutionsStream;
}

export async function runSolutions(
	accessor: ServicesAccessor,
	solutionManager: SolutionManager,
	solutionHandler: ISolutionHandler
): Promise<void> {
	const instantiationService = accessor.get(IInstantiationService);
	const statusReporter = accessor.get(ICompletionsStatusReporter);
	return statusReporter.withProgress(async () => {
		const nextSolution = instantiationService.invokeFunction(launchSolutions, solutionManager);
		return await reportSolutions(nextSolution, solutionHandler);
	});
}
