/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../util/dardcor/base/common/uri';

export const HAS_IGNORED_FILES_MESSAGE = l10n.t('\n\n**Note:** Some files were excluded from the context by `.dardcorignore` rules.');

export const IIgnoreService = createServiceIdentifier<IIgnoreService>('IIgnoreService');

export interface IIgnoreService {

	_serviceBrand: undefined;

	isEnabled: boolean;

	isRegexExclusionsEnabled: boolean;

	dispose(): void;

	init(): Promise<void>;

	isIgnored(file: URI, token?: CancellationToken): Promise<boolean>;

	asMinimatchPattern(): Promise<string | undefined>;
}

export class NullIgnoreService implements IIgnoreService {

	declare readonly _serviceBrand: undefined;

	static readonly Instance = new NullIgnoreService();

	dispose(): void { }

	get isEnabled(): boolean {
		return false;
	}

	get isRegexExclusionsEnabled(): boolean {
		return false;
	}

	async init(): Promise<void> { }

	async isIgnored(file: URI): Promise<boolean> {
		return false;
	}

	async asMinimatchPattern(): Promise<string | undefined> {
		return undefined;
	}
}

export async function filterIngoredResources(ignoreService: IIgnoreService, resources: URI[]): Promise<URI[]> {
	const result: URI[] = [];
	for (const resource of resources) {
		if (!await ignoreService.isIgnored(resource)) {
			result.push(resource);
		}
	}
	return result;
}
