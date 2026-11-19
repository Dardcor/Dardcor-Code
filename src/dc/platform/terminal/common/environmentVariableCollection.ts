/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment, isWindows } from '../../../base/common/platform.js';
import { EnvironmentVariableMutatorType, EnvironmentVariableScope, IEnvironmentVariableCollection, IExtensionOwnedEnvironmentDescriptionMutator, IExtensionOwnedEnvironmentVariableMutator, IMergedEnvironmentVariableCollection, IMergedEnvironmentVariableCollectionDiff } from './environmentVariable.js';

type VariableResolver = (str: string) => Promise<string>;

const mutatorTypeToLabelMap: Map<EnvironmentVariableMutatorType, string> = new Map([
	[EnvironmentVariableMutatorType.Append, 'APPEND'],
	[EnvironmentVariableMutatorType.Prepend, 'PREPEND'],
	[EnvironmentVariableMutatorType.Replace, 'REPLACE']
]);
const PYTHON_ACTIVATION_VARS_PATTERN = /^VSCODE_PYTHON_(PWSH|ZSH|BASH|FISH)_ACTIVATE/;
const PYTHON_ENV_EXTENSION_ID = 'ms-python.vscode-python-envs';

export class MergedEnvironmentVariableCollection implements IMergedEnvironmentVariableCollection {
	private readonly map: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();
	private readonly descriptionMap: Map<string, IExtensionOwnedEnvironmentDescriptionMutator[]> = new Map();

	constructor(
		readonly collections: ReadonlyMap<string, IEnvironmentVariableCollection>,
	) {
		collections.forEach((collection, extensionIdentifier) => {
			this.populateDescriptionMap(collection, extensionIdentifier);
			const it = collection.map.entries();
			let next = it.next();
			while (!next.done) {
				const mutator = next.value[1];
				const key = next.value[0];

				if (this.blockPythonActivationVar(key, extensionIdentifier)) {
					next = it.next();
					continue;
				}

				let entry = this.map.get(key);
				if (!entry) {
					entry = [];
					this.map.set(key, entry);
				}

				if (entry.length > 0 && entry[0].type === EnvironmentVariableMutatorType.Replace) {
					next = it.next();
					continue;
				}

				const extensionMutator = {
					extensionIdentifier,
					value: mutator.value,
					type: mutator.type,
					scope: mutator.scope,
					variable: mutator.variable,
					options: mutator.options
				};
				if (!extensionMutator.scope) {
					delete extensionMutator.scope;
				}
				entry.unshift(extensionMutator);

				next = it.next();
			}
		});
	}

	async applyToProcessEnvironment(env: IProcessEnvironment, scope: EnvironmentVariableScope | undefined, variableResolver?: VariableResolver): Promise<void> {
		let lowerToActualVariableNames: { [lowerKey: string]: string | undefined } | undefined;
		if (isWindows) {
			lowerToActualVariableNames = {};
			Object.keys(env).forEach(e => lowerToActualVariableNames![e.toLowerCase()] = e);
		}
		for (const [variable, mutators] of this.getVariableMap(scope)) {
			const actualVariable = isWindows ? lowerToActualVariableNames![variable.toLowerCase()] || variable : variable;
			for (const mutator of mutators) {
				const value = variableResolver ? await variableResolver(mutator.value) : mutator.value;

				if (this.blockPythonActivationVar(mutator.variable, mutator.extensionIdentifier)) {
					continue;
				}

				if (mutator.options?.applyAtProcessCreation ?? true) {
					switch (mutator.type) {
						case EnvironmentVariableMutatorType.Append:
							env[actualVariable] = (env[actualVariable] || '') + value;
							break;
						case EnvironmentVariableMutatorType.Prepend:
							env[actualVariable] = value + (env[actualVariable] || '');
							break;
						case EnvironmentVariableMutatorType.Replace:
							env[actualVariable] = value;
							break;
					}
				}
				if (mutator.options?.applyAtShellIntegration ?? false) {
					const key = `VSCODE_ENV_${mutatorTypeToLabelMap.get(mutator.type)!}`;
					env[key] = (env[key] ? env[key] + ':' : '') + variable + '=' + this._encodeColons(value);
				}
			}
		}
	}

	private _encodeColons(value: string): string {
		return value.replaceAll(':', '\\x3a');
	}

	private blockPythonActivationVar(variable: string, extensionIdentifier: string): boolean {
		if (PYTHON_ACTIVATION_VARS_PATTERN.test(variable) && PYTHON_ENV_EXTENSION_ID !== extensionIdentifier) {
			return true;
		}
		return false;
	}

