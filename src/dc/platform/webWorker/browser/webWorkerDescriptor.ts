/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';

export class WebWorkerDescriptor {
	public readonly esmModuleLocation: URI | (() => URI) | undefined;
	public readonly esmModuleLocationBundler: URL | (() => URL) | undefined;
	public readonly label: string;

	constructor(args: {
		esmModuleLocation?: URI | (() => URI);
		esmModuleLocationBundler?: URL | (() => URL);
		label: string;
	}) {
		this.esmModuleLocation = args.esmModuleLocation;
		this.esmModuleLocationBundler = args.esmModuleLocationBundler;
		this.label = args.label;
	}
}
