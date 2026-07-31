/**
 * Dardcor Code - Hierarchical Configuration Model Merger (Task 114)
 */

export interface IConfigurationModel {
	readonly name: string;
	keys(): Iterable<string>;
	getValue<T>(key: string): T | undefined;
	getValues<T>(): Record<string, T>;
	override(identifier: string): IConfigurationModel | undefined;
	hasOverride(identifier: string): boolean;
	merge(...others: IConfigurationModel[]): IConfigurationModel;
	toJSON(): Record<string, any>;
}

export class ConfigurationModel implements IConfigurationModel {
	private readonly _contents: Map<string, any>;
	private readonly _overrides: Map<string, Map<string, any>>;

	constructor(
		contents?: Map<string, any>,
		overrides?: Map<string, Map<string, any>>,
		public readonly name: string = 'anonymous'
	) {
		this._contents = contents ?? new Map<string, any>();
		this._overrides = overrides ?? new Map<string, Map<string, any>>();
	}

	public keys(): Iterable<string> {
		return this._contents.keys();
	}

	public getValue<T>(key: string): T | undefined {
		return this._contents.get(key) as T | undefined;
	}

	public getValues<T>(): Record<string, T> {
		return Object.fromEntries(this._contents) as Record<string, T>;
	}

	public override(identifier: string): IConfigurationModel | undefined {
		const overrides = this._overrides.get(identifier);
		if (!overrides) {
			return undefined;
		}
		return new ConfigurationModel(overrides, undefined, `${this.name}[${identifier}]`);
	}

	public hasOverride(identifier: string): boolean {
		return this._overrides.has(identifier);
	}

	public merge(...others: IConfigurationModel[]): ConfigurationModel {
		const contents = new Map(this._contents);
		const overrides = new Map<string, Map<string, any>>();
		for (const [id, map] of this._overrides) {
			overrides.set(id, new Map(map));
		}
		for (const other of others) {
			if (other instanceof ConfigurationModel) {
				for (const [key, value] of other._contents) {
					contents.set(key, value);
				}
				for (const [id, map] of other._overrides) {
					let target = overrides.get(id);
					if (!target) {
						target = new Map<string, any>();
						overrides.set(id, target);
					}
					for (const [key, value] of map) {
						target.set(key, value);
					}
				}
			} else {
				for (const key of other.keys()) {
					contents.set(key, other.getValue(key));
				}
			}
		}
		return new ConfigurationModel(contents, overrides, `${this.name} (merged)`);
	}

	public toJSON(): Record<string, any> {
		return Object.fromEntries(this._contents);
	}
}

function shouldFlatten(value: any): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function flatten(value: any, prefix: string, target: Map<string, any>, objectTypedKeys: ReadonlySet<string>): void {
	if (shouldFlatten(value) && !objectTypedKeys.has(prefix)) {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, target, objectTypedKeys);
		}
	} else {
		target.set(prefix, value);
	}
}

export class ConfigurationModelParser {
	private readonly _model: ConfigurationModel;

	constructor(name: string) {
		this._model = new ConfigurationModel(undefined, undefined, name);
	}

	public parse(content: string, objectTypedKeys: ReadonlySet<string> = new Set()): ConfigurationModel {
		const contents = new Map<string, any>();
		const overrides = new Map<string, Map<string, any>>();
		let raw: any = null;
		try {
			raw = JSON.parse(content);
		} catch {
			raw = null;
		}
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			for (const [key, value] of Object.entries(raw)) {
				const overrideMatch = /^\[([^\]]+)\]$/.exec(key);
				if (overrideMatch) {
					const map = new Map<string, any>();
					flatten(value, '', map, objectTypedKeys);
					overrides.set(overrideMatch[1].trim(), map);
				} else {
					flatten(value, key, contents, objectTypedKeys);
				}
			}
		}
		return new ConfigurationModel(contents, overrides, this._model.name);
	}
}

export interface IConfigurationChangeEvent {
	readonly changedKeys: ReadonlyArray<string>;
	affectsConfiguration(section: string): boolean;
}

export class ConfigurationChangeEvent implements IConfigurationChangeEvent {
	constructor(
		private readonly _changedKeys: ReadonlySet<string>
	) {}

	get changedKeys(): ReadonlyArray<string> {
		return [...this._changedKeys];
	}

	public affectsConfiguration(section: string): boolean {
		if (this._changedKeys.has(section)) {
			return true;
		}
		const prefix = section + '.';
		for (const key of this._changedKeys) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}
}

export function createConfigurationChangeEvent(changedKeys: readonly string[]): ConfigurationChangeEvent {
	return new ConfigurationChangeEvent(new Set(changedKeys));
}

export function mergeModels(...models: IConfigurationModel[]): ConfigurationModel {
	if (models.length === 0) {
		return new ConfigurationModel();
	}
	const first = models[0] instanceof ConfigurationModel
		? models[0]
		: new ConfigurationModel(undefined, undefined, models[0].name);
	return first.merge(...models.slice(1));
}
