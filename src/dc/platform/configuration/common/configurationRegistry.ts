/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from '../../../base/common/arrays.js';
import { IStringDictionary } from '../../../base/common/collections.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import * as types from '../../../base/common/types.js';
import * as nls from '../../../nls.js';
import { getLanguageTagSettingPlainKey } from './configuration.js';
import { Extensions as JSONExtensions, IJSONContributionRegistry } from '../../jsonschemas/common/jsonContributionRegistry.js';
import { Registry } from '../../registry/common/platform.js';
import { IPolicy, IPolicyReference, PolicyName } from '../../../base/common/policy.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import product from '../../product/common/product.js';

export enum EditPresentationTypes {
	Multiline = 'multilineText',
	Singleline = 'singlelineText'
}

export const Extensions = {
	Configuration: 'base.contributions.configuration'
};

export interface IConfigurationDelta {
	removedDefaults?: IConfigurationDefaults[];
	removedConfigurations?: IConfigurationNode[];
	addedDefaults?: IConfigurationDefaults[];
	addedConfigurations?: IConfigurationNode[];
}

export interface IAgentHostConfigurationSync {

	readonly key: string;

	readonly transform?: (value: unknown) => unknown;

	readonly scope?: AgentHostConfigurationSyncScope;

	readonly localOnly?: boolean;
}

export const enum AgentHostConfigurationSyncScope {
	All = 'all',
	Local = 'local',
	Ambient = 'ambient',
}

export interface IConfigurationRegistry {

	registerConfiguration(configuration: IConfigurationNode): IConfigurationNode;

	registerConfigurations(configurations: IConfigurationNode[], validate?: boolean): void;

	deregisterConfigurations(configurations: IConfigurationNode[]): void;

	updateConfigurations(configurations: { add: IConfigurationNode[]; remove: IConfigurationNode[] }): void;

	registerDefaultConfigurations(defaultConfigurations: IConfigurationDefaults[]): void;

	deregisterDefaultConfigurations(defaultConfigurations: IConfigurationDefaults[]): void;

	deltaConfiguration(delta: IConfigurationDelta): void;

	getRegisteredDefaultConfigurations(): IConfigurationDefaults[];

	getConfigurationDefaultsOverrides(): Map<string, IConfigurationDefaultOverrideValue>;

	notifyConfigurationSchemaUpdated(...configurations: IConfigurationNode[]): void;

	readonly onDidSchemaChange: Event<void>;

	readonly onDidUpdateConfiguration: Event<{ properties: ReadonlySet<string>; defaultsOverrides?: boolean }>;

	getConfigurations(): IConfigurationNode[];

	getConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema>;

	getPolicyConfigurations(): Map<PolicyName, string>;

	getPolicyReferenceConfigurations(): Map<PolicyName, Set<string>>;

	getAgentHostSyncConfigurations(): Map<string, IAgentHostConfigurationSync>;

	getExcludedConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema>;

	registerOverrideIdentifiers(identifiers: string[]): void;
}

export const enum ConfigurationScope {
	APPLICATION = 1,
	MACHINE,
	APPLICATION_MACHINE,
	WINDOW,
	RESOURCE,
	LANGUAGE_OVERRIDABLE,
	MACHINE_OVERRIDABLE,
}


export interface IConfigurationPropertySchema extends IJSONSchema {

	scope?: ConfigurationScope;

	restricted?: boolean;

	included?: boolean;

	tags?: string[];

	ignoreSync?: boolean;

	disallowSyncIgnore?: boolean;

	disallowConfigurationDefault?: boolean;

	enumItemLabels?: string[];

	keywords?: string[];

	editPresentation?: EditPresentationTypes;

	order?: number;

	policy?: IPolicy;

	policyReference?: IPolicyReference;

	agentHost?: IAgentHostConfigurationSync;

	experiment?: {
		mode: 'startup' | 'auto';

		name?: string;
	};
}

export interface IExtensionInfo {
	id: string;
	displayName?: string;
}

export interface IConfigurationNode {
	id?: string;
	order?: number;
	type?: string | string[];
	title?: string;
	description?: string;
	properties?: IStringDictionary<IConfigurationPropertySchema>;
	allOf?: IConfigurationNode[];
	scope?: ConfigurationScope;
	extensionInfo?: IExtensionInfo;
	restrictedProperties?: string[];
}

export type ConfigurationDefaultSource = IExtensionInfo | string;

export function isConfigurationDefaultSourceEquals(a: ConfigurationDefaultSource | undefined, b: ConfigurationDefaultSource | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	if (typeof a === 'string' || typeof b === 'string') {
		return a === b;
	}
	return a.id === b.id;
}

