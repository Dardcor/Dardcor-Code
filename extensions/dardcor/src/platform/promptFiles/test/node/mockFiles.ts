/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname } from '../../../../util/dardcor/base/common/resources';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { MockFileSystemService } from '../../../filesystem/node/test/mockFileSystemService';

export interface IMockFileEntry {
	readonly path: string;
	readonly contents: readonly string[];
}

export async function mockFiles(fileSystem: MockFileSystemService, entries: readonly IMockFileEntry[]): Promise<void> {
	for (const entry of entries) {
		const uri = URI.file(entry.path);
		await fileSystem.createDirectory(dirname(uri));
		const text = entry.contents.join('\n');
		await fileSystem.writeFile(uri, new TextEncoder().encode(text));
	}
}
