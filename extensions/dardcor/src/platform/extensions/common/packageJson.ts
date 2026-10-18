/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPackageJson {
	name: string;
	version: string;

	contributes?: {
		debuggers?: IDebugConfigSchema[];
	};

	dardcor?: {
		tests?: {
			setupTests?: string;
			getSetupConfirmation?: string;
		};
	};
}


export interface IDebugConfigSchema {
	type: string;
	deprecated: boolean;
	configurationAttributes: {
		tags: string[];
		attach: { properties: { [key: string]: { description?: string; markdownDescription?: string } } };
		launch: { properties: { [key: string]: { description?: string; markdownDescription?: string } } };
	};
}
