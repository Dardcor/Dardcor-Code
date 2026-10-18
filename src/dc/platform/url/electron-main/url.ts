/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IWindowOpenable } from '../../window/common/window.js';

export interface IProtocolUrl {

	uri: URI;

	originalUrl: string;
}

export interface IInitialProtocolUrls {

	readonly urls: IProtocolUrl[];

	readonly openables: IWindowOpenable[];
}
