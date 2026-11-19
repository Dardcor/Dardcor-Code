/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { FileService } from '../../../../files/common/fileService.js';
import { IFileService } from '../../../../files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../log/common/log.js';

export const claudeTestWorkspace = URI.from({ scheme: Schemas.inMemory, path: '/workspace' });

export const claudeTestUserHome = URI.from({ scheme: Schemas.inMemory, path: '/home' });

export function createInMemoryFileService(disposables: DisposableStore): IFileService {
	const fileService = disposables.add(new FileService(new NullLogService()));
	disposables.add(fileService.registerProvider(Schemas.inMemory, disposables.add(new InMemoryFileSystemProvider())));
	return fileService;
}

export async function seedFile(fileService: IFileService, path: string, content = ''): Promise<URI> {
	const uri = URI.from({ scheme: Schemas.inMemory, path });
	await fileService.writeFile(uri, VSBuffer.fromString(content));
	return uri;
}
