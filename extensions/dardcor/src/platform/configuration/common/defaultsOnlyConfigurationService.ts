/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConfigurationScope } from 'vscode';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { AbstractConfigurationService, BaseConfig, Config, ConfigTarget, ExperimentBasedConfig, ExperimentBasedConfigType, globalConfigRegistry, InspectConfigResult } from './configurationService';


export class DefaultsOnlyConfigurationService extends AbstractConfigurationService {

	override getConfig<T>(key: Config<T>): T {
		return this.getDefaultValue(key);
	}

	override inspectConfig<T>(key: BaseConfig<T>, scope?: ConfigurationScope): InspectConfigResult<T> | undefined {
		return {
			defaultValue: this.getDefaultValue(key),
		};
	}

	override setConfig<T>(key: BaseConfig<T>, value: T, _target?: ConfigTarget): Promise<void> {
		return Promise.resolve();
	}

	override getNonExtensionConfig<T>(configKey: string): T | undefined {
		return undefined;
	}

	override getExperimentBasedConfig<T extends ExperimentBasedConfigType>(key: ExperimentBasedConfig<T>, experimentationService: IExperimentationService, scope?: ConfigurationScope): T {
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

	override updateExperimentBasedConfiguration(treatments: string[]): void {
		if (treatments.length === 0) {
			return;
		}

		this._onDidChangeConfiguration.fire({
			affectsConfiguration: (section: string, _scope?: ConfigurationScope) => {
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

	override dumpConfig(): { [key: string]: string } {
		return {};
	}
}
