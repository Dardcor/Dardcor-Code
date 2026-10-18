/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INativeEnvService } from '../../../../platform/env/common/envService';
import { extUriBiasedIgnorePathCase } from '../../../../util/dardcor/base/common/resources';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { createDecorator } from '../../../../util/dardcor/platform/instantiation/common/instantiation';

export const IClaudePlanFileTracker = createDecorator<IClaudePlanFileTracker>('claudePlanFileTracker');

export interface IClaudePlanFileTracker {
	readonly _serviceBrand: undefined;

	recordIfPlanFile(sessionId: string, filePath: string): void;

	getLastPlanFile(sessionId: string): URI | undefined;

	clear(sessionId: string): void;
}

export class ClaudePlanFileTracker implements IClaudePlanFileTracker {
	declare readonly _serviceBrand: undefined;

	private readonly _planDirUri: URI;
	private readonly _lastPlanFiles = new Map<string, URI>();

	constructor(
		@INativeEnvService envService: INativeEnvService,
	) {
		this._planDirUri = URI.joinPath(envService.userHome, '.claude', 'plans');
	}

	public recordIfPlanFile(sessionId: string, filePath: string): void {
		if (!sessionId || !filePath || !filePath.toLowerCase().endsWith('.md')) {
			return;
		}
		const candidate = URI.file(filePath);
		const parent = URI.joinPath(candidate, '..');
		if (!extUriBiasedIgnorePathCase.isEqual(parent, this._planDirUri)) {
			return;
		}
		this._lastPlanFiles.set(sessionId, candidate);
	}

	public getLastPlanFile(sessionId: string): URI | undefined {
		return this._lastPlanFiles.get(sessionId);
	}

	public clear(sessionId: string): void {
		this._lastPlanFiles.delete(sessionId);
	}
}
