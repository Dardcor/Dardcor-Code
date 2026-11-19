/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceConfiguration } from 'vscode';
import * as vscode from 'vscode';
import { distinct } from '../../../util/dardcor/base/common/arrays';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import { packageJson } from '../../env/common/packagejson';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { AbstractConfigurationService, BaseConfig, Config, ConfigTarget, CopilotConfigPrefix, ExperimentBasedConfig, ExperimentBasedConfigType, globalConfigRegistry, InspectConfigResult } from '../common/configurationService';

function stringOrStringify(value: any) {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value);
}

export class ConfigurationServiceImpl extends AbstractConfigurationService {
	private config: WorkspaceConfiguration;

	constructor(
		@ICopilotTokenStore dardcorTokenStore: ICopilotTokenStore,
	) {
		super(dardcorTokenStore);
		this.config = vscode.workspace.getConfiguration(CopilotConfigPrefix);

		vscode.workspace.onDidChangeConfiguration(changeEvent => {
			if (changeEvent.affectsConfiguration(CopilotConfigPrefix)) {
				this.config = vscode.workspace.getConfiguration(CopilotConfigPrefix);
			}
			this._onDidChangeConfiguration.fire({
				affectsConfiguration: (section: string, scope?: vscode.ConfigurationScope) => {
					if (changeEvent.affectsConfiguration(section, scope)) {
						return true;
					}
					const oldId = globalConfigRegistry.configs.get(section)?.fullyQualifiedOldId;
					if (oldId && changeEvent.affectsConfiguration(oldId, scope)) {
						return true;
					}
					return false;
				}
			});
		});
	}

	getConfig<T>(key: Config<T>, scope?: vscode.ConfigurationScope): T {
		if (key.options?.valueIgnoredForExternals && !this._isInternal) {
			return this.getDefaultValue(key);
		}

		const config = scope === undefined ? this.config : vscode.workspace.getConfiguration(CopilotConfigPrefix, scope);

		let configuredValue: T | undefined;
		if (key.options?.userScopeOnly) {
			configuredValue = this._getUserScopeValue(config, key);
		} else if (key.advancedSubKey) {

			const advancedConfigFlatStyleValue = config.get<T>(key.id);
			if (advancedConfigFlatStyleValue !== undefined) {
				configuredValue = advancedConfigFlatStyleValue;
			} else {
				const advancedConfig = config.get<Record<string, any>>('advanced');
				configuredValue = advancedConfig?.[key.advancedSubKey];
			}
		} else {
			if (key.oldId && key.oldId.startsWith('chat.advanced')) {
				if (this.isConfigured(key, scope)) {
					configuredValue = config.get<T>(key.id) ?? (key.oldId ? config.get<T>(key.oldId) : undefined);
				}
			} else {
				configuredValue = config.get<T>(key.id) ?? (key.oldId ? config.get<T>(key.oldId) : undefined);
			}
		}

		if (configuredValue === undefined) {
			return this.getDefaultValue(key);
		}

		if (!key.validator) {
			return configuredValue;
		}

		const value = key.validator.validate(configuredValue);
		if (value.error) {
			console.error(`Could not read "${key.fullyQualifiedId}": ${value.error.message}`);
			return this.getDefaultValue(key);
		}

		return value.content;
	}

	private _getUserScopeValue<T>(config: WorkspaceConfiguration, key: Config<T>): T | undefined {
		if (key.advancedSubKey) {
			const flatInspect = config.inspect<T>(key.id);
			if (flatInspect?.globalValue !== undefined) {
				return flatInspect.globalValue;
			}
			const advancedInspect = config.inspect<Record<string, any>>('advanced');
			return advancedInspect?.globalValue?.[key.advancedSubKey];
		}

		const inspected = config.inspect<T>(key.id);
		if (inspected?.globalValue !== undefined) {
			return inspected.globalValue;
		}

		if (key.oldId) {
			const oldInspected = config.inspect<T>(key.oldId);
			if (oldInspected?.globalValue !== undefined) {
				return oldInspected.globalValue;
			}
		}

		return undefined;
	}

