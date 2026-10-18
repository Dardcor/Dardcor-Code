/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DardcorNamedAnnotationList } from '../../../../../../../platform/completions-core/common/openai/dardcorAnnotations';
import { RequestId } from '../../../../../../../platform/networking/common/fetch';
import { TelemetryWithExp } from '../../../../lib/src/telemetry';
import { IRange } from '../../../../lib/src/textDocument';

export interface UnformattedSolution {
	completionText: string;
	insertText: string;
	range: IRange;
	meanProb: number;
	meanLogProb: number;
	requestId: RequestId;
	choiceIndex: number;
	telemetryData: TelemetryWithExp;
	dardcorAnnotations?: DardcorNamedAnnotationList;
	modelId?: string;
}

export interface ISolutionHandler {
	onSolution(solution: UnformattedSolution): Promise<void> | void;
	onFinishedNormally(): Promise<void> | void;
	onFinishedWithError(error: string): Promise<void> | void;
}

export type SolutionsStream =
	| { status: 'FinishedNormally' }
	| { status: 'FinishedWithError'; error: string }
	| { status: 'Solution'; solution: UnformattedSolution; next: Promise<SolutionsStream> };
