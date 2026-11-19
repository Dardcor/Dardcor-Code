/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from './toolNames';

export type EditTools = ToolName.ApplyPatch | ToolName.ReplaceString | ToolName.EditFile | ToolName.MultiReplaceString;


export interface IEditToolLearningData {
	state: State;
	tools: { [K in EditTools]?: ToolLearningData };
}

export const enum LearningConfig {
	WINDOW_SIZE = 100,
	CACHE_SIZE = 50,
	MIN_SAMPLE_SIZE = LearningConfig.WINDOW_SIZE * (2 / 3),
	SR_SUCCESS_THRESHOLD = 0.8,
	SR_FAILURE_THRESHOLD = 0.3,
	MULTISR_SUCCESS_THRESHOLD = 0.7,
	MULTISR_FAILURE_THRESHOLD = 0.4,
}

export const enum State {
	Initial,
	ReplaceStringForced,
	ReplaceStringMaybeMulti,
	EditFileOnly,
	ReplaceStringOnly,
	ReplaceStringWithMulti,
}


interface StateConfig {
	allowedTools: EditTools[];
	transitions?: { [K in State]?: (data: IEditToolLearningData) => boolean };
}


interface ToolLearningData {
	successBitset: bigint;
	attempts: number;
}

function getSuccessRate(successBitset: bigint, totalAttempts: number): number {
	if (totalAttempts === 0) {
		return 0;
	}

	const actualBits = Math.min(totalAttempts, LearningConfig.WINDOW_SIZE);
	let successCount = 0;

	for (let i = 0; i < actualBits; i++) {
		if ((successBitset >> BigInt(i)) & 1n) {
			successCount++;
		}
	}

	return successCount / actualBits;
}


function sampleSize(data: IEditToolLearningData, tool: EditTools): number {
	return Math.min(data.tools[tool]?.attempts || 0, LearningConfig.WINDOW_SIZE);
}

function successRate(data: IEditToolLearningData, tool: EditTools): number {
	const toolData = data.tools[tool];
	if (!toolData) { return 0; }
	return getSuccessRate(toolData.successBitset, toolData.attempts);
}

export const EDIT_TOOL_LEARNING_STATES: Record<State, StateConfig> = {
	[State.Initial]: {
		allowedTools: [ToolName.EditFile, ToolName.ReplaceString],
		transitions: {
			[State.ReplaceStringMaybeMulti]: d =>
				sampleSize(d, ToolName.ReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.ReplaceString) > LearningConfig.SR_SUCCESS_THRESHOLD,
			[State.EditFileOnly]: d =>
				sampleSize(d, ToolName.ReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.ReplaceString) < LearningConfig.SR_FAILURE_THRESHOLD,
			[State.ReplaceStringForced]: d => {
				const editFileAttempts = sampleSize(d, ToolName.EditFile);
				const replaceStringAttempts = sampleSize(d, ToolName.ReplaceString);
				return editFileAttempts > LearningConfig.MIN_SAMPLE_SIZE && editFileAttempts / (editFileAttempts + replaceStringAttempts) > 0.7;
			},
		},
	},
	[State.ReplaceStringForced]: {
		allowedTools: [ToolName.ReplaceString],
		transitions: {
			[State.ReplaceStringMaybeMulti]: d =>
				sampleSize(d, ToolName.ReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.ReplaceString) > LearningConfig.SR_SUCCESS_THRESHOLD,
			[State.EditFileOnly]: d =>
				sampleSize(d, ToolName.ReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.ReplaceString) < LearningConfig.SR_FAILURE_THRESHOLD,
		},
	},
	[State.ReplaceStringMaybeMulti]: {
		allowedTools: [ToolName.ReplaceString, ToolName.MultiReplaceString],
		transitions: {
			[State.ReplaceStringWithMulti]: d =>
				sampleSize(d, ToolName.MultiReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.MultiReplaceString) > LearningConfig.MULTISR_SUCCESS_THRESHOLD,
			[State.ReplaceStringOnly]: d =>
				sampleSize(d, ToolName.MultiReplaceString) > LearningConfig.MIN_SAMPLE_SIZE &&
				successRate(d, ToolName.MultiReplaceString) < LearningConfig.MULTISR_FAILURE_THRESHOLD,
		},
	},

	[State.EditFileOnly]: {
		allowedTools: [ToolName.EditFile],
	},
	[State.ReplaceStringOnly]: {
		allowedTools: [ToolName.ReplaceString],
	},
	[State.ReplaceStringWithMulti]: {
		allowedTools: [ToolName.ReplaceString, ToolName.MultiReplaceString],
	},
};
