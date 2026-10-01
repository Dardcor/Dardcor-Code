/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../util/dardcor/base/common/assert';
import { IResponseDelta, ResponsePart, ResponsePartKind } from './fetch';

/**
 * Converts a ResponsePart to an IResponseDelta.
 * For non-content parts, the text is set to an empty string.
 * @param part The ResponsePart to convert
 */
export const toResponseDelta = (part: ResponsePart): IResponseDelta => {
	switch (part.kind) {
		case ResponsePartKind.ContentDelta:
			return { text: part.delta };
		case ResponsePartKind.Content:
			return { text: part.content, logprobs: part.logProbs };
		case ResponsePartKind.Annotation:
			return {
				text: '',
				codeVulnAnnotations: part.codeVulnAnnotations,
				ipCitations: part.ipCitations,
				dardcorReferences: part.dardcorReferences
			};
		case ResponsePartKind.Confirmation:
			return {
				text: '',
				dardcorConfirmation: part,
			};
		case ResponsePartKind.Error:
			return {
				text: '',
				dardcorErrors: [part.error]
			};
		case ResponsePartKind.ToolCallDelta:
			return {
				text: '',
				dardcorToolCalls: [{
					name: part.name,
					arguments: part.delta,
					id: part.partId
				}]
			};
		case ResponsePartKind.ToolCall:
			return {
				text: '',
				dardcorToolCalls: [{
					name: part.name,
					arguments: part.arguments,
					id: part.id
				}]
			};
		case ResponsePartKind.ThinkingDelta:
			return { text: '' };
		case ResponsePartKind.Thinking:
			return { text: '' }; // todo@karthiknadig/@connor4312: do we still need this back-compat with responses API?
		default:
			assertNever(part);
	}
};

const staticContentUUID = '8444605d-6c67-42c5-bbcb-a04b83f9f76e';


/**
 * Converts an IResponseDelta to a ResponsePart.
 * For non-content deltas, the text is ignored.
 * @param delta The IResponseDelta to convert
 */
export function* fromResponseDelta(delta: IResponseDelta): Iterable<ResponsePart> {
	if (delta.text && delta.text.length > 0) {
		yield {
			kind: ResponsePartKind.ContentDelta,
			partId: staticContentUUID,
			delta: delta.text
		};
	}
	if (delta.codeVulnAnnotations?.length || delta.ipCitations?.length || delta.dardcorReferences?.length) {
		yield {
			kind: ResponsePartKind.Annotation,
			codeVulnAnnotations: delta.codeVulnAnnotations,
			ipCitations: delta.ipCitations,
			dardcorReferences: delta.dardcorReferences
		};
	}
	if (delta.dardcorErrors && delta.dardcorErrors.length > 0) {
		yield {
			kind: ResponsePartKind.Error,
			error: delta.dardcorErrors[0]
		};
	}
	if (delta.dardcorToolCalls && delta.dardcorToolCalls.length > 0) {
		for (const toolCall of delta.dardcorToolCalls) {
			yield {
				kind: ResponsePartKind.ToolCall,
				partId: toolCall.id,
				name: toolCall.name,
				arguments: toolCall.arguments,
				id: toolCall.id
			};
		}
	}
	if (delta.thinking) {
		yield {
			kind: ResponsePartKind.ThinkingDelta,
			partId: '', // Unknown, must be set by caller if needed
			delta: delta.thinking
		};
	}
	if (delta.dardcorConfirmation) {
		yield {
			kind: ResponsePartKind.Confirmation,
			title: delta.dardcorConfirmation.title,
			message: delta.dardcorConfirmation.message,
			confirmation: delta.dardcorConfirmation.confirmation
		};
	}
}
