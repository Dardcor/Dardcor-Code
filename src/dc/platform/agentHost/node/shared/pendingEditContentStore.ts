/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeHex, VSBuffer } from '../../../../base/common/buffer.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../files/common/inMemoryFilesystemProvider.js';

export const PENDING_EDIT_CONTENT_SCHEME = 'pending-edit-content';

export function buildPendingEditContentUri(sessionUri: string, toolCallId: string, filePath: string): URI {
	return URI.from({
		scheme: PENDING_EDIT_CONTENT_SCHEME,
		authority: encodeHex(VSBuffer.fromString(sessionUri)).toString(),
		path: `/${encodeURIComponent(toolCallId)}/${encodeHex(VSBuffer.fromString(filePath))}`,
	});
}

export function registerPendingEditContentProvider(fileService: IFileService): IDisposable {
	const provider = new InMemoryFileSystemProvider();
	const registration = fileService.registerProvider(PENDING_EDIT_CONTENT_SCHEME, provider);
	return {
		dispose() {
			registration.dispose();
			provider.dispose();
		},
	};
}
