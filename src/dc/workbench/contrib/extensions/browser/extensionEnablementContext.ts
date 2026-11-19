/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const EXTENSION_ENABLED_CONTEXT_KEY_PREFIX = 'extensionEnabled:';

export class ExtensionEnablementContextKeysContribution extends Disposable implements IWorkbenchContribution {

	private readonly _contextKeys = new Map<string, IContextKey<boolean>>();

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super();

		this._reconcile();
		this._register(this.extensionService.onDidRegisterExtensions(() => this._reconcile()));
		this._register(this.extensionService.onDidChangeExtensions(() => this._reconcile()));
	}

	private _reconcile(): void {
		const enabledKeys = new Set<string>();
		for (const extension of this.extensionService.extensions) {
			enabledKeys.add(EXTENSION_ENABLED_CONTEXT_KEY_PREFIX + ExtensionIdentifier.toKey(extension.identifier));
		}

		for (const [key, contextKey] of this._contextKeys) {
			contextKey.set(enabledKeys.has(key));
		}

		for (const key of enabledKeys) {
			if (!this._contextKeys.has(key)) {
				this._contextKeys.set(key, this.contextKeyService.createKey<boolean>(key, true));
			}
		}
	}
}
