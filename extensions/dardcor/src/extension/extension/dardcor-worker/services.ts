/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { IInstantiationServiceBuilder } from '../../../util/common/services';
import { registerServices as registerCommonServices } from '../dardcor/services';


export function registerServices(builder: IInstantiationServiceBuilder, extensionContext: ExtensionContext): void {
	registerCommonServices(builder, extensionContext);
}
