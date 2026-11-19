/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProviderId } from '../../../../../../editor/common/languages.js';
import { EditDeltaInfo, EditSuggestionId } from '../../../../../../editor/common/textModelEditSource.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';

export const IAiEditTelemetryService = createDecorator<IAiEditTelemetryService>('aiEditTelemetryService');

export interface IAiEditTelemetryService {
	readonly _serviceBrand: undefined;

	createSuggestionId(data: Omit<IEditTelemetryCodeSuggestedData, 'suggestionId'>): EditSuggestionId;

	handleCodeAccepted(data: IEditTelemetryCodeAcceptedData): void;

	handleCodeRejected(data: IEditTelemetryCodeRejectedData): void;
}

export interface IEditTelemetryBaseData {
	suggestionId: EditSuggestionId | undefined;

	feature:
	| 'sideBarChat'
	| 'inlineChat'
	| 'inlineSuggestion'
	| undefined;

	presentation:
	| 'codeBlock'
	| 'highlightedEdit'
	| 'inlineCompletion'
	| 'nextEditSuggestion';

	source: ProviderId | undefined;

	languageId: string | undefined;

	editDeltaInfo: EditDeltaInfo | undefined;

	modeId:
	| 'ask'
	| 'edit'
	| 'agent'
	| 'custom'
	| 'applyCodeBlock'
	| undefined;
	applyCodeBlockSuggestionId: EditSuggestionId | undefined;

	modelId: string | undefined;

	sourceRequestId: string | undefined;

	isAgentHostSession?: boolean;
}

export interface IEditTelemetryCodeSuggestedData extends IEditTelemetryBaseData {
}

export interface IEditTelemetryCodeAcceptedData extends IEditTelemetryBaseData {
	acceptanceMethod:
	| 'insertAtCursor'
	| 'insertInNewFile'
	| 'copyManual'
	| 'copyButton'
	| 'accept';
}

export interface IEditTelemetryCodeRejectedData extends IEditTelemetryBaseData {
	rejectionMethod:
	| 'reject';
}
