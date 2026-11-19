/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { ILinesDiffComputerOptions, MovedText } from '../../../util/dardcor/editor/common/diff/linesDiffComputer';
import { DetailedLineRangeMapping } from '../../../util/dardcor/editor/common/diff/rangeMapping';


export const IDiffService = createServiceIdentifier<IDiffService>('IDiffService');

export interface IDiffService {

	readonly _serviceBrand: undefined;

	computeDiff(original: string, modified: string, options: ILinesDiffComputerOptions): Promise<IDocumentDiff>;
}

export interface IDocumentDiff {
	readonly identical: boolean;

	readonly quitEarly: boolean;

	readonly changes: readonly DetailedLineRangeMapping[];

	readonly moves: readonly MovedText[];
}
