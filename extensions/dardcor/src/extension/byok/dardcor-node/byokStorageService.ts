/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { BYOKAuthType, BYOKModelCapabilities } from '../../byok/common/byokProvider';

export interface StoredModelConfig {
	deploymentUrl?: string;
	isRegistered?: boolean;
	isCustomModel?: boolean;
	modelCapabilities?: BYOKModelCapabilities;
}

export interface IBYOKStorageService {
	getAPIKey(providerName: string, modelId?: string): Promise<string | undefined>;

	storeAPIKey(providerName: string, apiKey: string, authType: BYOKAuthType, modelId?: string): Promise<void>;

	deleteAPIKey(providerName: string, authType: BYOKAuthType, modelId?: string): Promise<void>;

	getStoredModelConfigs(providerName: string): Promise<Record<string, StoredModelConfig>>;

	saveModelConfig(
		modelId: string,
		providerName: string,
		config: {
			apiKey: string;
			deploymentUrl?: string;
			modelCapabilities?: BYOKModelCapabilities;
		},
		authType: BYOKAuthType
	): Promise<void>;
	removeModelConfig(modelId: string, providerName: string, isDeletingCustomModel: boolean): Promise<void>;
}

export class BYOKStorageService implements IBYOKStorageService {
	private readonly _extensionContext: IVSCodeExtensionContext;

	constructor(extensionContext: IVSCodeExtensionContext) {
		this._extensionContext = extensionContext;
	}

	public async getAPIKey(providerName: string, modelId?: string): Promise<string | undefined> {
		if (modelId) {
			const modelKey = await this._extensionContext.secrets.get(`dardcor-byok-${providerName}-${modelId}-api-key`);
			if (modelKey && modelKey.trim()) {
				return modelKey.trim();
			}
		}

		const providerKey = await this._extensionContext.secrets.get(`dardcor-byok-${providerName}-api-key`);
		return providerKey?.trim() || undefined;
	}

	public async storeAPIKey(providerName: string, apiKey: string, authType: BYOKAuthType, modelId?: string): Promise<void> {
		if (authType === BYOKAuthType.None) {
			return;
		}

		if (!apiKey?.trim()) {
			return;
		}

		if (authType === BYOKAuthType.GlobalApiKey) {
			await this._extensionContext.secrets.store(`dardcor-byok-${providerName}-api-key`, apiKey);
		} else if (authType === BYOKAuthType.PerModelDeployment && modelId) {
			await this._extensionContext.secrets.store(`dardcor-byok-${providerName}-${modelId}-api-key`, apiKey);
		}
	}

	public async deleteAPIKey(providerName: string, authType: BYOKAuthType, modelId?: string): Promise<void> {
		if (authType === BYOKAuthType.None) {
			return;
		} else if (authType === BYOKAuthType.GlobalApiKey) {
			await this._extensionContext.secrets.delete(`dardcor-byok-${providerName}-api-key`);
		} else if (authType === BYOKAuthType.PerModelDeployment && modelId) {
			await this._extensionContext.secrets.delete(`dardcor-byok-${providerName}-${modelId}-api-key`);
		}
	}

	public async getStoredModelConfigs(providerName: string): Promise<Record<string, StoredModelConfig>> {
		return this._extensionContext.globalState.get<Record<string, StoredModelConfig>>(
			`dardcor-byok-${providerName}-models-config`,
			{}
		);
	}

	public async saveModelConfig(
		modelId: string,
		providerName: string,
		config: {
			apiKey: string;
			isCustomModel: boolean;
			deploymentUrl?: string;
			modelCapabilities?: BYOKModelCapabilities;
		},
		authType: BYOKAuthType
	): Promise<void> {
		const configToSave: StoredModelConfig = {
			isCustomModel: config.isCustomModel,
			deploymentUrl: config.deploymentUrl,
			isRegistered: true,
			modelCapabilities: config.modelCapabilities
		};
		const existingConfigs = await this.getStoredModelConfigs(providerName);
		existingConfigs[modelId] = configToSave;
		await this._extensionContext.globalState.update(`dardcor-byok-${providerName}-models-config`, existingConfigs);

		await this.storeAPIKey(providerName, config.apiKey, authType, modelId);
	}

	public async removeModelConfig(modelId: string, providerName: string, isDeletingCustomModel: boolean): Promise<void> {
		const existingConfigs = await this.getStoredModelConfigs(providerName);
		const existingConfig = existingConfigs[modelId];
		const isCustomModel = existingConfig?.isCustomModel || false;
		if (existingConfig && (isDeletingCustomModel || !isCustomModel)) {
			delete existingConfigs[modelId];
			await this._extensionContext.globalState.update(
				`dardcor-byok-${providerName}-models-config`,
				existingConfigs
			);
			await this._extensionContext.secrets.delete(`dardcor-byok-${providerName}-${modelId}-api-key`);
		} else {
			existingConfig.isRegistered = false;
			await this._extensionContext.globalState.update(
				`dardcor-byok-${providerName}-models-config`,
				existingConfigs
			);
		}
	}
}
