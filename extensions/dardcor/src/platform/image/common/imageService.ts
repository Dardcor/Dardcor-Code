/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';

export const IImageService = createServiceIdentifier<IImageService>('IImageService');

export interface IImageService {
	readonly _serviceBrand: undefined;

	resizeImage(data: Uint8Array, mimeType: string): Promise<{ data: Uint8Array; mimeType: string }>;
}

export const nullImageService: IImageService = {
	_serviceBrand: undefined,
	async resizeImage(data: Uint8Array, mimeType: string): Promise<{ data: Uint8Array; mimeType: string }> {
		return { data, mimeType };
	}
};
