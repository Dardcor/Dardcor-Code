/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IURLService = createDecorator<IURLService>('urlService');

export interface IOpenURLOptions {

	trusted?: boolean;

	originalUrl?: string;
}

export interface IURLHandler {
	handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean>;
}

export interface IURLService {

	readonly _serviceBrand: undefined;

	create(options?: Partial<UriComponents>): URI;

	open(url: URI, options?: IOpenURLOptions): Promise<boolean>;

	registerHandler(handler: IURLHandler): IDisposable;
}