export type ConfigurationDefaultValueSource = ConfigurationDefaultSource | Map<string, ConfigurationDefaultSource>;

export interface IConfigurationDefaults {
	overrides: IStringDictionary<unknown>;
	source?: ConfigurationDefaultSource;
	donotCache?: boolean;
	preventExperimentOverride?: boolean;
}

export type IRegisteredConfigurationPropertySchema = IConfigurationPropertySchema & {
	section?: {
		id?: string;
		title?: string;
		order?: number;
		extensionInfo?: IExtensionInfo;
	};
	defaultDefaultValue?: unknown;
	source?: ConfigurationDefaultSource;
	defaultValueSource?: ConfigurationDefaultValueSource;
};

export interface IConfigurationDefaultOverride {
	readonly value: unknown;
	readonly source?: ConfigurationDefaultSource;
}

export interface IConfigurationDefaultOverrideValue {
	readonly value: unknown;
	readonly source?: ConfigurationDefaultValueSource;
}

export const allSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const applicationSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const applicationMachineSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const machineSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const machineOverridableSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const windowSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };
export const resourceSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} };

export const resourceLanguageSettingsSchemaId = 'vscode://schemas/settings/resourceLanguage';
export const configurationDefaultsSchemaId = 'vscode://schemas/settings/configurationDefaults';

const contributionRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);

class ConfigurationRegistry extends Disposable implements IConfigurationRegistry {

	private readonly registeredConfigurationDefaults: IConfigurationDefaults[] = [];
	private readonly configurationDefaultsOverrides: Map<string, { configurationDefaultOverrides: IConfigurationDefaultOverride[]; configurationDefaultOverrideValue?: IConfigurationDefaultOverrideValue }>;
	private readonly defaultLanguageConfigurationOverridesNode: IConfigurationNode;
	private readonly configurationContributors: IConfigurationNode[];
	private readonly configurationProperties: IStringDictionary<IRegisteredConfigurationPropertySchema>;
	private readonly policyConfigurations: Map<PolicyName, string>;
	private readonly policyReferenceConfigurations: Map<PolicyName, Set<string>>;
	private readonly agentHostSyncConfigurations: Map<string, IAgentHostConfigurationSync>;
	private readonly excludedAgentHostSyncKeys = new Map<IConfigurationNode, Set<string>>();
	private readonly excludedConfigurationProperties: IStringDictionary<IRegisteredConfigurationPropertySchema>;
	private readonly resourceLanguageSettingsSchema: IJSONSchema;
	private readonly overrideIdentifiers = new Set<string>();

	private readonly _onDidSchemaChange = this._register(new Emitter<void>());
	readonly onDidSchemaChange: Event<void> = this._onDidSchemaChange.event;

	private readonly _onDidUpdateConfiguration = this._register(new Emitter<{ properties: ReadonlySet<string>; defaultsOverrides?: boolean }>());
	readonly onDidUpdateConfiguration = this._onDidUpdateConfiguration.event;

	constructor() {
		super();
		this.configurationDefaultsOverrides = new Map();
		this.defaultLanguageConfigurationOverridesNode = {
			id: 'defaultOverrides',
			title: nls.localize('defaultLanguageConfigurationOverrides.title', "Default Language Configuration Overrides"),
			properties: {}
		};
		this.configurationContributors = [this.defaultLanguageConfigurationOverridesNode];
		this.resourceLanguageSettingsSchema = {
			properties: {},
			patternProperties: {},
			additionalProperties: true,
			allowTrailingCommas: true,
			allowComments: true
		};
		this.configurationProperties = {};
		this.policyConfigurations = new Map<PolicyName, string>();
		this.policyReferenceConfigurations = new Map<PolicyName, Set<string>>();
		this.agentHostSyncConfigurations = new Map<string, IAgentHostConfigurationSync>();
		this.excludedConfigurationProperties = {};

		contributionRegistry.registerSchema(resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this.registerOverridePropertyPatternKey();
	}

	public registerConfiguration(configuration: IConfigurationNode, validate: boolean = true): IConfigurationNode {
		this.registerConfigurations([configuration], validate);
		return configuration;
	}

	public registerConfigurations(configurations: IConfigurationNode[], validate: boolean = true): void {
		const properties = new Set<string>();
		this.doRegisterConfigurations(configurations, validate, properties);

		contributionRegistry.registerSchema(resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}

	public deregisterConfigurations(configurations: IConfigurationNode[]): void {
		const properties = new Set<string>();
		this.doDeregisterConfigurations(configurations, properties);

		contributionRegistry.registerSchema(resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}

	public updateConfigurations({ add, remove }: { add: IConfigurationNode[]; remove: IConfigurationNode[] }): void {
		const properties = new Set<string>();
		this.doDeregisterConfigurations(remove, properties);
		this.doRegisterConfigurations(add, false, properties);

		contributionRegistry.registerSchema(resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties });
	}

	public registerDefaultConfigurations(configurationDefaults: IConfigurationDefaults[]): void {
		const properties = new Set<string>();
		this.doRegisterDefaultConfigurations(configurationDefaults, properties);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides: true });
	}