	diff(other: IMergedEnvironmentVariableCollection, scope: EnvironmentVariableScope | undefined): IMergedEnvironmentVariableCollectionDiff | undefined {
		const added: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();
		const changed: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();
		const removed: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();

		other.getVariableMap(scope).forEach((otherMutators, variable) => {
			const currentMutators = this.getVariableMap(scope).get(variable);
			const result = getMissingMutatorsFromArray(otherMutators, currentMutators);
			if (result) {
				added.set(variable, result);
			}
		});

		this.getVariableMap(scope).forEach((currentMutators, variable) => {
			const otherMutators = other.getVariableMap(scope).get(variable);
			const result = getMissingMutatorsFromArray(currentMutators, otherMutators);
			if (result) {
				removed.set(variable, result);
			}
		});

		this.getVariableMap(scope).forEach((currentMutators, variable) => {
			const otherMutators = other.getVariableMap(scope).get(variable);
			const result = getChangedMutatorsFromArray(currentMutators, otherMutators);
			if (result) {
				changed.set(variable, result);
			}
		});

		if (added.size === 0 && changed.size === 0 && removed.size === 0) {
			return undefined;
		}

		return { added, changed, removed };
	}

	getVariableMap(scope: EnvironmentVariableScope | undefined): Map<string, IExtensionOwnedEnvironmentVariableMutator[]> {
		const result = new Map<string, IExtensionOwnedEnvironmentVariableMutator[]>();
		for (const mutators of this.map.values()) {
			const filteredMutators = mutators.filter(m => filterScope(m, scope));
			if (filteredMutators.length > 0) {
				result.set(filteredMutators[0].variable, filteredMutators);
			}
		}
		return result;
	}

	getDescriptionMap(scope: EnvironmentVariableScope | undefined): Map<string, string | undefined> {
		const result = new Map<string, string | undefined>();
		for (const mutators of this.descriptionMap.values()) {
			const filteredMutators = mutators.filter(m => filterScope(m, scope, true));
			for (const mutator of filteredMutators) {
				result.set(mutator.extensionIdentifier, mutator.description);
			}
		}
		return result;
	}

	private populateDescriptionMap(collection: IEnvironmentVariableCollection, extensionIdentifier: string): void {
		if (!collection.descriptionMap) {
			return;
		}
		const it = collection.descriptionMap.entries();
		let next = it.next();
		while (!next.done) {
			const mutator = next.value[1];
			const key = next.value[0];
			let entry = this.descriptionMap.get(key);
			if (!entry) {
				entry = [];
				this.descriptionMap.set(key, entry);
			}
			const extensionMutator = {
				extensionIdentifier,
				scope: mutator.scope,
				description: mutator.description
			};
			if (!extensionMutator.scope) {
				delete extensionMutator.scope;
			}
			entry.push(extensionMutator);

			next = it.next();
		}

	}
}








function filterScope(
	mutator: IExtensionOwnedEnvironmentVariableMutator | IExtensionOwnedEnvironmentDescriptionMutator,
	scope: EnvironmentVariableScope | undefined,
	strictFilter = false
): boolean {
	if (!mutator.scope) {
		if (strictFilter) {
			return scope === mutator.scope;
		}
		return true;
	}
	if (mutator.scope.workspaceFolder && scope?.workspaceFolder && mutator.scope.workspaceFolder.index === scope.workspaceFolder.index) {
		return true;
	}
	return false;
}

function getMissingMutatorsFromArray(
	current: IExtensionOwnedEnvironmentVariableMutator[],
	other: IExtensionOwnedEnvironmentVariableMutator[] | undefined
): IExtensionOwnedEnvironmentVariableMutator[] | undefined {
	if (!other) {
		return current;
	}

	const otherMutatorExtensions = new Set<string>();
	other.forEach(m => otherMutatorExtensions.add(m.extensionIdentifier));

	const result: IExtensionOwnedEnvironmentVariableMutator[] = [];
	current.forEach(mutator => {
		if (!otherMutatorExtensions.has(mutator.extensionIdentifier)) {
			result.push(mutator);
		}
	});

	return result.length === 0 ? undefined : result;
}

function getChangedMutatorsFromArray(
	current: IExtensionOwnedEnvironmentVariableMutator[],
	other: IExtensionOwnedEnvironmentVariableMutator[] | undefined
): IExtensionOwnedEnvironmentVariableMutator[] | undefined {
	if (!other) {
		return undefined;
	}

	const otherMutatorExtensions = new Map<string, IExtensionOwnedEnvironmentVariableMutator>();
	other.forEach(m => otherMutatorExtensions.set(m.extensionIdentifier, m));

	const result: IExtensionOwnedEnvironmentVariableMutator[] = [];
	current.forEach(mutator => {
		const otherMutator = otherMutatorExtensions.get(mutator.extensionIdentifier);
		if (otherMutator && (mutator.type !== otherMutator.type || mutator.value !== otherMutator.value || mutator.scope?.workspaceFolder?.index !== otherMutator.scope?.workspaceFolder?.index)) {
			result.push(otherMutator);
		}
	});

	return result.length === 0 ? undefined : result;
}
