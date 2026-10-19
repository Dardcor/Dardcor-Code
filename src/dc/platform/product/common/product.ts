/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductConfiguration } from '../../../base/common/product.js';
import { ISandboxConfiguration } from '../../../base/parts/sandbox/common/sandboxTypes.js';

let product: IProductConfiguration;

const vscodeGlobal = (globalThis as { vscode?: { context?: { configuration(): ISandboxConfiguration | undefined } } }).vscode;
if (typeof vscodeGlobal !== 'undefined' && typeof vscodeGlobal.context !== 'undefined') {
	const configuration: ISandboxConfiguration | undefined = vscodeGlobal.context.configuration();
	if (configuration) {
		product = configuration.product;
	} else {
		throw new Error('Sandbox: unable to resolve product configuration from preload script.');
	}
}
else if ((globalThis as any)._VSCODE_PRODUCT_JSON && (globalThis as any)._VSCODE_PACKAGE_JSON) {
	product = (globalThis as any)._VSCODE_PRODUCT_JSON as unknown as IProductConfiguration;
	if (!product.version) {
		Object.assign(product, {
			version: (globalThis as any)._VSCODE_PACKAGE_JSON.version
		});
	}
}

else {

	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	product = { } as unknown as IProductConfiguration;

	if (Object.keys(product).length === 0) {
		Object.assign(product, {
			version: '1.104.0-dev',
			nameShort: 'Code - OSS Dev',
			nameLong: 'Code - OSS Dev',
			applicationName: 'code-oss',
			dataFolderName: '.vscode-oss',
			urlProtocol: 'code-oss',
			reportIssueUrl: 'https://github.com/microsoft/vscode/issues/new',
			licenseName: 'MIT',
			licenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',
			serverLicenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',
			defaultChatAgent: {
				extensionId: 'github.dardcor-chat',
				chatExtensionId: 'github.dardcor-chat',
				provider: {
					default: {
						id: 'dardcor',
						name: 'Dardcor',
					},
					enterprise: {
						id: 'dardcor-enterprise',
						name: 'Dardcor Enterprise',
					}
				},
				providerScopes: []
			},
			extensionUntrustedWorkspaceSupport: {
				'github.dardcor-chat': {
					default: true
				},
				'dardcor.dardcor': {
					default: true
				}
			},
		});
	}
}

export default product;
