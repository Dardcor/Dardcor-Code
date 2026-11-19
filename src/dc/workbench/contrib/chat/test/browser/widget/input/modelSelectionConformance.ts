/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ModelSelectionConformanceModel = 'first' | 'second' | 'missing';

export type ModelSelectionConformanceSource = 'chosen' | 'carriedOver';

export interface IModelSelectionConformanceScenario {
	readonly name: string;
	readonly isEmpty: boolean;
	readonly models: readonly Exclude<ModelSelectionConformanceModel, 'missing'>[];
	readonly chatModel?: ModelSelectionConformanceModel;
	readonly chatModelSource?: ModelSelectionConformanceSource;
	readonly rememberedModel?: ModelSelectionConformanceModel;
	readonly configuredModel?: ModelSelectionConformanceModel;
	readonly catalogResolved?: boolean;
	readonly expected: {
		readonly currentModel: Exclude<ModelSelectionConformanceModel, 'missing'> | undefined;
		readonly conversationModel: Exclude<ModelSelectionConformanceModel, 'missing'> | undefined;
	};
}

export interface IModelSelectionConformanceInputs {
	readonly isEmpty: boolean;
	readonly models: readonly Exclude<ModelSelectionConformanceModel, 'missing'>[];
	readonly chatModel: ModelSelectionConformanceModel | undefined;
	readonly chatModelSource: ModelSelectionConformanceSource | undefined;
	readonly rememberedModel: ModelSelectionConformanceModel | undefined;
	readonly configuredModel: ModelSelectionConformanceModel | undefined;
	readonly catalogResolved: boolean;
}

export function conformanceInputs(scenario: IModelSelectionConformanceScenario): IModelSelectionConformanceInputs {
	return {
		isEmpty: scenario.isEmpty,
		models: scenario.models,
		chatModel: scenario.chatModel,
		chatModelSource: scenario.chatModelSource,
		rememberedModel: scenario.rememberedModel,
		configuredModel: scenario.configuredModel,
		catalogResolved: scenario.catalogResolved ?? true,
	};
}

export const modelSelectionConformanceScenarios: readonly IModelSelectionConformanceScenario[] = [
	{
		name: 'configured default beats remembered preference on an empty conversation',
		isEmpty: true,
		models: ['first', 'second'],
		rememberedModel: 'first',
		configuredModel: 'second',
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'remembered preference seeds an empty conversation without a configured default',
		isEmpty: true,
		models: ['first', 'second'],
		rememberedModel: 'second',
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'first available model seeds an empty conversation without another preference',
		isEmpty: true,
		models: ['first', 'second'],
		expected: { currentModel: 'first', conversationModel: 'first' },
	},
	{
		name: 'conversation choice blocks the configured default even while empty',
		isEmpty: true,
		models: ['first', 'second'],
		chatModel: 'first',
		chatModelSource: 'chosen',
		configuredModel: 'second',
		expected: { currentModel: 'first', conversationModel: 'first' },
	},
	{
		name: 'a restored model the chat owns is not treated as carried over on an empty conversation',
		isEmpty: true,
		models: ['first', 'second'],
		chatModel: 'second',
		chatModelSource: 'chosen',
		rememberedModel: 'first',
		configuredModel: 'first',
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'a carried-over model yields to the configured default on an empty conversation',
		isEmpty: true,
		models: ['first', 'second'],
		chatModel: 'first',
		chatModelSource: 'carriedOver',
		configuredModel: 'second',
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'a carried-over model remains selected when no configured default exists',
		isEmpty: true,
		models: ['first', 'second'],
		chatModel: 'first',
		chatModelSource: 'carriedOver',
		expected: { currentModel: 'first', conversationModel: 'first' },
	},
	{
		name: 'configured default does not reseed a non-empty conversation choice',
		isEmpty: false,
		models: ['first', 'second'],
		chatModel: 'first',
		chatModelSource: 'chosen',
		configuredModel: 'second',
		expected: { currentModel: 'first', conversationModel: 'first' },
	},
	{
		name: 'configured default does not reseed a non-empty carried-over model',
		isEmpty: false,
		models: ['first', 'second'],
		chatModel: 'first',
		chatModelSource: 'carriedOver',
		configuredModel: 'second',
		expected: { currentModel: 'first', conversationModel: 'first' },
	},
	{
		name: 'unresolvable configured value falls through to the remembered preference',
		isEmpty: true,
		models: ['first', 'second'],
		rememberedModel: 'second',
		configuredModel: 'missing',
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'available configured default supersedes a remembered model while its vendor is unresolved',
		isEmpty: true,
		models: ['first', 'second'],
		rememberedModel: 'missing',
		configuredModel: 'second',
		catalogResolved: false,
		expected: { currentModel: 'second', conversationModel: 'second' },
	},
	{
		name: 'empty catalog leaves the conversation without a model',
		isEmpty: true,
		models: [],
		expected: { currentModel: undefined, conversationModel: undefined },
	},
];