	private doRegisterDefaultConfigurations(configurationDefaults: IConfigurationDefaults[], bucket: Set<string>) {

		this.registeredConfigurationDefaults.push(...configurationDefaults);

		const overrideIdentifiers: string[] = [];

		for (const { overrides, source } of configurationDefaults) {
			for (const key in overrides) {
				bucket.add(key);

				const configurationDefaultOverridesForKey = this.configurationDefaultsOverrides.get(key)
					?? this.configurationDefaultsOverrides.set(key, { configurationDefaultOverrides: [] }).get(key)!;

				const value = overrides[key];
				configurationDefaultOverridesForKey.configurationDefaultOverrides.push({ value, source });

				if (OVERRIDE_PROPERTY_REGEX.test(key)) {
					const newDefaultOverride = this.mergeDefaultConfigurationsForOverrideIdentifier(key, value as IStringDictionary<unknown>, source, configurationDefaultOverridesForKey.configurationDefaultOverrideValue);
					if (!newDefaultOverride) {
						continue;
					}

					configurationDefaultOverridesForKey.configurationDefaultOverrideValue = newDefaultOverride;
					this.updateDefaultOverrideProperty(key, newDefaultOverride, source);
					overrideIdentifiers.push(...overrideIdentifiersFromKey(key));
				}

				else {
					const newDefaultOverride = this.mergeDefaultConfigurationsForConfigurationProperty(key, value, source, configurationDefaultOverridesForKey.configurationDefaultOverrideValue);
					if (!newDefaultOverride) {
						continue;
					}

					configurationDefaultOverridesForKey.configurationDefaultOverrideValue = newDefaultOverride;
					const property = this.configurationProperties[key];
					if (property) {
						this.updatePropertyDefaultValue(key, property);
						this.updateSchema(key, property);
					}
				}

			}
		}

		this.doRegisterOverrideIdentifiers(overrideIdentifiers);
	}

