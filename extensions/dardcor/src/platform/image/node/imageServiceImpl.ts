/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IImageService } from '../common/imageService';

export class ImageServiceImpl implements IImageService {
	declare readonly _serviceBrand: undefined;

	async resizeImage(data: Uint8Array, mimeType: string): Promise<{ data: Uint8Array; mimeType: string }> {
		return { data, mimeType };
	}
}
