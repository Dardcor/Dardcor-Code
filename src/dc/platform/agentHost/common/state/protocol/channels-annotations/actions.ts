/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { URI, TextRange } from '../common/state.js';
import type { AnnotationEntry, Annotation, AnnotationOrigin } from './state.js';


export interface AnnotationsSetAction {
	type: ActionType.AnnotationsSet;
	annotation: Annotation;
}

export interface AnnotationsUpdatedAction {
	type: ActionType.AnnotationsUpdated;
	annotationId: string;
	origin?: AnnotationOrigin;
	resource?: URI;
	range?: TextRange;
	resolved?: boolean;
}

export interface AnnotationsRemovedAction {
	type: ActionType.AnnotationsRemoved;
	annotationId: string;
}

export interface AnnotationsEntrySetAction {
	type: ActionType.AnnotationsEntrySet;
	annotationId: string;
	entry: AnnotationEntry;
}

export interface AnnotationsEntryRemovedAction {
	type: ActionType.AnnotationsEntryRemoved;
	annotationId: string;
	entryId: string;
}