	public deregisterDefaultConfigurations(defaultConfigurations: IConfigurationDefaults[]): void {
		const properties = new Set<string>();
		this.doDeregisterDefaultConfigurations(defaultConfigurations, properties);
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides: true });
	}

	private doDeregisterDefaultConfigurations(defaultConfigurations: IConfigurationDefaults[], bucket: Set<string>): void {
		for (const defaultConfiguration of defaultConfigurations) {
			const index = this.registeredConfigurationDefaults.indexOf(defaultConfiguration);
			if (index !== -1) {
				this.registeredConfigurationDefaults.splice(index, 1);
			}
		}

		for (const { overrides, source } of defaultConfigurations) {
			for (const key in overrides) {
				const configurationDefaultOverridesForKey = this.configurationDefaultsOverrides.get(key);
				if (!configurationDefaultOverridesForKey) {
					continue;
				}

				const index = configurationDefaultOverridesForKey.configurationDefaultOverrides
					.findIndex(configurationDefaultOverride => source ? isConfigurationDefaultSourceEquals(configurationDefaultOverride.source, source) : configurationDefaultOverride.value === overrides[key]);
				if (index === -1) {
					continue;
				}

				configurationDefaultOverridesForKey.configurationDefaultOverrides.splice(index, 1);
				if (configurationDefaultOverridesForKey.configurationDefaultOverrides.length === 0) {
					this.configurationDefaultsOverrides.delete(key);
				}

				if (OVERRIDE_PROPERTY_REGEX.test(key)) {
					let configurationDefaultOverrideValue: IConfigurationDefaultOverrideValue | undefined;
					for (const configurationDefaultOverride of configurationDefaultOverridesForKey.configurationDefaultOverrides) {
						configurationDefaultOverrideValue = this.mergeDefaultConfigurationsForOverrideIdentifier(key, configurationDefaultOverride.value as IStringDictionary<unknown>, configurationDefaultOverride.source, configurationDefaultOverrideValue);
					}
					if (configurationDefaultOverrideValue && !types.isEmptyObject(configurationDefaultOverrideValue.value)) {
						configurationDefaultOverridesForKey.configurationDefaultOverrideValue = configurationDefaultOverrideValue;
						this.updateDefaultOverrideProperty(key, configurationDefaultOverrideValue, source);
					} else {
						this.configurationDefaultsOverrides.delete(key);
						delete this.configurationProperties[key];
						delete this.defaultLanguageConfigurationOverridesNode.properties![key];
					}
				} else {
					let configurationDefaultOverrideValue: IConfigurationDefaultOverrideValue | undefined;
					for (const configurationDefaultOverride of configurationDefaultOverridesForKey.configurationDefaultOverrides) {
						configurationDefaultOverrideValue = this.mergeDefaultConfigurationsForConfigurationProperty(key, configurationDefaultOverride.value, configurationDefaultOverride.source, configurationDefaultOverrideValue);
					}
					configurationDefaultOverridesForKey.configurationDefaultOverrideValue = configurationDefaultOverrideValue;
					const property = this.configurationProperties[key];
					if (property) {
						this.updatePropertyDefaultValue(key, property);
						this.updateSchema(key, property);
					}
				}
				bucket.add(key);
			}
		}
		this.updateOverridePropertyPatternKey();
	}

	private updateDefaultOverrideProperty(key: string, newDefaultOverride: IConfigurationDefaultOverrideValue, source: ConfigurationDefaultSource | undefined): void {
		const property: IRegisteredConfigurationPropertySchema = {
			section: {
				id: this.defaultLanguageConfigurationOverridesNode.id,
				title: this.defaultLanguageConfigurationOverridesNode.title,
				order: this.defaultLanguageConfigurationOverridesNode.order,
				extensionInfo: this.defaultLanguageConfigurationOverridesNode.extensionInfo
			},
			type: 'object',
			default: newDefaultOverride.value,
			description: nls.localize('defaultLanguageConfiguration.description', "Configure settings to be overridden for {0}.", getLanguageTagSettingPlainKey(key)),
			$ref: resourceLanguageSettingsSchemaId,
			defaultDefaultValue: newDefaultOverride.value,
			source,
			defaultValueSource: source
		};
		this.configurationProperties[key] = property;
		this.defaultLanguageConfigurationOverridesNode.properties![key] = property;
	}

	private mergeDefaultConfigurationsForOverrideIdentifier(overrideIdentifier: string, configurationValueObject: IStringDictionary<unknown>, valueSource: ConfigurationDefaultSource | undefined, existingDefaultOverride: IConfigurationDefaultOverrideValue | undefined): IConfigurationDefaultOverrideValue | undefined {
		const defaultValue = existingDefaultOverride?.value || {};
		const source = existingDefaultOverride?.source ?? new Map<string, ConfigurationDefaultSource>();

		if (!(source instanceof Map)) {
			console.error('objectConfigurationSources is not a Map');
			return undefined;
		}

		for (const propertyKey of Object.keys(configurationValueObject)) {
			const propertyDefaultValue = configurationValueObject[propertyKey];

			const isObjectSetting = types.isObject(propertyDefaultValue) &&
				(types.isUndefined((defaultValue as IStringDictionary<unknown>)[propertyKey]) || types.isObject((defaultValue as IStringDictionary<unknown>)[propertyKey]));

			if (isObjectSetting) {
				(defaultValue as IStringDictionary<unknown>)[propertyKey] = { ...((defaultValue as IStringDictionary<unknown>)[propertyKey] ?? {}), ...propertyDefaultValue };
				if (valueSource) {
					for (const objectKey in propertyDefaultValue) {
						source.set(`${propertyKey}.${objectKey}`, valueSource);
					}
				}
			}

			else {
				(defaultValue as IStringDictionary<unknown>)[propertyKey] = propertyDefaultValue;
				if (valueSource) {
					source.set(propertyKey, valueSource);
				} else {
					source.delete(propertyKey);
				}
			}
		}

		return { value: defaultValue, source };
	}

	private mergeDefaultConfigurationsForConfigurationProperty(propertyKey: string, value: unknown, valuesSource: ConfigurationDefaultSource | undefined, existingDefaultOverride: IConfigurationDefaultOverrideValue | undefined): IConfigurationDefaultOverrideValue | undefined {
		const property = this.configurationProperties[propertyKey];
		const existingDefaultValue = existingDefaultOverride?.value ?? property?.defaultDefaultValue;
		let source: ConfigurationDefaultValueSource | undefined = valuesSource;

		const isObjectSetting = types.isObject(value) &&
			(
				property !== undefined && property.type === 'object' ||
				property === undefined && (types.isUndefined(existingDefaultValue) || types.isObject(existingDefaultValue))
			);

		if (isObjectSetting) {
			source = existingDefaultOverride?.source ?? new Map<string, ConfigurationDefaultSource>();

			if (!(source instanceof Map)) {
				console.error('defaultValueSource is not a Map');
				return undefined;
			}

			for (const objectKey in (value as IStringDictionary<unknown>)) {
				if (valuesSource) {
					source.set(`${propertyKey}.${objectKey}`, valuesSource);
				}
			}
			value = { ...(types.isObject(existingDefaultValue) ? existingDefaultValue : {}), ...(value as IStringDictionary<unknown>) };
		}

		return { value, source };
	}

	public deltaConfiguration(delta: IConfigurationDelta): void {
		let defaultsOverrides = false;
		const properties = new Set<string>();
		if (delta.removedDefaults) {
			this.doDeregisterDefaultConfigurations(delta.removedDefaults, properties);
			defaultsOverrides = true;
		}
		if (delta.addedDefaults) {
			this.doRegisterDefaultConfigurations(delta.addedDefaults, properties);
			defaultsOverrides = true;
		}
		if (delta.removedConfigurations) {
			this.doDeregisterConfigurations(delta.removedConfigurations, properties);
		}
		if (delta.addedConfigurations) {
			this.doRegisterConfigurations(delta.addedConfigurations, false, properties);
		}
		this._onDidSchemaChange.fire();
		this._onDidUpdateConfiguration.fire({ properties, defaultsOverrides });
	}

	public notifyConfigurationSchemaUpdated(...configurations: IConfigurationNode[]) {
		this._onDidSchemaChange.fire();
	}

	public registerOverrideIdentifiers(overrideIdentifiers: string[]): void {
		this.doRegisterOverrideIdentifiers(overrideIdentifiers);
		this._onDidSchemaChange.fire();
	}

	private doRegisterOverrideIdentifiers(overrideIdentifiers: string[]) {
		for (const overrideIdentifier of overrideIdentifiers) {
			this.overrideIdentifiers.add(overrideIdentifier);
		}
		this.updateOverridePropertyPatternKey();
	}

	private doRegisterConfigurations(configurations: IConfigurationNode[], validate: boolean, bucket: Set<string>): void {

		configurations.forEach(configuration => {

			this.validateAndRegisterProperties(configuration, validate, configuration.extensionInfo, configuration.restrictedProperties, undefined, bucket);

			this.configurationContributors.push(configuration);
			this.registerJSONConfiguration(configuration);
		});
	}

	private doDeregisterConfigurations(configurations: IConfigurationNode[], bucket: Set<string>): void {

		const deregisterConfiguration = (configuration: IConfigurationNode) => {
			const excludedSyncKeys = this.excludedAgentHostSyncKeys.get(configuration);
			if (excludedSyncKeys) {
				for (const key of excludedSyncKeys) {
					bucket.add(key);
					this.agentHostSyncConfigurations.delete(key);
				}
				this.excludedAgentHostSyncKeys.delete(configuration);
			}
			if (configuration.properties) {
				for (const key in configuration.properties) {
					bucket.add(key);
					const property = this.configurationProperties[key];
					if (property?.policy?.name) {
						this.policyConfigurations.delete(property.policy.name);
					}
					this.agentHostSyncConfigurations.delete(key);
					if (property?.policyReference?.name) {
						const refs = this.policyReferenceConfigurations.get(property.policyReference.name);
						if (refs) {
							refs.delete(key);
							if (refs.size === 0) {
								this.policyReferenceConfigurations.delete(property.policyReference.name);
							}
						}
					}
					delete this.configurationProperties[key];
					this.removeFromSchema(key, configuration.properties[key]);
				}
			}
			configuration.allOf?.forEach(node => deregisterConfiguration(node));
		};
		for (const configuration of configurations) {
			deregisterConfiguration(configuration);
			const index = this.configurationContributors.indexOf(configuration);
			if (index !== -1) {
				this.configurationContributors.splice(index, 1);
			}
		}
	}

	private validateAndRegisterProperties(configuration: IConfigurationNode, validate: boolean = true, extensionInfo: IExtensionInfo | undefined, restrictedProperties: string[] | undefined, scope: ConfigurationScope = ConfigurationScope.WINDOW, bucket: Set<string>): void {
		scope = types.isUndefinedOrNull(configuration.scope) ? scope : configuration.scope;
		const properties = configuration.properties;
		if (properties) {
			for (const key in properties) {
				const property: IRegisteredConfigurationPropertySchema = properties[key];
				property.section = {
					id: configuration.id,
					title: configuration.title,
					order: configuration.order,
					extensionInfo: configuration.extensionInfo
				};
				if (validate && validateProperty(key, property, extensionInfo?.id)) {
					delete properties[key];
					continue;
				}

				property.source = extensionInfo;

				property.defaultDefaultValue = properties[key].default;
				this.updatePropertyDefaultValue(key, property);

				if (OVERRIDE_PROPERTY_REGEX.test(key)) {
					property.scope = undefined;
				} else {
					property.scope = types.isUndefinedOrNull(property.scope) ? scope : property.scope;
					property.restricted = types.isUndefinedOrNull(property.restricted) ? !!restrictedProperties?.includes(key) : property.restricted;
				}

				if (property.experiment) {
					if (!property.tags?.some(tag => tag.toLowerCase() === 'onexp')) {
						property.tags = property.tags ?? [];
						property.tags.push('onExP');
					}
				} else if (property.tags?.some(tag => tag.toLowerCase() === 'onexp')) {
					console.error(`Invalid tag 'onExP' found for property '${key}'. Please use 'experiment' property instead.`);
					property.experiment = { mode: 'startup' };
				}

				const excluded = properties[key].hasOwnProperty('included') && !properties[key].included;
				const policyName = properties[key].policy?.name;
				const policyReferenceName = properties[key].policyReference?.name;
				const agentHostSync = properties[key].agentHost;

				if (agentHostSync) {
					this.agentHostSyncConfigurations.set(key, agentHostSync);
				}

				if (excluded) {
					this.excludedConfigurationProperties[key] = properties[key];
					if (policyName) {
						this.policyConfigurations.set(policyName, key);
						bucket.add(key);
					}
					if (policyReferenceName) {
						this.addPolicyReferenceConfiguration(policyReferenceName, key);
						bucket.add(key);
					}
					if (agentHostSync) {
						bucket.add(key);
						let excludedSyncKeys = this.excludedAgentHostSyncKeys.get(configuration);
						if (!excludedSyncKeys) {
							excludedSyncKeys = new Set<string>();
							this.excludedAgentHostSyncKeys.set(configuration, excludedSyncKeys);
						}
						excludedSyncKeys.add(key);
					}
					delete properties[key];
				} else {
					bucket.add(key);
					if (policyName) {
						this.policyConfigurations.set(policyName, key);
					}
					if (policyReferenceName) {
						this.addPolicyReferenceConfiguration(policyReferenceName, key);
					}
					this.configurationProperties[key] = properties[key];
					if (!properties[key].deprecationMessage && properties[key].markdownDeprecationMessage) {
						properties[key].deprecationMessage = properties[key].markdownDeprecationMessage;
					}
				}


			}
		}
		const subNodes = configuration.allOf;
		if (subNodes) {
			for (const node of subNodes) {
				this.validateAndRegisterProperties(node, validate, extensionInfo, restrictedProperties, scope, bucket);
			}
		}
	}

	private addPolicyReferenceConfiguration(policyName: PolicyName, key: string): void {
		let keys = this.policyReferenceConfigurations.get(policyName);
		if (!keys) {
			keys = new Set<string>();
			this.policyReferenceConfigurations.set(policyName, keys);
		}
		keys.add(key);
	}

	getConfigurations(): IConfigurationNode[] {
		return this.configurationContributors;
	}

	getConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema> {
		return this.configurationProperties;
	}

	getPolicyConfigurations(): Map<PolicyName, string> {
		return this.policyConfigurations;
	}

	getPolicyReferenceConfigurations(): Map<PolicyName, Set<string>> {
		return this.policyReferenceConfigurations;
	}

	getAgentHostSyncConfigurations(): Map<string, IAgentHostConfigurationSync> {
		return this.agentHostSyncConfigurations;
	}

	getExcludedConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema> {
		return this.excludedConfigurationProperties;
	}

	getRegisteredDefaultConfigurations(): IConfigurationDefaults[] {
		return [...this.registeredConfigurationDefaults];
	}

	getConfigurationDefaultsOverrides(): Map<string, IConfigurationDefaultOverrideValue> {
		const configurationDefaultsOverrides = new Map<string, IConfigurationDefaultOverrideValue>();
		for (const [key, value] of this.configurationDefaultsOverrides) {
			if (value.configurationDefaultOverrideValue) {
				configurationDefaultsOverrides.set(key, value.configurationDefaultOverrideValue);
			}
		}
		return configurationDefaultsOverrides;
	}

	private registerJSONConfiguration(configuration: IConfigurationNode) {
		const register = (configuration: IConfigurationNode) => {
			const properties = configuration.properties;
			if (properties) {
				for (const key in properties) {
					this.updateSchema(key, properties[key]);
				}
			}
			const subNodes = configuration.allOf;
			subNodes?.forEach(register);
		};
		register(configuration);
	}

	private updateSchema(key: string, property: IConfigurationPropertySchema): void {
		allSettings.properties[key] = property;
		switch (property.scope) {
			case ConfigurationScope.APPLICATION:
				applicationSettings.properties[key] = property;
				break;
			case ConfigurationScope.MACHINE:
				machineSettings.properties[key] = property;
				break;
			case ConfigurationScope.APPLICATION_MACHINE:
				applicationMachineSettings.properties[key] = property;
				break;
			case ConfigurationScope.MACHINE_OVERRIDABLE:
				machineOverridableSettings.properties[key] = property;
				break;
			case ConfigurationScope.WINDOW:
				windowSettings.properties[key] = property;
				break;
			case ConfigurationScope.RESOURCE:
				resourceSettings.properties[key] = property;
				break;
			case ConfigurationScope.LANGUAGE_OVERRIDABLE:
				resourceSettings.properties[key] = property;
				this.resourceLanguageSettingsSchema.properties![key] = property;
				break;
		}
	}

	private removeFromSchema(key: string, property: IConfigurationPropertySchema): void {
		delete allSettings.properties[key];
		switch (property.scope) {
			case ConfigurationScope.APPLICATION:
				delete applicationSettings.properties[key];
				break;
			case ConfigurationScope.MACHINE:
				delete machineSettings.properties[key];
				break;
			case ConfigurationScope.APPLICATION_MACHINE:
				delete applicationMachineSettings.properties[key];
				break;
			case ConfigurationScope.MACHINE_OVERRIDABLE:
				delete machineOverridableSettings.properties[key];
				break;
			case ConfigurationScope.WINDOW:
				delete windowSettings.properties[key];
				break;
			case ConfigurationScope.RESOURCE:
			case ConfigurationScope.LANGUAGE_OVERRIDABLE:
				delete resourceSettings.properties[key];
				delete this.resourceLanguageSettingsSchema.properties![key];
				break;
		}
	}

	private updateOverridePropertyPatternKey(): void {
		for (const overrideIdentifier of this.overrideIdentifiers.values()) {
			const overrideIdentifierProperty = `[${overrideIdentifier}]`;
			const resourceLanguagePropertiesSchema: IJSONSchema = {
				type: 'object',
				description: nls.localize('overrideSettings.defaultDescription', "Configure editor settings to be overridden for a language."),
				errorMessage: nls.localize('overrideSettings.errorMessage', "This setting does not support per-language configuration."),
				$ref: resourceLanguageSettingsSchemaId,
			};
			this.updatePropertyDefaultValue(overrideIdentifierProperty, resourceLanguagePropertiesSchema);
			allSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			applicationSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			applicationMachineSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			machineSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			machineOverridableSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			windowSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
			resourceSettings.properties[overrideIdentifierProperty] = resourceLanguagePropertiesSchema;
		}
	}

	private registerOverridePropertyPatternKey(): void {
		const resourceLanguagePropertiesSchema: IJSONSchema = {
			type: 'object',
			description: nls.localize('overrideSettings.defaultDescription', "Configure editor settings to be overridden for a language."),
			errorMessage: nls.localize('overrideSettings.errorMessage', "This setting does not support per-language configuration."),
			$ref: resourceLanguageSettingsSchemaId,
		};
		allSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		applicationSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		applicationMachineSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		machineSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		machineOverridableSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		windowSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		resourceSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema;
		this._onDidSchemaChange.fire();
	}

	private updatePropertyDefaultValue(key: string, property: IRegisteredConfigurationPropertySchema): void {
		const configurationdefaultOverride = this.configurationDefaultsOverrides.get(key)?.configurationDefaultOverrideValue;
		let defaultValue = undefined;
		let defaultSource = undefined;
		if (configurationdefaultOverride
			&& (!property.disallowConfigurationDefault || !configurationdefaultOverride.source)
		) {
			defaultValue = configurationdefaultOverride.value;
			defaultSource = configurationdefaultOverride.source;
		}
		if (types.isUndefined(defaultValue)) {
			defaultValue = property.defaultDefaultValue;
			defaultSource = undefined;
		}
		if (types.isUndefined(defaultValue)) {
			defaultValue = getDefaultValue(property.type);
		}
		property.default = defaultValue;
		property.defaultValueSource = defaultSource;
	}
}

