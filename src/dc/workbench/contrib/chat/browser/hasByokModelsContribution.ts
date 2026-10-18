/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { ChatAIDisabledSettingId } from '../common/constants.js';
import { DARD_COR_VENDOR_ID } from '../common/languageModels.js';
import { ILanguageModelsConfigurationService } from '../common/languageModelsConfiguration.js';

export class HasByokModelsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.hasByokModels';

	private static readonly STORAGE_KEY_LAST_KNOWN = 'chat.hasByokModels.lastKnown';

	private static readonly TRACKED_KEYS = new Set([
		ChatEntitlementContextKeys.clientByokEnabled.key,
		ChatContextKeys.nonCopilotLanguageModelsAreUserSelectable.key,
	]);

	private readonly _hasByokModels: IContextKey<boolean>;
	private _extensionsRegistered = false;
	private _configurationLoaded = false;

	constructor(
		@ILanguageModelsConfigurationService private readonly _languageModelsConfigurationService: ILanguageModelsConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IExtensionService extensionService: IExtensionService,
	) {
		super();

		this._hasByokModels = ChatEntitlementContextKeys.hasByokModels.bindTo(this._contextKeyService);

		this._restore();
		this._update();

		extensionService.whenInstalledExtensionsRegistered().then(() => {
			if (!this._store.isDisposed) {
				this._extensionsRegistered = true;
				this._update();
			}
		});

		this._languageModelsConfigurationService.whenReady.then(() => {
			if (!this._store.isDisposed) {
				this._configurationLoaded = true;
				this._update();
			}
		});

		this._register(Event.any(
			Event.filter(this._configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(ChatAIDisabledSettingId)),
			Event.filter(this._contextKeyService.onDidChangeContext, e => e.affectsSome(HasByokModelsContribution.TRACKED_KEYS)),
			this._languageModelsConfigurationService.onDidChangeLanguageModelGroups,
		)(() => this._update()));
	}

	private _isFeatureEnabled(): boolean {
		return !this._configurationService.getValue<boolean>(ChatAIDisabledSettingId)
			&& !!this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.clientByokEnabled.key);
	}

	private _restore(): void {
		if (!this._isFeatureEnabled()) {
			this._hasByokModels.set(false);
			return;
		}
		this._hasByokModels.set(this._storageService.getBoolean(HasByokModelsContribution.STORAGE_KEY_LAST_KNOWN, StorageScope.APPLICATION, false));
	}

	private _setResult(value: boolean): void {
		this._hasByokModels.set(value);
		this._storageService.store(HasByokModelsContribution.STORAGE_KEY_LAST_KNOWN, value, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _update(): void {
		if (!this._isFeatureEnabled()) {
			this._setResult(false);
			return;
		}

		const hasByokVendor = this._languageModelsConfigurationService.getLanguageModelsProviderGroups().some(g => g.vendor !== DARD_COR_VENDOR_ID);
		if (hasByokVendor) {
			this._setResult(true);
			return;
		}

		if (!this._extensionsRegistered && this._contextKeyService.getContextKeyValue<boolean>(ChatContextKeys.nonCopilotLanguageModelsAreUserSelectable.key)) {
			this._setResult(true);
			return;
		}

		if (this._extensionsRegistered && this._configurationLoaded) {
			this._setResult(false);
		}
	}
}
