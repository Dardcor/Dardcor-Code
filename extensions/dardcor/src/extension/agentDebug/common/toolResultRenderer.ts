/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';

export const IToolResultContentRenderer = createServiceIdentifier<IToolResultContentRenderer>('IToolResultContentRenderer');

export interface IToolResultContentRenderer {
	readonly _serviceBrand: undefined;

	renderToolResultContent(content: Iterable<unknown>): string[];
}