const OVERRIDE_IDENTIFIER_PATTERN = `\\[([^\\]]+)\\]`;
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, 'g');
export const OVERRIDE_PROPERTY_PATTERN = `^(${OVERRIDE_IDENTIFIER_PATTERN})+$`;
export const OVERRIDE_PROPERTY_REGEX = new RegExp(OVERRIDE_PROPERTY_PATTERN);

export function overrideIdentifiersFromKey(key: string): string[] {
	const identifiers: string[] = [];
	if (OVERRIDE_PROPERTY_REGEX.test(key)) {
		let matches = OVERRIDE_IDENTIFIER_REGEX.exec(key);
		while (matches?.length) {
			const identifier = matches[1].trim();
			if (identifier) {
				identifiers.push(identifier);
			}
			matches = OVERRIDE_IDENTIFIER_REGEX.exec(key);
		}
	}
	return distinct(identifiers);
}

export function keyFromOverrideIdentifiers(overrideIdentifiers: string[]): string {
	return overrideIdentifiers.reduce((result, overrideIdentifier) => `${result}[${overrideIdentifier}]`, '');
}

export function getDefaultValue(type: string | string[] | undefined) {
	const t = Array.isArray(type) ? type[0] : <string>type;
	switch (t) {
		case 'boolean':
			return false;
		case 'integer':
		case 'number':
			return 0;
		case 'string':
			return '';
		case 'array':
			return [];
		case 'object':
			return {};
		default:
			return null;
	}
}

