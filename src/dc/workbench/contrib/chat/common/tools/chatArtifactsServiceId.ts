/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import type { IChatArtifacts } from './chatArtifactsService.js';

export const IChatArtifactsService = createDecorator<IChatArtifactsService>('chatArtifactsService');

export interface IChatArtifactsService {
	readonly _serviceBrand: undefined;
	getArtifacts(sessionResource: URI): IChatArtifacts;
}
