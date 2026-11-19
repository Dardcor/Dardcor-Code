/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IExtUri } from '../../../base/common/resources.js';


export const IUriIdentityService = createDecorator<IUriIdentityService>('IUriIdentityService');

export interface IUriIdentityService {

	readonly _serviceBrand: undefined;

	readonly extUri: IExtUri;

	asCanonicalUri(uri: URI): URI;
}
