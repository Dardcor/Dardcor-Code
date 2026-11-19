/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContributionFactory } from '../../common/contributions';
import vscodeContributions from '../dardcor/contributions';


export const vscodeWebContributions: IExtensionContributionFactory[] = [
	...vscodeContributions,
];
