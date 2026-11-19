/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IProtocolMainService = createDecorator<IProtocolMainService>('protocolMainService');

export interface IIPCObjectUrl<T> extends IDisposable {

	resource: URI;

	update(obj: T): void;
}

export interface IProtocolMainService {

	readonly _serviceBrand: undefined;

	createIPCObjectUrl<T>(): IIPCObjectUrl<T>;

	addValidFileRoot(root: string): IDisposable;
}
