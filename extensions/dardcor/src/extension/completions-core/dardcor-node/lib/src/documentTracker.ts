/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { LRUCacheMap } from './helpers/cache';
import { TextDocumentIdentifier } from './textDocument';
import { ICompletionsTextDocumentManagerService } from './textDocumentManager';

export const accessTimes = new LRUCacheMap<string, number>();

export function sortByAccessTimes<T extends TextDocumentIdentifier>(docs: readonly T[]): T[] {
	return [...docs].sort((a, b) => {
		const aAccessTime = accessTimes.get(a.uri) ?? 0;
		const bAccessTime = accessTimes.get(b.uri) ?? 0;
		return bAccessTime - aAccessTime;
	});
}

export const registerDocumentTracker = (accessor: ServicesAccessor) =>
	accessor.get(ICompletionsTextDocumentManagerService).onDidFocusTextDocument(e => {
		if (e.document) {
			accessTimes.set(e.document.uri.toString(), Date.now());
		}
	});
