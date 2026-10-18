/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ExtHostBrowserTunnelProxyShape } from './extHost.protocol.js';

export const IExtHostBrowserTunnelProxy = createDecorator<IExtHostBrowserTunnelProxy>('IExtHostBrowserTunnelProxy');

export interface IExtHostBrowserTunnelProxy extends ExtHostBrowserTunnelProxyShape {
	readonly _serviceBrand: undefined;
}

export class ExtHostBrowserTunnelProxy implements IExtHostBrowserTunnelProxy {
	declare readonly _serviceBrand: undefined;

	$setEnabled(_enabled: boolean): void {
	}
}
