/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import type { IProductConfiguration } from './dc/base/common/product.js';

const require = createRequire(import.meta.url);

let productObj: Partial<IProductConfiguration> & { BUILD_INSERT_PRODUCT_CONFIGURATION?: string } = { BUILD_INSERT_PRODUCT_CONFIGURATION: 'BUILD_INSERT_PRODUCT_CONFIGURATION' };
if (productObj['BUILD_INSERT_PRODUCT_CONFIGURATION']) {
	productObj = require('../product.json');
}

let pkgObj = { BUILD_INSERT_PACKAGE_CONFIGURATION: 'BUILD_INSERT_PACKAGE_CONFIGURATION' };
if (pkgObj['BUILD_INSERT_PACKAGE_CONFIGURATION']) {
	pkgObj = require('../package.json');
}

let productOverridesObj = {};
if (process.env['DCCODE_DEV'] || process.env['VSCODE_DEV']) {
	try {
		productOverridesObj = require('../product.overrides.json');
		productObj = Object.assign(productObj, productOverridesObj);
	} catch (error) { }
}

export const product = productObj;
export const pkg = pkgObj;
