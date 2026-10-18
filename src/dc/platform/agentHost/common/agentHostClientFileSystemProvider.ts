/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { AHPFileSystemProvider } from './agentHostFileSystemProvider.js';
import { fromAgentClientUri, toAgentClientUri } from './agentClientUri.js';

export class AgentHostClientFileSystemProvider extends AHPFileSystemProvider {

	protected _decodeUri(resource: URI): URI {
		return fromAgentClientUri(resource);
	}

	protected _encodeUri(resource: URI, authority: string): URI {
		return toAgentClientUri(resource, authority);
	}
}