const configurationRegistry = new ConfigurationRegistry();
Registry.add(Extensions.Configuration, configurationRegistry);

export function validateProperty(property: string, schema: IRegisteredConfigurationPropertySchema, extensionId?: string): string | null {
	if (!property.trim()) {
		return nls.localize('config.property.empty', "Cannot register an empty property");
	}
	if (OVERRIDE_PROPERTY_REGEX.test(property)) {
		return nls.localize('config.property.languageDefault', "Cannot register '{0}'. This matches property pattern '\\\\[.*\\\\]$' for describing language specific editor settings. Use 'configurationDefaults' contribution.", property);
	}
	if (configurationRegistry.getConfigurationProperties()[property] !== undefined && (!extensionId || !EXTENSION_UNIFICATION_EXTENSION_IDS.has(extensionId.toLowerCase()))) {
		return nls.localize('config.property.duplicate', "Cannot register '{0}'. This property is already registered.", property);
	}
	if (schema.policy && schema.policyReference) {
		return nls.localize('config.policy.bothPolicyAndReference', "Cannot register '{0}'. A setting must not declare both 'policy' and 'policyReference'.", property);
	}
	if (schema.policy?.name && configurationRegistry.getPolicyConfigurations().get(schema.policy?.name) !== undefined) {
		return nls.localize('config.policy.duplicate', "Cannot register '{0}'. The associated policy {1} is already registered with {2}. To attach another setting to the same policy, use 'policyReference'.", property, schema.policy?.name, configurationRegistry.getPolicyConfigurations().get(schema.policy?.name));
	}
	if (schema.agentHost) {
		for (const [owner, sync] of configurationRegistry.getAgentHostSyncConfigurations()) {
			if (sync.key === schema.agentHost.key && owner !== property) {
				return nls.localize('config.agentHost.duplicate', "Cannot register '{0}'. The agent host configuration key '{1}' is already mirrored from '{2}'.", property, schema.agentHost.key, owner);
			}
		}
	}
	return null;
}

