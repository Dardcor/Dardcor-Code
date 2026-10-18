/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IAgentSource, PromptsStorage } from '../service/promptsService.js';

export function isOrganizationPromptFile(uri: URI, extensionId: ExtensionIdentifier, productService: IProductService): boolean {
	const chatExtensionId = productService.defaultChatAgent?.chatExtensionId;
	if (!chatExtensionId) {
		return false;
	}
	const isFromBuiltinChatExtension = ExtensionIdentifier.equals(extensionId, chatExtensionId);
	const pathContainsGithub = uri.path.includes('/github/');
	return isFromBuiltinChatExtension && pathContainsGithub;
}

export function isBuiltinAgent(source: IAgentSource, uri: URI, productService: IProductService): boolean {
	if (source.storage !== PromptsStorage.extension) {
		return false;
	}
	const chatExtensionId = productService.defaultChatAgent?.chatExtensionId;
	if (!chatExtensionId || !ExtensionIdentifier.equals(source.extensionId, chatExtensionId)) {
		return false;
	}
	return !isOrganizationPromptFile(uri, source.extensionId, productService);
}
