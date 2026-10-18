/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI, ContentRef, StringOrMarkdown, TextRange } from '../common/state.js';
import type { BaseParams } from '../common/commands.js';


export const enum ChangesetOperationTargetKind {
	Resource = 'resource',
	Range = 'range',
}

export type ChangesetOperationTarget =
	| { kind: ChangesetOperationTargetKind.Resource; resource: URI; side?: 'before' | 'after' }
	| { kind: ChangesetOperationTargetKind.Range; resource: URI; side?: 'before' | 'after'; range: TextRange };

export interface ChangesetOperationFollowUp {
	content: ContentRef;
	external?: boolean;
}

export interface InvokeChangesetOperationParams extends BaseParams {
	channel: URI;
	operationId: string;
	target?: ChangesetOperationTarget;
}

export interface InvokeChangesetOperationResult {
	message?: StringOrMarkdown;
	followUp?: ChangesetOperationFollowUp;
}
