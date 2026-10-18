/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment } from '../../../common/platform.js';
import { IProductConfiguration } from '../../../common/product.js';




export interface ISandboxConfiguration {

	windowId: number;

	appRoot: string;

	userEnv: IProcessEnvironment;

	product: IProductConfiguration;

	zoomLevel?: number;

	codeCachePath?: string;

	nls: {

		messages: string[];

		language: string | undefined;
	};

	cssModules?: string[];
}
