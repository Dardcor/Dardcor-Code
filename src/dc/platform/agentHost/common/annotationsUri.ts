/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from './state/sessionState.js';


const ANNOTATIONS_PATH_SEGMENT = '/annotations';

export function buildAnnotationsUri(sessionUri: URI): URI {
	return `${sessionUri}${ANNOTATIONS_PATH_SEGMENT}`;
}

export function parseAnnotationsUri(uri: URI): { sessionUri: URI } | undefined {
	if (!uri.endsWith(ANNOTATIONS_PATH_SEGMENT)) {
		return undefined;
	}
	const sessionUri = uri.slice(0, uri.length - ANNOTATIONS_PATH_SEGMENT.length);
	if (!sessionUri) {
		return undefined;
	}
	return { sessionUri };
}

export function isAnnotationsUri(uri: URI): boolean {
	return parseAnnotationsUri(uri) !== undefined;
}
