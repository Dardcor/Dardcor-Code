/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI, StringOrMarkdown, TextRange } from '../common/state.js';


export interface AnnotationsSummary {
	resource: URI;
	annotationCount: number;
	entryCount: number;
}


export interface AnnotationsState {
	annotations: Annotation[];
}

export interface AnnotationOrigin {
	session: URI;
	chat?: URI;
	turnId?: string;
}


export interface Annotation {
	id: string;
	origin: AnnotationOrigin;
	resource: URI;
	range?: TextRange;
	resolved: boolean;
	entries: AnnotationEntry[];
	_meta?: Record<string, unknown>;
}


export interface AnnotationEntry {
	id: string;
	text: StringOrMarkdown;
	_meta?: Record<string, unknown>;
}
