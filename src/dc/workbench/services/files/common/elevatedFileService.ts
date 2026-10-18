/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { IFileStatWithMetadata, IWriteFileOptions } from '../../../../platform/files/common/files.js';

export const IElevatedFileService = createDecorator<IElevatedFileService>('elevatedFileService');

export interface IElevatedFileService {

	readonly _serviceBrand: undefined;

	isSupported(resource: URI): boolean;

	writeFileElevated(resource: URI, value: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata>;
}
