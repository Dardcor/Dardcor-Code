/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { UnsupportedProtocolVersionErrorData } from './protocol/errors.js';
import type { Mutable } from '../../../../base/common/types.js';

export const VSCODE_UPGRADE_METHOD = '_vscodeUpgrade' as const;

export interface IVscodeUpgradeResult {
	readonly ok: boolean;
	readonly upgradeNeeded?: boolean;
	readonly upgradeStarted?: boolean;
	readonly runningCommit?: string | null;
	readonly latestCommit?: string;
	readonly restartDelayMs?: number;
	readonly error?: string;
}

export interface UnsupportedProtocolVersionErrorMeta {
	readonly vscodeUpgradeMethod?: string;
}

export interface UnsupportedProtocolVersionErrorDataEx extends UnsupportedProtocolVersionErrorData {
	readonly _meta?: UnsupportedProtocolVersionErrorMeta;
}

export function readUnsupportedProtocolVersionErrorMeta(data: unknown): UnsupportedProtocolVersionErrorMeta | undefined {
	if (!data || typeof data !== 'object') {
		return undefined;
	}
	const meta = (data as Record<string, unknown>)['_meta'];
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		return undefined;
	}
	const raw = meta as Record<string, unknown>;
	const result: Mutable<UnsupportedProtocolVersionErrorMeta> = {};
	if (typeof raw['vscodeUpgradeMethod'] === 'string') {
		result.vscodeUpgradeMethod = raw['vscodeUpgradeMethod'];
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