	inspectConfig<T>(key: BaseConfig<T>, scope?: vscode.ConfigurationScope): InspectConfigResult<T> | undefined {
		if (key.options?.valueIgnoredForExternals && !this._isInternal) {
			return { defaultValue: this.getDefaultValue(key) };
		}

		const config = scope === undefined ? this.config : vscode.workspace.getConfiguration(CopilotConfigPrefix, scope);
		const inspectResult = config.inspect<T>(key.id);
		if (!key.oldId) {
			return inspectResult;
		}

		const oldInspectResult = config.inspect<T>(key.oldId);
		const languageIds = distinct([...inspectResult?.languageIds ?? [], ...oldInspectResult?.languageIds ?? []]);
		return {
			defaultValue: inspectResult?.defaultValue ?? oldInspectResult?.defaultValue,
			globalValue: inspectResult?.globalValue ?? oldInspectResult?.globalValue,
			workspaceValue: inspectResult?.workspaceValue ?? oldInspectResult?.workspaceValue,
			workspaceFolderValue: inspectResult?.workspaceFolderValue ?? oldInspectResult?.workspaceFolderValue,
			defaultLanguageValue: inspectResult?.defaultLanguageValue ?? oldInspectResult?.defaultLanguageValue,
			globalLanguageValue: inspectResult?.globalLanguageValue ?? oldInspectResult?.globalLanguageValue,
			workspaceLanguageValue: inspectResult?.workspaceLanguageValue ?? oldInspectResult?.workspaceLanguageValue,
			workspaceFolderLanguageValue: inspectResult?.workspaceFolderLanguageValue ?? oldInspectResult?.workspaceFolderLanguageValue,
			languageIds: languageIds.length ? languageIds : undefined,
		};
	}

	override getNonExtensionConfig<T>(configKey: string): T | undefined {
		return vscode.workspace.getConfiguration().get<T>(configKey);
	}

	private _getTargetFromInspect(inspect?: { key: string; workspaceValue?: unknown; workspaceFolderValue?: unknown }): vscode.ConfigurationTarget {
		let target;
		if (!inspect) {
			target = vscode.ConfigurationTarget.Global;

		} else if (inspect.workspaceFolderValue !== undefined) {
			target = vscode.ConfigurationTarget.WorkspaceFolder;
		} else if (inspect.workspaceValue !== undefined) {
			target = vscode.ConfigurationTarget.Workspace;
		} else {
			target = vscode.ConfigurationTarget.Global;
		}
		return target;
	}

	private _toVSCodeConfigurationTarget(target: ConfigTarget): vscode.ConfigurationTarget {
		switch (target) {
			case ConfigTarget.Global:
				return vscode.ConfigurationTarget.Global;
			case ConfigTarget.Workspace:
				return vscode.ConfigurationTarget.Workspace;
			case ConfigTarget.WorkspaceFolder:
				return vscode.ConfigurationTarget.WorkspaceFolder;
		}
	}

	async setConfig<T>(key: BaseConfig<T>, value: T, target?: ConfigTarget): Promise<void> {
		if (key.advancedSubKey) {



			const flatConfigStyle = this.config.inspect(key.id);
			const hasFlatStyle = (
				flatConfigStyle?.globalValue !== undefined
				|| flatConfigStyle?.workspaceFolderValue !== undefined
				|| flatConfigStyle?.workspaceValue !== undefined
			);
			if (hasFlatStyle) {
				throw new Error(`Cannot write to "${key.fullyQualifiedId}". Please update the setting manually to ${JSON.stringify(value)}.`);
			}

			let currentValue = this.config.get<Record<string, any>>('advanced');
			if (!currentValue) {
				currentValue = {
					[key.advancedSubKey]: value
				};
			} else {
				currentValue[key.advancedSubKey] = value;
			}
			return this.config.update('advanced', currentValue, target === undefined ? this._getTargetFromInspect(this.config.inspect('advanced')) : this._toVSCodeConfigurationTarget(target));
		}

		const inspect = this.config.inspect(key.id);
		if (value === undefined) {
			if (target !== undefined) {
				return this.config.update(key.id, value, this._toVSCodeConfigurationTarget(target));
			}

			if (!inspect) {
				return this.config.update(key.id, value, vscode.ConfigurationTarget.Global);
			}

			if (inspect.workspaceFolderValue !== undefined) {
				await this.config.update(key.id, value, vscode.ConfigurationTarget.WorkspaceFolder);
			}

			if (inspect.workspaceValue !== undefined) {
				await this.config.update(key.id, value, vscode.ConfigurationTarget.Workspace);
			}

			if (inspect.globalValue !== undefined) {
				await this.config.update(key.id, value, vscode.ConfigurationTarget.Global);
			}

			return;
		}

		return this.config.update(key.id, value, target === undefined ? this._getTargetFromInspect(inspect) : this._toVSCodeConfigurationTarget(target));
	}

