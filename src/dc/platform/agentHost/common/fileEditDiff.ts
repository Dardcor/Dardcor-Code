/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { isEqual } from '../../../base/common/resources.js';
import { canonicalizeSessionDbUri } from './sessionDbUri.js';
import type { FileEdit } from './state/protocol/state.js';
import { FileEditKind } from './state/sessionState.js';

export interface INormalizedFileEdit {
	readonly kind: FileEditKind;
	readonly resource: URI;
	readonly beforeUri?: URI;
	readonly afterUri?: URI;
	readonly beforeContentUri?: URI;
	readonly afterContentUri?: URI;
}

export function normalizeFileEdit(edit: FileEdit): INormalizedFileEdit | undefined {
	const beforeUri = edit.before ? URI.parse(edit.before.uri) : undefined;
	const afterUri = edit.after ? URI.parse(edit.after.uri) : undefined;

	const resource = afterUri ?? beforeUri;
	if (!resource) {
		return undefined;
	}

	let kind: FileEditKind;
	if (!beforeUri && afterUri) {
		kind = FileEditKind.Create;
	} else if (beforeUri && !afterUri) {
		kind = FileEditKind.Delete;
	} else if (beforeUri && afterUri && !isEqual(beforeUri, afterUri)) {
		kind = FileEditKind.Rename;
	} else {
		kind = FileEditKind.Edit;
	}

	return {
		kind,
		resource,
		beforeUri,
		afterUri,
		beforeContentUri: edit.before?.content.uri && beforeUri ? canonicalizeSessionDbUri(URI.parse(edit.before.content.uri), beforeUri) : undefined,
		afterContentUri: edit.after?.content.uri && afterUri ? canonicalizeSessionDbUri(URI.parse(edit.after.content.uri), afterUri) : undefined,
	};
}
