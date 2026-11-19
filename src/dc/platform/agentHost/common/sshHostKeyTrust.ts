/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface ISSHTrustedHostKey {
	readonly keyType: string;
	readonly fingerprint: string;
	readonly addedAt: number;
	readonly alias?: string;
}

export interface ISSHTrustedHost {
	readonly host: string;
	readonly port: number;
	readonly keys: readonly ISSHTrustedHostKey[];
}

export function computeHostKeyStoreKey(host: string, port: number): string {
	return `${host.toLowerCase()}:${port}`;
}

export const ISSHHostKeyTrustService = createDecorator<ISSHHostKeyTrustService>('sshHostKeyTrustService');

export interface ISSHHostKeyTrustService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeTrustedHosts: Event<string>;

	getTrustedKeys(host: string, port: number): readonly ISSHTrustedHostKey[];

	trustHostKey(host: string, port: number, key: ISSHTrustedHostKey): void;

	forgetHost(host: string, port: number): void;

	listTrustedHosts(): readonly ISSHTrustedHost[];
}