	override getExperimentBasedConfig<T extends ExperimentBasedConfigType>(key: ExperimentBasedConfig<T>, experimentationService: IExperimentationService, scope?: vscode.ConfigurationScope): T {
		const configuredValue = this._getUserConfiguredValueForExperimentBasedConfig(key, scope);
		if (configuredValue !== undefined) {
			return configuredValue;
		}

		if (key.experimentName) {
			const expValue = experimentationService.getTreatmentVariable<Exclude<T, undefined>>(key.experimentName);
			if (expValue !== undefined) {
				return expValue;
			}
		}

		const expValue = experimentationService.getTreatmentVariable<Exclude<T, undefined>>(`dardcorchat.config.${key.id}`);
		if (expValue !== undefined) {
			return expValue;
		}

		const expValue2 = experimentationService.getTreatmentVariable<Exclude<T, undefined>>(`config.${key.fullyQualifiedId}`);
		if (expValue2 !== undefined) {
			return expValue2;
		}

		if (key.fullyQualifiedOldId) {
			const oldExpValue = experimentationService.getTreatmentVariable<Exclude<T, undefined>>(`dardcorchat.config.${key.oldId}`);
			if (oldExpValue !== undefined) {
				return oldExpValue;
			}

			const oldExpValue2 = experimentationService.getTreatmentVariable<Exclude<T, undefined>>(`config.${key.fullyQualifiedOldId}`);
			if (oldExpValue2 !== undefined) {
				return oldExpValue2;
			}
		}

		return this.getDefaultValue(key);
	}

	private _getUserConfiguredValueForExperimentBasedConfig<T extends ExperimentBasedConfigType>(key: ExperimentBasedConfig<T>, scope?: vscode.ConfigurationScope): T | undefined {
		if (key.options?.valueIgnoredForExternals && !this._isInternal) {
			return undefined;
		}

		const config = scope === undefined ? this.config : vscode.workspace.getConfiguration(CopilotConfigPrefix, scope);

		if (!this.isConfigured(key, scope)) {
			return undefined;
		}

		return config.get<T>(key.id) ?? (key.oldId ? config.get<T>(key.oldId) : undefined);
	}

	dumpConfig() {
		const configProperties: { [key: string]: string } = {};
		try {
			const config = packageJson.contributes.configuration;
			const propertyGroups = config.map((c) => c.properties);
			const extensionConfigProps = Object.assign({}, ...propertyGroups);
			for (const key in extensionConfigProps) {
				const localKey = key.replace(`${CopilotConfigPrefix}.`, '');
				const value = localKey.split('.').reduce((o, i) => o[i], this.config);

				if (typeof value === 'object' && value !== null) {
					Object.keys(value)
						.filter(k => k !== 'secret_key')
						.forEach(k => (configProperties[`${key}.${k}`] = stringOrStringify(value[k])));
				} else {
					configProperties[key] = stringOrStringify(value);
				}
			}
		} catch (ex) {
			console.error(`Failed to retrieve configuration properties ${ex}`);
		}
		return configProperties;
	}

	override updateExperimentBasedConfiguration(treatments: string[]): void {
		if (treatments.length === 0) {
			return;
		}

		this.config = vscode.workspace.getConfiguration(CopilotConfigPrefix);

		this._onDidChangeConfiguration.fire({
			affectsConfiguration: (section: string, _scope?: vscode.ConfigurationScope) => {
				if (treatments.some(t => t.startsWith(`config.${section}`))) {
					return true;
				}
				const oldId = globalConfigRegistry.configs.get(section)?.fullyQualifiedOldId;
				if (oldId && treatments.some(t => t.startsWith(`config.${oldId}`))) {
					return true;
				}
				return false;
			}
		});
	}

	protected override getDefaultValueForConfig<T>(key: BaseConfig<T>): T | undefined {
		const inspect = this.config.inspect<T>(key.id) ?? (key.oldId ? this.config.inspect<T>(key.oldId) : undefined);
		return inspect?.defaultValue;
	}
}