export function getScopes(): [string, ConfigurationScope | undefined][] {
	const scopes: [string, ConfigurationScope | undefined][] = [];
	const configurationProperties = configurationRegistry.getConfigurationProperties();
	for (const key of Object.keys(configurationProperties)) {
		scopes.push([key, configurationProperties[key].scope]);
	}
	scopes.push(['launch', ConfigurationScope.RESOURCE]);
	scopes.push(['task', ConfigurationScope.RESOURCE]);
	return scopes;
}

export function getAllConfigurationProperties(configurationNode: IConfigurationNode[]): IStringDictionary<IRegisteredConfigurationPropertySchema> {
	const result: IStringDictionary<IRegisteredConfigurationPropertySchema> = {};
	for (const configuration of configurationNode) {
		const properties = configuration.properties;
		if (types.isObject(properties)) {
			for (const key in properties) {
				result[key] = properties[key];
			}
		}
		if (configuration.allOf) {
			Object.assign(result, getAllConfigurationProperties(configuration.allOf));
		}
	}
	return result;
}

export function parseScope(scope: string): ConfigurationScope {
	switch (scope) {
		case 'application':
			return ConfigurationScope.APPLICATION;
		case 'machine':
			return ConfigurationScope.MACHINE;
		case 'resource':
			return ConfigurationScope.RESOURCE;
		case 'machine-overridable':
			return ConfigurationScope.MACHINE_OVERRIDABLE;
		case 'language-overridable':
			return ConfigurationScope.LANGUAGE_OVERRIDABLE;
		default:
			return ConfigurationScope.WINDOW;
	}
}

export const EXTENSION_UNIFICATION_EXTENSION_IDS: Set<string> = new Set(product.defaultChatAgent ? [product.defaultChatAgent.extensionId, product.defaultChatAgent.chatExtensionId].map(id => id.toLowerCase()) : []);
