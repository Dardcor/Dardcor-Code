/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';
import { IPolicyData } from './defaultAccount.js';

export const LINUX_SYSTEM_POLICY_FILE_PATH = '/etc/vscode/policy.json';

export type PolicyName = string;
export type LocalizedValue = {
	key: string;
	value: string;
};

export type PolicyValue = string | number | boolean;
export type ManagedSettingValue = PolicyValue;
export type ManagedSettingsData = Readonly<Record<string, ManagedSettingValue>>;

export interface IManagedSettingPolicyDefinition {
	readonly type: 'string' | 'number' | 'boolean';
}

export type IManagedSettingsPolicyDefinitions = Readonly<Record<string, IManagedSettingPolicyDefinition>>;

export enum PolicyCategory {
	Extensions = 'Extensions',
	IntegratedTerminal = 'IntegratedTerminal',
	InteractiveSession = 'InteractiveSession',
	Telemetry = 'Telemetry',
	Update = 'Update',
}

export const PolicyCategoryData: {
	[key in PolicyCategory]: { name: LocalizedValue }
} = {
	[PolicyCategory.Extensions]: {
		name: {
			key: 'extensionsConfigurationTitle', value: localize('extensionsConfigurationTitle', "Extensions"),
		}
	},
	[PolicyCategory.IntegratedTerminal]: {
		name: {
			key: 'terminalIntegratedConfigurationTitle', value: localize('terminalIntegratedConfigurationTitle', "Integrated Terminal"),
		}
	},
	[PolicyCategory.InteractiveSession]: {
		name: {
			key: 'interactiveSessionConfigurationTitle', value: localize('interactiveSessionConfigurationTitle', "Chat"),
		}
	},
	[PolicyCategory.Telemetry]: {
		name: {
			key: 'telemetryConfigurationTitle', value: localize('telemetryConfigurationTitle', "Telemetry"),
		}
	},
	[PolicyCategory.Update]: {
		name: {
			key: 'updateConfigurationTitle', value: localize('updateConfigurationTitle', "Update"),
		}
	}
};

export interface IPolicy {

	readonly name: PolicyName;

	readonly category: PolicyCategory;

	readonly minimumVersion: `${number}.${number}`;

	readonly localization: {
		description: LocalizedValue;
		enumDescriptions?: LocalizedValue[];
	};

	readonly value?: (policyData: IPolicyData) => string | number | boolean | undefined;

	readonly managedSettings?: IManagedSettingsPolicyDefinitions;

	readonly restrictedValue?: string | number | boolean;
}

export interface IPolicyReference {

	readonly name: PolicyName;
}

export interface IExtensionConfigurationPolicyReference {

	readonly policyReference: IPolicyReference;
}
