/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { fromAgentHostUri } from './agentHostUri.js';

export const AGENT_BUILTIN_CUSTOMIZATION_SCHEME = 'agent-builtin';

export function isAgentBuiltinCustomizationUri(resource: URI): boolean {
	return fromAgentHostUri(resource).scheme === AGENT_BUILTIN_CUSTOMIZATION_SCHEME;
}

export function hasReadableCustomizationContent(resource: URI): boolean {
	return !isAgentBuiltinCustomizationUri(resource);
}
