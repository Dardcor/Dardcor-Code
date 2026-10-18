/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export type RemoteAgentHostLocationPreference = 'dedicated' | 'editor';

export function isRemoteAgentHostLocationPreference(value: unknown): value is RemoteAgentHostLocationPreference {
	return value === 'dedicated' || value === 'editor';
}

export const IRemoteAgentHostLocationPreferenceService = createDecorator<IRemoteAgentHostLocationPreferenceService>('remoteAgentHostLocationPreferenceService');

export interface IRemoteAgentHostLocationPreferenceService {
	readonly _serviceBrand: undefined;

	readonly onDidChangePreference: Event<string>;

	getPreference(hostKey: string): RemoteAgentHostLocationPreference | undefined;

	setPreference(hostKey: string, preference: RemoteAgentHostLocationPreference): void;
}
