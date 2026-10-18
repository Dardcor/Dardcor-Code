/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CHAT_MODEL_FEEDBACK_SURVEY_TELEMETRY_COMMAND_ID = '_github.copilot.chat.reportModelFeedbackSurvey';

export type ChatModelFeedbackSurveyEventKind =
	| 'shown'
	| 'opened'
	| 'step'
	| 'submitted'
	| 'dismissed';

export interface IChatModelFeedbackSurveyTelemetryEvent {
	readonly kind: ChatModelFeedbackSurveyEventKind;
	readonly surveyId: string;
	readonly surveyInstanceId: string;
	readonly stepCount: number;
	readonly trigger?: 'manual' | 'chance' | 'modelSwitchedAway';
	readonly stepId?: string;
	readonly stepIndex?: number;
	readonly answerId?: string;
	readonly comment?: string;
	readonly modelId?: string;
	readonly resolvedModelId?: string;
	readonly modeId?: string;
	readonly harness?: string;
	readonly sessionType?: string;
	readonly requestId: string;
}
