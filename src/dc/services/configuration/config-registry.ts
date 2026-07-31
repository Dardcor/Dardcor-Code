/**
 * Dardcor Code - Schema-Backed Configuration Registry (Task 115)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export type ConfigurationValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface IConfigurationPropertySchema {
	readonly type?: ConfigurationValueType | ConfigurationValueType[];
	readonly default?: any;
	readonly enum?: any[];
	readonly enumDescriptions?: string[];
	readonly description?: string;
	readonly markdownDescription?: string;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly items?: IConfigurationPropertySchema;
	readonly scope?: number;
	readonly tags?: string[];
}

export type IConfigurationProperties = Record<string, IConfigurationPropertySchema>;

export interface IConfigurationNode {
	readonly id: string;
	readonly title?: string;
	readonly order?: number;
	readonly type?: 'object' | 'array' | 'string' | 'boolean' | 'number' | 'null';
	readonly properties?: IConfigurationProperties;
	readonly overrides?: { [pattern: string]: { properties: IConfigurationProperties } };
}

export interface IConfigurationRegistry {
	readonly _serviceBrand: undefined;
	registerConfiguration(node: IConfigurationNode): IDisposable;
	registerOverrideIdentifier(identifier: string): IDisposable;
	getConfigurationProperties(): IConfigurationProperties;
	getConfigurationNode(id: string): IConfigurationNode | undefined;
	getOverrideIdentifiers(): string[];
	getDefaults(): Record<string, any>;
	validate(key: string, value: any): string[];
	validateAll(config: Record<string, any>): Record<string, string[]>;
}

export const IConfigurationRegistry = createDecorator<IConfigurationRegistry>('configurationRegistry');

export class ConfigurationRegistry extends Disposable implements IConfigurationRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly _properties = new Map<string, IConfigurationPropertySchema>();
	private readonly _nodes = new Map<string, IConfigurationNode>();
	private readonly _overrideIdentifiers = new Set<string>();

	public registerConfiguration(node: IConfigurationNode): IDisposable {
		if (!node.properties && !node.overrides) {
			return Disposable.None;
		}
		const added: string[] = [];
		this._nodes.set(node.id, node);
		if (node.properties) {
			for (const [key, schema] of Object.entries(node.properties)) {
				if (!this._properties.has(key)) {
					this._properties.set(key, schema);
					added.push(key);
				}
			}
		}
		if (node.overrides) {
			for (const identifier of Object.keys(node.overrides)) {
				this._overrideIdentifiers.add(identifier);
			}
		}
		return toDisposable(() => {
			this._nodes.delete(node.id);
			for (const key of added) {
				this._properties.delete(key);
			}
		});
	}

	public registerOverrideIdentifier(identifier: string): IDisposable {
		this._overrideIdentifiers.add(identifier);
		return toDisposable(() => this._overrideIdentifiers.delete(identifier));
	}

	public getConfigurationProperties(): IConfigurationProperties {
		return Object.fromEntries(this._properties) as IConfigurationProperties;
	}

	public getConfigurationNode(id: string): IConfigurationNode | undefined {
		return this._nodes.get(id);
	}

	public getOverrideIdentifiers(): string[] {
		return [...this._overrideIdentifiers];
	}

	public getDefaults(): Record<string, any> {
		const defaults: Record<string, any> = {};
		for (const [key, schema] of this._properties) {
			if (schema.default !== undefined) {
				defaults[key] = schema.default;
			}
		}
		return defaults;
	}

	public validate(key: string, value: any): string[] {
		const schema = this._properties.get(key);
		if (!schema) {
			return [];
		}
		const errors: string[] = [];
		const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;

		if (types) {
			const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
			if (!types.includes(actual as ConfigurationValueType)) {
				errors.push(`'${key}' must be of type ${types.join(' or ')}, got ${actual}`);
			}
		}
		if (schema.enum && !schema.enum.some((e) => Object.is(e, value))) {
			errors.push(`'${key}' must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
		}
		if (typeof value === 'number') {
			if (schema.minimum !== undefined && value < schema.minimum) {
				errors.push(`'${key}' must be >= ${schema.minimum}`);
			}
			if (schema.maximum !== undefined && value > schema.maximum) {
				errors.push(`'${key}' must be <= ${schema.maximum}`);
			}
		}
		return errors;
	}

	public validateAll(config: Record<string, any>): Record<string, string[]> {
		const result: Record<string, string[]> = {};
		for (const key of Object.keys(config)) {
			const errors = this.validate(key, config[key]);
			if (errors.length > 0) {
				result[key] = errors;
			}
		}
		return result;
	}
}

let _globalRegistry: ConfigurationRegistry | null = null;

export function getConfigurationRegistry(): ConfigurationRegistry {
	if (!_globalRegistry) {
		_globalRegistry = new ConfigurationRegistry();
	}
	return _globalRegistry;
}

export function registerConfiguration(node: IConfigurationNode): IDisposable {
	return getConfigurationRegistry().registerConfiguration(node);
}

export function getConfigurationProperties(): IConfigurationProperties {
	return getConfigurationRegistry().getConfigurationProperties();
}
