/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../common/lifecycle.js';
import { Client as MessagePortClient } from '../common/ipc.mp.js';

export class Client extends MessagePortClient implements IDisposable {

	constructor(port: MessagePort, clientId: string) {
		super(port, clientId);
	}
}
