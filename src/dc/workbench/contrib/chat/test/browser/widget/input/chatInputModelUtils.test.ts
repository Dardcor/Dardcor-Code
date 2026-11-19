/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier } from '../../../../../../../platform/extensions/common/extensions.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../common/constants.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';
import { LocalChatSessionUri } from '../../../../common/model/chatUri.js';
import {
	filterModelsForSession,
	findBestMatchingModel,
	getAgentHostByokManageModelsIdentifier,
	hasModelsTargetingSession,
	isModelHiddenInPicker,
	isModelSupportedForInlineChat,
	resolveEditedRequestSelection,
	isModelSupportedForMode,
	isModelValidForSession,
	isNewConversation,
	isSessionStarted,
	mergeModelsWithCache,
	resolveModelFromSyncState,
	shouldDropAgnosticDraftModel,
	shouldResetModelToDefault,
	shouldResetOnModelListChange,
	shouldRestorePerTypeModelOnSessionSwitch,
} from '../../../../browser/widget/input/chatInputModelUtils.js';

function computeAvailableModels(
	liveModels: ILanguageModelChatMetadataAndIdentifier[],
	cachedModels: ILanguageModelChatMetadataAndIdentifier[],
	contributedVendors: Set<string>,
	sessionType: string | undefined,
	currentModeKind: ChatModeKind,
	location: ChatAgentLocation,
	resolvedVendors?: ReadonlySet<string>,
): ILanguageModelChatMetadataAndIdentifier[] {
	const merged = mergeModelsWithCache(liveModels, cachedModels, contributedVendors, resolvedVendors);
	merged.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
	return filterModelsForSession(merged, sessionType, currentModeKind, location);
}

function findDefaultModel(
	models: ILanguageModelChatMetadataAndIdentifier[],
	location: ChatAgentLocation,
): ILanguageModelChatMetadataAndIdentifier | undefined {
	return models.find(m => m.metadata.isDefaultForLocation[location]) ?? models[0];
}

function createModel(
	id: string,
	name: string,
	overrides?: Partial<ILanguageModelChatMetadata>,
): ILanguageModelChatMetadataAndIdentifier {
	return {
		identifier: `copilot/${id}`,
		metadata: {
			extension: new ExtensionIdentifier('test.ext'),
			id,
			name,
			vendor: 'dardcor',
			version: '1.0',
			family: 'copilot',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			isDefaultForLocation: {},
			isUserSelectable: true,
			capabilities: { toolCalling: true, agentMode: true },
			...overrides,
		} as ILanguageModelChatMetadata,
	};
}

function createDefaultModelForLocation(
	id: string,
	name: string,
	location: ChatAgentLocation,
	overrides?: Partial<ILanguageModelChatMetadata>,
): ILanguageModelChatMetadataAndIdentifier {
	return createModel(id, name, {
		isDefaultForLocation: { [location]: true },
		...overrides,
	});
}

function createSessionModel(
	id: string,
	name: string,
	sessionType: string,
	overrides?: Partial<ILanguageModelChatMetadata>,
): ILanguageModelChatMetadataAndIdentifier {
	return createModel(id, name, {
		targetChatSessionType: sessionType,
		...overrides,
	});
}

function createVendorModel(
	vendor: string,
	id: string,
	name: string,
	overrides?: Partial<ILanguageModelChatMetadata>,
): ILanguageModelChatMetadataAndIdentifier {
	const model = createModel(id, name, { vendor, family: vendor, isBYOK: true, ...overrides });
	return { identifier: `${vendor}/${id}`, metadata: model.metadata };
}

function supportedHere(location = ChatAgentLocation.Chat, mode = ChatModeKind.Ask) {
	return (model: ILanguageModelChatMetadataAndIdentifier) =>
		isModelSupportedForMode(model, mode) && isModelSupportedForInlineChat(model, location);
}

const anywhere = supportedHere();

suite('ChatInputModelUtils', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('isModelSupportedForMode', () => {

		test('any model is supported in Ask mode', () => {
			const model = createModel('basic', 'Basic', { capabilities: undefined });
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Ask), true);
		});

		test('any model is supported in Edit mode', () => {
			const model = createModel('basic', 'Basic', { capabilities: undefined });
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Edit), true);
		});

		test('model with tool calling and agent mode is supported in Agent mode', () => {
			const model = createModel('agent-capable', 'Agent-Capable', {
				capabilities: { toolCalling: true, agentMode: true },
			});
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Agent), true);
		});

		test('model with tool calling but agentMode=undefined is supported in Agent mode', () => {
			const model = createModel('tool-only', 'Tool-Only', {
				capabilities: { toolCalling: true },
			});
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Agent), true);
		});

		test('model without tool calling is NOT supported in Agent mode', () => {
			const model = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false },
			});
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Agent), false);
		});

		test('model with agentMode=false is NOT supported in Agent mode', () => {
			const model = createModel('no-agent', 'No-Agent', {
				capabilities: { toolCalling: true, agentMode: false },
			});
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Agent), false);
		});

		test('model with no capabilities is NOT supported in Agent mode', () => {
			const model = createModel('no-caps', 'No-Caps', { capabilities: undefined });
			assert.strictEqual(isModelSupportedForMode(model, ChatModeKind.Agent), false);
		});
	});

	suite('isModelSupportedForInlineChat', () => {

		test('any model is supported when not in EditorInline location', () => {
			const model = createModel('basic', 'Basic', { capabilities: undefined });
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.Chat), true);
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.Terminal), true);
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.Notebook), true);
		});

		test('model with tool calling is supported in EditorInline', () => {
			const model = createModel('tools', 'Tools', {
				capabilities: { toolCalling: true },
			});
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.EditorInline), true);
		});

		test('model without tool calling is NOT supported in EditorInline', () => {
			const model = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false },
			});
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.EditorInline), false);
		});

		test('model with no capabilities is NOT supported in EditorInline', () => {
			const model = createModel('no-caps', 'No-Caps', { capabilities: undefined });
			assert.strictEqual(isModelSupportedForInlineChat(model, ChatAgentLocation.EditorInline), false);
		});
	});

	suite('filterModelsForSession', () => {

		const gpt4o = createModel('gpt-4o', 'GPT-4o');
		const claude = createModel('claude', 'Claude');
		const notSelectable = createModel('hidden', 'Hidden', { isUserSelectable: false });
		const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
		const noToolsModel = createModel('no-tools', 'No-Tools', {
			capabilities: { toolCalling: false, agentMode: false },
		});

		test('returns user-selectable general models when no session type set', () => {
			const result = filterModelsForSession(
				[gpt4o, claude, notSelectable],
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o', 'claude']);
		});

		test('returns user-selectable general models for local session type', () => {
			const result = filterModelsForSession(
				[gpt4o, claude, notSelectable],
				'local',
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o', 'claude']);
		});

		test('excludes models targeting a specific session type when in general session', () => {
			const result = filterModelsForSession(
				[gpt4o, claude, cloudModel],
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o', 'claude']);
		});

		test('returns only session-targeted models for a specific session type', () => {
			const result = filterModelsForSession(
				[gpt4o, claude, cloudModel],
				'cloud',
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['cloud-gpt']);
		});

		test('filters out models incompatible with Agent mode in general session', () => {
			const result = filterModelsForSession(
				[gpt4o, noToolsModel],
				undefined,
				ChatModeKind.Agent,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o']);
		});

		test.skip('filters by mode for session-targeted models', () => {
			const cloudNoTools = createSessionModel('cloud-basic', 'Cloud Basic', 'cloud', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const result = filterModelsForSession(
				[gpt4o, cloudModel, cloudNoTools],
				'cloud',
				ChatModeKind.Agent,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['cloud-gpt']);
		});

		test('excludes non-selectable models from session-targeted results', () => {
			const cloudHidden = createSessionModel('cloud-hidden', 'Cloud Hidden', 'cloud', {
				isUserSelectable: false,
			});
			const result = filterModelsForSession(
				[cloudModel, cloudHidden],
				'cloud',
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['cloud-gpt']);
		});

		test('falls back to general models when no models target the session type', () => {
			const result = filterModelsForSession(
				[gpt4o, claude],
				'cloud',
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o', 'claude']);
		});

		test('filters inline chat incompatible models in EditorInline', () => {
			const noToolsSelectable = createModel('no-tools-selectable', 'No-Tools-Selectable', {
				capabilities: { toolCalling: false },
			});
			const result = filterModelsForSession(
				[gpt4o, noToolsSelectable],
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.EditorInline,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-4o']);
		});
	});

	suite('isSessionStarted', () => {

		test('only a bound, request-free session counts as unstarted', () => {
			assert.deepStrictEqual({
				boundAndEmpty: isSessionStarted(true, false),
				boundWithRequests: isSessionStarted(true, true),
				unbound: isSessionStarted(false, false),
			}, {
				boundAndEmpty: false,
				boundWithRequests: true,
				unbound: true,
			});
		});
	});

	suite('hasModelsTargetingSession', () => {

		test('returns false when session type is undefined', () => {
			const models = [createModel('gpt', 'GPT')];
			assert.strictEqual(hasModelsTargetingSession(models, undefined), false);
		});

		test('returns false when no models target the session type', () => {
			const models = [createModel('gpt', 'GPT')];
			assert.strictEqual(hasModelsTargetingSession(models, 'cloud'), false);
		});

		test('returns true when a model targets the session type', () => {
			const models = [
				createModel('gpt', 'GPT'),
				createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud'),
			];
			assert.strictEqual(hasModelsTargetingSession(models, 'cloud'), true);
		});

		test('returns false for different session type', () => {
			const models = [createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud')];
			assert.strictEqual(hasModelsTargetingSession(models, 'enterprise'), false);
		});
	});

	suite('isModelValidForSession', () => {

		test('general model is valid when no models target the session', () => {
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel];
			assert.strictEqual(isModelValidForSession(generalModel, allModels, 'cloud'), true);
		});

		test('session-targeted model is NOT valid when no models target the session type in pool', () => {
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			assert.strictEqual(isModelValidForSession(sessionModel, [generalModel], undefined), false);
		});

		test('session-targeted model IS valid when pool has models targeting that session', () => {
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const allModels = [createModel('gpt', 'GPT'), sessionModel];
			assert.strictEqual(isModelValidForSession(sessionModel, allModels, 'cloud'), true);
		});

		test('general model is NOT valid when pool has models targeting the session', () => {
			const generalModel = createModel('gpt', 'GPT');
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const allModels = [generalModel, sessionModel];
			assert.strictEqual(isModelValidForSession(generalModel, allModels, 'cloud'), false);
		});

		test('model targeting wrong session is NOT valid', () => {
			const wrongSessionModel = createSessionModel('ent-gpt', 'Enterprise GPT', 'enterprise');
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const allModels = [wrongSessionModel, cloudModel];
			assert.strictEqual(isModelValidForSession(wrongSessionModel, allModels, 'cloud'), false);
		});

		test('general model is valid when session type is undefined', () => {
			const generalModel = createModel('gpt', 'GPT');
			assert.strictEqual(isModelValidForSession(generalModel, [generalModel], undefined), true);
		});
	});

	suite('findBestMatchingModel', () => {

		test('returns undefined when previous is undefined', () => {
			const pool = [createSessionModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', 'agent-host-copilotcli')];
			assert.strictEqual(findBestMatchingModel(undefined, pool), undefined);
		});

		test('returns undefined for empty pool', () => {
			const prev = createModel('claude-sonnet-4.6', 'Claude Sonnet 4.6');
			assert.strictEqual(findBestMatchingModel(prev, []), undefined);
		});

		test('matches across vendors by raw model id (the issue #319583 case)', () => {
			const prev = createModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', { vendor: 'copilotcli', family: 'claude-sonnet-4.6' });
			const target = createSessionModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', 'agent-host-copilotcli', { family: 'claude-sonnet-4.6' });
			const other = createSessionModel('gpt-5', 'GPT-5', 'agent-host-copilotcli', { family: 'gpt-5' });
			assert.strictEqual(findBestMatchingModel(prev, [other, target])?.identifier, target.identifier);
		});

		test('matches by id even when family differs', () => {
			const prev = createModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', { family: 'claude' });
			const target = createSessionModel('claude-sonnet-4.6', 'Other Name', 'agent-host-copilotcli', { family: 'other' });
			assert.strictEqual(findBestMatchingModel(prev, [target])?.identifier, target.identifier);
		});

		test('prefers id over family when both could match different pool entries', () => {
			const prev = createModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', { family: 'claude' });
			const familyMatch = createSessionModel('claude-opus-4.7', 'Claude Opus 4.7', 'agent-host-copilotcli', { family: 'claude' });
			const idMatch = createSessionModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', 'agent-host-copilotcli', { family: 'claude-sonnet' });
			assert.strictEqual(findBestMatchingModel(prev, [familyMatch, idMatch])?.identifier, idMatch.identifier);
		});

		test('falls back to name when neither id nor family match', () => {
			const prev = createModel('a', 'Claude Sonnet 4.6', { family: 'fa' });
			const target = createSessionModel('b', 'Claude Sonnet 4.6', 'agent-host-copilotcli', { family: 'fb' });
			assert.strictEqual(findBestMatchingModel(prev, [target])?.identifier, target.identifier);
		});

		test('returns undefined when nothing matches', () => {
			const prev = createModel('gpt-5', 'GPT-5', { family: 'gpt-5' });
			const pool = [createSessionModel('claude', 'Claude', 'agent-host-copilotcli', { family: 'claude' })];
			assert.strictEqual(findBestMatchingModel(prev, pool), undefined);
		});

		test('match is case-insensitive', () => {
			const prev = createModel('Claude-Sonnet-4.6', 'CLAUDE SONNET 4.6', { family: 'CLAUDE-SONNET-4.6' });
			const target = createSessionModel('claude-sonnet-4.6', 'claude sonnet 4.6', 'agent-host-copilotcli', { family: 'claude-sonnet-4.6' });
			assert.strictEqual(findBestMatchingModel(prev, [target])?.identifier, target.identifier);
		});

		test('never carries a selection across the BYOK billing boundary', () => {
			const prev = createSessionModel('claude-opus-5', 'Claude Opus 5', 'agent-host-copilotcli', { family: 'claude-opus-5' });
			const byokNamesake = createSessionModel('anthropic/Anthropic/claude-opus-5', 'Claude Opus 5', 'agent-host-copilotcli', {
				family: 'claude-opus-5',
				byokModelIdentifier: 'anthropic/Anthropic/claude-opus-5',
			});
			assert.strictEqual(findBestMatchingModel(prev, [byokNamesake]), undefined);
			assert.strictEqual(findBestMatchingModel(byokNamesake, [prev]), undefined);
		});

		test('still carries a BYOK selection onto the agent host copy of the same key', () => {
			const original = { ...createModel('claude-opus-5', 'Claude Opus 5', { vendor: 'anthropic', family: 'claude-opus-5', isBYOK: true }), identifier: 'anthropic/Anthropic/claude-opus-5' };
			const bridged = createSessionModel('anthropic/Anthropic/claude-opus-5', 'Claude Opus 5', 'agent-host-copilotcli', {
				family: 'claude-opus-5',
				byokModelIdentifier: 'anthropic/Anthropic/claude-opus-5',
			});
			assert.deepStrictEqual({
				forward: findBestMatchingModel(original, [bridged])?.identifier,
				back: findBestMatchingModel(bridged, [original])?.identifier,
			}, {
				forward: bridged.identifier,
				back: original.identifier,
			});
		});
	});

	suite('shouldResetModelToDefault', () => {


		test('does not reset when nothing is selected yet', () => {
			const model = createModel('gpt', 'GPT');
			assert.deepStrictEqual({
				emptyCatalog: shouldResetModelToDefault(undefined, [], anywhere, [], undefined),
				partlyPublished: shouldResetModelToDefault(undefined, [model], anywhere, [model], undefined),
			}, {
				emptyCatalog: false,
				partlyPublished: false,
			});
		});

		test('should reset when model is no longer available', () => {
			const model = createModel('gpt', 'GPT');
			assert.strictEqual(shouldResetModelToDefault(model, [], anywhere, [model], undefined), true);
		});

		test('should NOT reset when model is available and compatible', () => {
			const model = createModel('gpt', 'GPT');
			assert.strictEqual(shouldResetModelToDefault(model, [model], anywhere, [model], undefined), false);
		});

		test('should reset when model is not supported for current mode', () => {
			const model = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			assert.strictEqual(shouldResetModelToDefault(model, [model], supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), [model], undefined), true);
		});

		test('should reset when model is not supported for inline chat', () => {
			const model = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false },
			});
			assert.strictEqual(shouldResetModelToDefault(model, [model], supportedHere(ChatAgentLocation.EditorInline), [model], undefined), true);
		});

		test('should reset when model is not valid for session', () => {
			const generalModel = createModel('gpt', 'GPT');
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const allModels = [generalModel, sessionModel];
			assert.strictEqual(shouldResetModelToDefault(generalModel, [generalModel], anywhere, allModels, 'cloud'), true);
		});

		test('should NOT reset session model in matching session', () => {
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			assert.strictEqual(shouldResetModelToDefault(sessionModel, [sessionModel], anywhere, [sessionModel], 'cloud'), false);
		});
	});

	suite('resolveModelFromSyncState', () => {

		test('keeps current model when same as state model', () => {
			const model = createModel('gpt', 'GPT');
			const result = resolveModelFromSyncState(model, model, [model], undefined);
			assert.strictEqual(result.action, 'keep');
		});

		test('applies state model when different and valid', () => {
			const current = createModel('gpt', 'GPT');
			const stateModel = createModel('claude', 'Claude');
			const result = resolveModelFromSyncState(stateModel, current, [current, stateModel], undefined);
			assert.strictEqual(result.action, 'apply');
		});

		test('uses default when state model not valid for session', () => {
			const current = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const stateModel = createModel('gpt', 'GPT');
			const allModels = [current, stateModel];
			const result = resolveModelFromSyncState(stateModel, current, allModels, 'cloud');
			assert.strictEqual(result.action, 'default');
		});

		test('applies when current model is undefined', () => {
			const stateModel = createModel('gpt', 'GPT');
			const result = resolveModelFromSyncState(stateModel, undefined, [stateModel], undefined);
			assert.strictEqual(result.action, 'apply');
		});

		test('applies session model when valid for matching session', () => {
			const sessionModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, sessionModel];
			const result = resolveModelFromSyncState(sessionModel, generalModel, allModels, 'cloud');
			assert.strictEqual(result.action, 'apply');
		});

		test('returns default when state model does not support current mode', () => {
			const current = createModel('gpt', 'GPT');
			const stateModel = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const result = resolveModelFromSyncState(stateModel, current, [current, stateModel], undefined, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent));
			assert.strictEqual(result.action, 'default');
		});

		test('returns default when state model does not support inline chat', () => {
			const current = createModel('gpt', 'GPT');
			const stateModel = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false },
			});
			const result = resolveModelFromSyncState(stateModel, current, [current, stateModel], undefined, supportedHere(ChatAgentLocation.EditorInline, ChatModeKind.Ask));
			assert.strictEqual(result.action, 'default');
		});

		test('applies when state model supports current mode with context', () => {
			const current = createModel('gpt', 'GPT');
			const stateModel = createModel('agent-model', 'Agent Model', {
				capabilities: { toolCalling: true, agentMode: true },
			});
			const result = resolveModelFromSyncState(stateModel, current, [current, stateModel], undefined, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent));
			assert.strictEqual(result.action, 'apply');
		});

		test('returns default when current and state share an identifier but neither belongs to the new session pool', () => {
			const generalModel = createModel('claude', 'Claude');
			const sessionModel = createSessionModel('claude', 'Claude', 'agent-host-copilotcli');
			const allModels = [generalModel, sessionModel];
			const result = resolveModelFromSyncState(generalModel, generalModel, allModels, 'agent-host-copilotcli');
			assert.strictEqual(result.action, 'default');
		});
	});

	suite('mergeModelsWithCache', () => {

		test('uses live models when available', () => {
			const liveModel = createModel('gpt', 'GPT');
			const cachedModel = createModel('cached-gpt', 'Cached GPT');
			const result = mergeModelsWithCache([liveModel], [cachedModel], new Set(['copilot']));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.id, 'gpt');
		});

		test('falls back to cached models when no live models', () => {
			const cachedModel = createModel('cached-gpt', 'Cached GPT');
			const result = mergeModelsWithCache([], [cachedModel], new Set(['copilot']));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.id, 'cached-gpt');
		});

		test('merges cached models from vendors not yet resolved', () => {
			const liveModel = createModel('gpt', 'GPT');
			const cachedOtherVendor = createModel('other-model', 'Other Model', { vendor: 'other-vendor' });
			const result = mergeModelsWithCache(
				[liveModel],
				[cachedOtherVendor],
				new Set(['copilot', 'other-vendor']),
			);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result.map(m => m.metadata.id).sort(), ['gpt', 'other-model']);
		});

		test('a vendor publishing only bridged BYOK copies keeps its cached own models', () => {
			const host = 'agent-host-copilotcli';
			const bridged = createSessionModel('anthropic/Anthropic/claude-opus-5', 'Claude Opus 5', host, {
				vendor: host,
				byokModelIdentifier: 'anthropic/Anthropic/claude-opus-5',
			});
			const cachedOwn = createSessionModel('gpt-5.6-terra', 'GPT-5.6 Terra', host, { vendor: host });
			const result = mergeModelsWithCache([bridged], [cachedOwn], new Set([host]), new Set([host]));

			assert.deepStrictEqual(result.map(m => m.metadata.id).sort(), ['anthropic/Anthropic/claude-opus-5', 'gpt-5.6-terra']);
		});

		test('a vendor that has published its own models drops its cache as before', () => {
			const host = 'agent-host-copilotcli';
			const liveOwn = createSessionModel('gpt-5.6-terra', 'GPT-5.6 Terra', host, { vendor: host });
			const staleCached = createSessionModel('gpt-5.5-retired', 'GPT-5.5 Retired', host, { vendor: host });
			const result = mergeModelsWithCache([liveOwn], [staleCached], new Set([host]), new Set([host]));

			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-5.6-terra']);
		});

		test('evicts cached models from vendors no longer contributed', () => {
			const liveModel = createModel('gpt', 'GPT');
			const cachedRemovedVendor = createModel('removed-model', 'Removed Model', { vendor: 'removed-vendor' });
			const result = mergeModelsWithCache(
				[liveModel],
				[cachedRemovedVendor],
				new Set(['copilot']),
			);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.id, 'gpt');
		});

		test('does not duplicate models from same vendor', () => {
			const liveModel = createModel('gpt', 'GPT');
			const cachedSameVendor = createModel('cached-gpt', 'Cached GPT');
			const result = mergeModelsWithCache(
				[liveModel],
				[cachedSameVendor],
				new Set(['copilot']),
			);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.id, 'gpt');
		});

		test('handles empty cache and empty live models', () => {
			const result = mergeModelsWithCache([], [], new Set());
			assert.deepStrictEqual(result, []);
		});

		test('handles multiple vendors with partial resolution', () => {
			const liveA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const cachedB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const cachedC = createModel('c-model', 'C Model', { vendor: 'vendor-c' });
			const result = mergeModelsWithCache(
				[liveA],
				[cachedB, cachedC],
				new Set(['vendor-a', 'vendor-b']),
			);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result.map(m => m.metadata.vendor).sort(), ['vendor-a', 'vendor-b']);
		});

		test('evicts cached entries for a resolved vendor that returned zero models (BYOK delete)', () => {
			const liveA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const staleB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = mergeModelsWithCache(
				[liveA],
				[staleB],
				new Set(['vendor-a', 'vendor-b']),
				new Set(['vendor-a', 'vendor-b']),
			);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.vendor, 'vendor-a');
		});

		test('keeps cached entries for an unresolved vendor (extension reload race)', () => {
			const liveA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const cachedB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = mergeModelsWithCache(
				[liveA],
				[cachedB],
				new Set(['vendor-a', 'vendor-b']),
				new Set(['vendor-a']),
			);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result.map(m => m.metadata.vendor).sort(), ['vendor-a', 'vendor-b']);
		});

		test('evicts cache for a resolved vendor even when all live models are zero', () => {
			const stale = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = mergeModelsWithCache(
				[],
				[stale],
				new Set(['vendor-b']),
				new Set(['vendor-b']),
			);
			assert.strictEqual(result.length, 0);
		});

		test('preserves full cache when no vendors are contributed yet (startup race)', () => {
			const cachedA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const cachedB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = mergeModelsWithCache(
				[],
				[cachedA, cachedB],
				new Set(),
				new Set(),
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id).sort(), ['a-model', 'b-model']);
		});

		test('evicts cached agent-host entries when the vendor is resolved with zero live models', () => {
			const liveCopilot = createModel('gpt', 'GPT');
			const staleAgentHost = createVendorModel('agent-host-copilotcli', 'gpt-5.6-sol', 'GPT 5.6 Sol');
			const result = mergeModelsWithCache(
				[liveCopilot],
				[staleAgentHost],
				new Set(['copilot', 'agent-host-copilotcli']),
				new Set(['copilot', 'agent-host-copilotcli']),
			);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].metadata.vendor, 'copilot');
		});
	});

	suite('model switching scenarios', () => {

		test('switching from Ask to Agent mode should reset model without tool support', () => {
			const noToolsModel = createModel('no-tools', 'No-Tools', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const toolModel = createModel('tool-model', 'Tool Model');
			const allModels = [noToolsModel, toolModel];

			assert.strictEqual(
				shouldResetModelToDefault(noToolsModel, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, undefined),
				false,
			);

			assert.strictEqual(
				shouldResetModelToDefault(noToolsModel, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allModels, undefined),
				true,
			);
		});

		test('switching sessions should reject model from wrong session pool', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			assert.strictEqual(
				isModelValidForSession(cloudModel, allModels, 'cloud'),
				true,
			);

			assert.strictEqual(
				isModelValidForSession(cloudModel, allModels, undefined),
				false,
			);

			assert.strictEqual(
				isModelValidForSession(generalModel, allModels, 'cloud'),
				false,
			);

			assert.strictEqual(
				isModelValidForSession(generalModel, allModels, undefined),
				true,
			);
		});

		test('model removal should trigger reset', () => {
			const gpt = createModel('gpt', 'GPT');
			const claude = createModel('claude', 'Claude');

			assert.strictEqual(
				shouldResetModelToDefault(gpt, [gpt, claude], anywhere, [gpt, claude], undefined),
				false,
			);

			assert.strictEqual(
				shouldResetModelToDefault(gpt, [claude], anywhere, [claude], undefined),
				true,
			);
		});

		test('syncing model from state respects session boundaries', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			const result = resolveModelFromSyncState(cloudModel, generalModel, allModels, undefined);
			assert.strictEqual(result.action, 'default');
		});

		test('syncing model from state applies model when switching to matching session', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			const result = resolveModelFromSyncState(cloudModel, generalModel, allModels, 'cloud');
			assert.strictEqual(result.action, 'apply');
		});

		test('combining mode switch + session switch validates correctly', () => {
			const cloudToolModel = createSessionModel('cloud-tool', 'Cloud Tool', 'cloud', {
				capabilities: { toolCalling: true, agentMode: true },
			});
			const cloudNoToolModel = createSessionModel('cloud-basic', 'Cloud Basic', 'cloud', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const allCloudModels = [cloudToolModel, cloudNoToolModel];

			assert.strictEqual(
				shouldResetModelToDefault(cloudToolModel, allCloudModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allCloudModels, 'cloud'),
				false,
			);

			assert.strictEqual(
				shouldResetModelToDefault(cloudNoToolModel, allCloudModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allCloudModels, 'cloud'),
				true,
			);
		});
	});

	suite('onDidChangeLanguageModels race conditions', () => {

		test('model temporarily removed then re-added loses user choice', () => {
			const gpt = createModel('gpt', 'GPT');
			const claude = createModel('claude', 'Claude');

			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', [gpt, claude]), false);

			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', [claude]), true);

			assert.strictEqual(shouldResetOnModelListChange('copilot/claude', [gpt, claude]), false);
		});

		test('model stays when model list refreshes with it still present', () => {
			const gpt = createModel('gpt', 'GPT');
			const claude = createModel('claude', 'Claude');

			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', [gpt, claude]), false);
		});

		test('reset when the selected model is hidden from the available models', () => {
			const gpt = createModel('gpt', 'GPT');
			const claude = createModel('claude', 'Claude');
			const visibleModels = [gpt, claude].filter(model => model.identifier !== gpt.identifier);

			assert.strictEqual(shouldResetOnModelListChange(gpt.identifier, visibleModels), true);
		});

		test('reset when current model identifier is undefined', () => {
			const gpt = createModel('gpt', 'GPT');
			assert.strictEqual(shouldResetOnModelListChange(undefined, [gpt]), true);
		});

		test('reset when models list is empty', () => {
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', []), true);
		});

		test('cache bridges the gap when live models temporarily unavailable', () => {
			const cachedGpt = createModel('gpt', 'GPT');
			const cachedClaude = createModel('claude', 'Claude');

			const merged = mergeModelsWithCache([], [cachedGpt, cachedClaude], new Set(['copilot']));
			assert.strictEqual(merged.length, 2);

			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', merged), false);
		});

		test('cache kept even for uncontributed vendors when no live models exist', () => {
			const cachedGpt = createModel('gpt', 'GPT');

			const merged = mergeModelsWithCache([], [cachedGpt], new Set());
			assert.strictEqual(merged.length, 1);
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', merged), false);
		});

		test('cache evicted for uncontributed vendor once live models arrive', () => {
			const cachedGpt = createModel('gpt', 'GPT');
			const liveOther = createModel('other', 'Other', { vendor: 'other-vendor' });

			const merged = mergeModelsWithCache([liveOther], [cachedGpt], new Set(['other-vendor']));
			assert.strictEqual(merged.length, 1);
			assert.strictEqual(merged[0].metadata.id, 'other');
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', merged), true);
		});
	});

	suite('full startup pipeline (computeAvailableModels)', () => {

		test('startup with only cached models returns filtered cache', () => {
			const cached = createModel('gpt', 'GPT');
			const result = computeAvailableModels(
				[],
				[cached],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt']);
		});

		test('startup with cached models from removed vendor still returns them (no live to compare)', () => {
			const cached = createModel('gpt', 'GPT');
			const result = computeAvailableModels(
				[],
				[cached],
				new Set(),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt']);
		});

		test('live models supersede cached models from same vendor', () => {
			const live = createModel('gpt-new', 'GPT New');
			const cached = createModel('gpt-old', 'GPT Old');
			const result = computeAvailableModels(
				[live],
				[cached],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt-new']);
		});

		test('partial vendor resolution keeps unresolved vendors from cache', () => {
			const liveA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const cachedB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = computeAvailableModels(
				[liveA],
				[cachedB],
				new Set(['vendor-a', 'vendor-b']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id).sort(), ['a-model', 'b-model']);
		});

		test('results are sorted alphabetically by name', () => {
			const modelC = createModel('c', 'Charlie');
			const modelA = createModel('a', 'Alpha');
			const modelB = createModel('b', 'Bravo');
			const result = computeAvailableModels(
				[modelC, modelA, modelB],
				[],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.name), ['Alpha', 'Bravo', 'Charlie']);
		});

		test('session-targeted models excluded from general session startup', () => {
			const general = createModel('gpt', 'GPT');
			const cloudOnly = createSessionModel('cloud', 'Cloud', 'cloud');
			const result = computeAvailableModels(
				[general, cloudOnly],
				[],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['gpt']);
		});

		test('only session-targeted models returned for cloud session startup', () => {
			const general = createModel('gpt', 'GPT');
			const cloudOnly = createSessionModel('cloud', 'Cloud', 'cloud');
			const result = computeAvailableModels(
				[general, cloudOnly],
				[],
				new Set(['copilot']),
				'cloud',
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['cloud']);
		});

		test('agent mode filters non-tool models during startup', () => {
			const toolModel = createModel('tool', 'Tool Model');
			const noToolModel = createModel('no-tool', 'No Tool', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const result = computeAvailableModels(
				[toolModel, noToolModel],
				[],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Agent,
				ChatAgentLocation.Chat,
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id), ['tool']);
		});

		test('startup/extension reload with no contributors yet preserves cache (production path)', () => {
			const cachedA = createModel('a-model', 'A Model', { vendor: 'vendor-a' });
			const cachedB = createModel('b-model', 'B Model', { vendor: 'vendor-b' });
			const result = computeAvailableModels(
				[],
				[cachedA, cachedB],
				new Set(),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
				new Set(),
			);
			assert.deepStrictEqual(result.map(m => m.metadata.id).sort(), ['a-model', 'b-model']);
		});
	});

	suite('_syncFromModel edge cases', () => {

		test('sync state with undefined selectedModel keeps current', () => {
			const current = createModel('gpt', 'GPT');
			const result = resolveModelFromSyncState(current, current, [current], undefined);
			assert.strictEqual(result.action, 'keep');
		});

		test('sync state model from different session does not apply', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			const result = resolveModelFromSyncState(cloudModel, generalModel, allModels, undefined);
			assert.strictEqual(result.action, 'default');
		});

		test('sync state with model matching different session type falls back to default', () => {
			const enterpriseModel = createSessionModel('ent-gpt', 'Enterprise GPT', 'enterprise');
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const allModels = [cloudModel, enterpriseModel];

			const result = resolveModelFromSyncState(enterpriseModel, cloudModel, allModels, 'cloud');
			assert.strictEqual(result.action, 'default');
		});

		test('sync identical model reference returns keep', () => {
			const model = createModel('gpt', 'GPT');
			const result = resolveModelFromSyncState(model, model, [model], undefined);
			assert.strictEqual(result.action, 'keep');
		});

		test('sync same identifier but different object returns keep', () => {
			const model1 = createModel('gpt', 'GPT');
			const model2 = createModel('gpt', 'GPT');
			const result = resolveModelFromSyncState(model1, model2, [model1, model2], undefined);
			assert.strictEqual(result.action, 'keep');
		});
	});

	suite('checkModelSupported interaction patterns', () => {

		const askContext = anywhere;
		const agentContext = supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent);

		test('restored model passes Agent compatibility check', () => {
			const agentModel = createModel('agent-model', 'Agent Model', {
				capabilities: { toolCalling: true, agentMode: true },
			});
			assert.strictEqual(shouldResetModelToDefault(agentModel, [agentModel], agentContext, [agentModel], undefined), false);
		});

		test('restored model that fails Agent compatibility resets to an Agent model', () => {
			const askOnlyModel = createModel('ask-only', 'Ask Only', {
				capabilities: { toolCalling: false, agentMode: false },
			});
			const agentModel = createModel('agent-model', 'Agent Model');

			assert.strictEqual(shouldResetModelToDefault(askOnlyModel, [askOnlyModel, agentModel], agentContext, [askOnlyModel, agentModel], undefined), true);

			const agentCompatibleModels = filterModelsForSession(
				[askOnlyModel, agentModel], undefined, ChatModeKind.Agent, ChatAgentLocation.Chat,
			);
			const defaultModel = findDefaultModel(agentCompatibleModels, ChatAgentLocation.Chat);
			assert.strictEqual(defaultModel?.metadata.id, 'agent-model');
		});

		test('mode switch triggers checkModelSupported which resets incompatible model', () => {
			const noToolModel = createModel('no-tool', 'No Tool', {
				capabilities: { toolCalling: false },
			});
			const toolModel = createModel('tool', 'Tool');

			assert.strictEqual(shouldResetModelToDefault(noToolModel, [noToolModel, toolModel], askContext, [noToolModel, toolModel], undefined), false);

			assert.strictEqual(shouldResetModelToDefault(noToolModel, [noToolModel, toolModel], agentContext, [noToolModel, toolModel], undefined), true);
		});

		test('double reset is idempotent', () => {
			const defaultModel = createDefaultModelForLocation('default', 'Default', ChatAgentLocation.Chat);
			const otherModel = createModel('other', 'Other');
			const allModels = [defaultModel, otherModel];

			const result1 = findDefaultModel(allModels, ChatAgentLocation.Chat);
			assert.strictEqual(result1?.metadata.id, 'default');

			const result2 = findDefaultModel(allModels, ChatAgentLocation.Chat);
			assert.strictEqual(result2?.metadata.id, 'default');

			assert.strictEqual(shouldResetModelToDefault(result1!, allModels, askContext, allModels, undefined), false);
		});
	});

	suite('multiple session types and cross-contamination', () => {

		test('model from session A rejected in session B', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const enterpriseModel = createSessionModel('ent-gpt', 'Enterprise GPT', 'enterprise');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel, enterpriseModel];

			assert.strictEqual(isModelValidForSession(cloudModel, allModels, 'enterprise'), false);
			assert.strictEqual(isModelValidForSession(enterpriseModel, allModels, 'cloud'), false);
			assert.strictEqual(isModelValidForSession(generalModel, allModels, 'cloud'), false);
		});

		test('general model is valid when session type has no targeted models', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			assert.strictEqual(isModelValidForSession(generalModel, allModels, 'enterprise'), true);
		});

		test('filterModelsForSession isolates session types correctly', () => {
			const general = createModel('gpt', 'GPT');
			const cloud = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const enterprise = createSessionModel('ent-gpt', 'Enterprise GPT', 'enterprise');
			const allModels = [general, cloud, enterprise];

			const cloudFiltered = filterModelsForSession(allModels, 'cloud', ChatModeKind.Ask, ChatAgentLocation.Chat);
			assert.deepStrictEqual(cloudFiltered.map(m => m.metadata.id), ['cloud-gpt']);

			const entFiltered = filterModelsForSession(allModels, 'enterprise', ChatModeKind.Ask, ChatAgentLocation.Chat);
			assert.deepStrictEqual(entFiltered.map(m => m.metadata.id), ['ent-gpt']);

			const generalFiltered = filterModelsForSession(allModels, undefined, ChatModeKind.Ask, ChatAgentLocation.Chat);
			assert.deepStrictEqual(generalFiltered.map(m => m.metadata.id), ['gpt']);
		});

		test('switching from cloud to general session resets cloud model', () => {
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud');
			const generalModel = createModel('gpt', 'GPT');
			const allModels = [generalModel, cloudModel];

			assert.strictEqual(shouldResetModelToDefault(cloudModel, [cloudModel], supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, 'cloud'), false);

			assert.strictEqual(shouldResetModelToDefault(cloudModel, [generalModel], anywhere, allModels, undefined), true);
		});
	});

	suite('mode with forced model (mode.model property)', () => {

		test('mode forces model — simulating switchModelByQualifiedName success', () => {
			const gpt = createModel('gpt-4o', 'GPT-4o');
			const claude = createModel('claude', 'Claude');
			const allModels = [gpt, claude];

			const qualifiedName = 'GPT-4o (copilot)';
			const match = allModels.find(m => ILanguageModelChatMetadata.matchesQualifiedName(qualifiedName, m.metadata));
			assert.strictEqual(match?.metadata.id, 'gpt-4o');
		});

		test('mode forces model — copilot vendor shorthand works', () => {
			const gpt = createModel('gpt-4o', 'GPT-4o');
			const match = [gpt].find(m => ILanguageModelChatMetadata.matchesQualifiedName('GPT-4o', m.metadata));
			assert.strictEqual(match?.metadata.id, 'gpt-4o');
		});

		test('mode forces model — nonexistent model gracefully misses', () => {
			const gpt = createModel('gpt-4o', 'GPT-4o');
			const match = [gpt].find(m => ILanguageModelChatMetadata.matchesQualifiedName('NonExistent (copilot)', m.metadata));
			assert.strictEqual(match, undefined);
		});

		test('mode forces model that is then checked for support', () => {
			const forcedModel = createModel('forced', 'Forced', {
				capabilities: { toolCalling: false, agentMode: false },
			});

			assert.strictEqual(shouldResetModelToDefault(forcedModel, [forcedModel], supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), [forcedModel], undefined), true);
		});
	});

	suite('EditorInline + mode combined scenarios', () => {

		test('EditorInline + Agent requires both agentMode and toolCalling', () => {
			const partialModel = createModel('partial', 'Partial', {
				capabilities: { toolCalling: true, agentMode: false },
			});
			assert.strictEqual(isModelSupportedForMode(partialModel, ChatModeKind.Agent), false);
			assert.strictEqual(isModelSupportedForInlineChat(partialModel, ChatAgentLocation.EditorInline), true);

			assert.strictEqual(shouldResetModelToDefault(partialModel, [partialModel], supportedHere(ChatAgentLocation.EditorInline, ChatModeKind.Agent), [partialModel], undefined), true);
		});

		test('EditorInline + Ask only requires toolCalling', () => {
			const toolModel = createModel('tool', 'Tool');
			assert.strictEqual(shouldResetModelToDefault(toolModel, [toolModel], supportedHere(ChatAgentLocation.EditorInline), [toolModel], undefined), false);
		});

		test('EditorInline + Ask rejects model without toolCalling', () => {
			const noToolModel = createModel('no-tool', 'No Tool', {
				capabilities: {},
			});
			assert.strictEqual(shouldResetModelToDefault(noToolModel, [noToolModel], supportedHere(ChatAgentLocation.EditorInline), [noToolModel], undefined), true);
		});
	});

	suite('realistic multi-step race simulations', () => {

		test('startup: cached model → live models arrive → user choice preserved', () => {
			const cachedGpt = createModel('gpt', 'GPT');
			const cachedClaude = createModel('claude', 'Claude');

			const cachedModels = computeAvailableModels(
				[],
				[cachedGpt, cachedClaude],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', cachedModels), false);

			const liveModels = computeAvailableModels(
				[cachedGpt, cachedClaude],
				[cachedGpt, cachedClaude],
				new Set(['copilot']),
				undefined,
				ChatModeKind.Ask,
				ChatAgentLocation.Chat,
			);
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', liveModels), false);
		});

		test('extension reload: selected model flickers out then back', () => {
			const gpt = createModel('gpt', 'GPT');
			const claude = createModel('claude', 'Claude');

			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', [gpt, claude]), false);

			const duringReload = mergeModelsWithCache([], [gpt, claude], new Set(['copilot']));
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', duringReload), false);

			const afterReload = mergeModelsWithCache([gpt, claude], [gpt, claude], new Set(['copilot']));
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', afterReload), false);
		});

		test('extension reload without cache: model lost', () => {
			const gpt = createModel('gpt', 'GPT');

			const duringReload = mergeModelsWithCache([], [], new Set(['copilot']));
			assert.strictEqual(duringReload.length, 0);
			assert.strictEqual(shouldResetOnModelListChange('copilot/gpt', duringReload), true);

			const afterReload = mergeModelsWithCache([gpt], [], new Set(['copilot']));
			assert.strictEqual(afterReload.length, 1);
		});

		test('session switch race: mode + session change together', () => {
			const generalDefault = createDefaultModelForLocation('gpt', 'GPT', ChatAgentLocation.Chat);
			const cloudModel = createSessionModel('cloud-gpt', 'Cloud GPT', 'cloud', {
				capabilities: { toolCalling: true, agentMode: true },
			});
			const allModels = [generalDefault, cloudModel];

			assert.strictEqual(shouldResetModelToDefault(generalDefault, [generalDefault], anywhere, allModels, undefined), false);

			assert.strictEqual(shouldResetModelToDefault(generalDefault, [cloudModel], supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allModels, 'cloud'), true);

			const cloudDefault = findDefaultModel([cloudModel], ChatAgentLocation.Chat);
			assert.strictEqual(cloudDefault?.metadata.id, 'cloud-gpt');
		});

		test('rapid mode changes: ask → agent → ask preserves compatible model', () => {
			const model = createModel('gpt', 'GPT');
			const allModels = [model];

			assert.strictEqual(shouldResetModelToDefault(model, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, undefined), false);

			assert.strictEqual(shouldResetModelToDefault(model, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allModels, undefined), false);

			assert.strictEqual(shouldResetModelToDefault(model, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, undefined), false);
		});

		test('rapid mode changes: ask → agent resets incompatible, then agent → ask does not restore', () => {
			const noToolModel = createModel('no-tool', 'No Tool', {
				capabilities: { toolCalling: false },
			});
			const toolModel = createDefaultModelForLocation('tool', 'Tool', ChatAgentLocation.Chat);
			const allModels = [noToolModel, toolModel];

			assert.strictEqual(shouldResetModelToDefault(noToolModel, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, undefined), false);

			assert.strictEqual(shouldResetModelToDefault(noToolModel, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Agent), allModels, undefined), true);
			const defaultAfterReset = findDefaultModel(allModels, ChatAgentLocation.Chat);
			assert.strictEqual(defaultAfterReset?.metadata.id, 'tool');

			assert.strictEqual(shouldResetModelToDefault(toolModel, allModels, supportedHere(ChatAgentLocation.Chat, ChatModeKind.Ask), allModels, undefined), false);
		});

		test('startup race #321037: Copilot vendor resolves empty before BYOK, restored selection must survive', () => {
			const persistedId = 'copilot/claude-opus-4.6-1m';
			const cachedCopilot = [
				createModel('claude-opus-4.6-1m', 'Claude Opus 4.6 (1M)'),
				createModel('gpt-5.5', 'GPT-5.5'),
			];

			const liveByok = [
				createVendorModel('ollama', 'deepseek-v3.1', 'DeepSeek V3.1'),
				createVendorModel('cerebras', 'zai-glm-4.7', 'GLM 4.7'),
			];

			const contributedVendors = new Set(['copilot', 'ollama', 'cerebras']);
			const resolvedVendors = new Set(['copilot', 'ollama', 'cerebras']);

			const available = computeAvailableModels(
				liveByok,
				[...cachedCopilot, ...liveByok],
				contributedVendors,
				undefined,
				ChatModeKind.Agent,
				ChatAgentLocation.Chat,
				resolvedVendors,
			);

			assert.ok(
				available.some(m => m.identifier === persistedId),
				'restored Copilot model should remain available while its vendor is still activating',
			);
			assert.strictEqual(
				shouldResetOnModelListChange(persistedId, available),
				false,
				'must not reset the restored Copilot selection during the startup race',
			);

			const fallback = findDefaultModel(available, ChatAgentLocation.Chat);
			assert.notStrictEqual(
				fallback?.metadata.isBYOK,
				true,
				'reset fallback should not be a BYOK model',
			);
		});
	});

	suite('agent-host model restore', () => {
		const sessionType = 'agent-host-claude';
		const agnosticAuto = createModel('auto', 'Auto');
		const agentHostHaiku: ILanguageModelChatMetadataAndIdentifier = {
			...createSessionModel('claude-haiku-4.5', 'Claude Haiku 4.5', sessionType, { isDefaultForLocation: { [ChatAgentLocation.Chat]: true } }),
			identifier: 'agent-host-claude:claude-haiku-4.5',
		};
		const agentHostOpus: ILanguageModelChatMetadataAndIdentifier = {
			...createSessionModel('claude-opus-4.8', 'Claude Opus 4.8', sessionType),
			identifier: 'agent-host-claude:claude-opus-4.8',
		};
		const allMerged = [agnosticAuto, agentHostHaiku, agentHostOpus];

		test('restores a remembered per-type model only for a fresh own-pool draft', () => {
			assert.deepStrictEqual([
				shouldRestorePerTypeModelOnSessionSwitch(true, true, false),
				shouldRestorePerTypeModelOnSessionSwitch(true, true, true),
				shouldRestorePerTypeModelOnSessionSwitch(false, true, false),
				shouldRestorePerTypeModelOnSessionSwitch(true, false, false),
			], [true, false, false, false]);
		});

		test('a started contributed session is never a new conversation, even before its requests load', () => {
			const startedAgentHost = URI.parse('agent-host-copilotcli:/933e7602-f84e-431e-8756-c5e85c8f33d0');
			const untitledAgentHost = URI.parse('agent-host-copilotcli:/untitled-933e7602');
			const localSession = LocalChatSessionUri.getNewSessionUri();

			assert.deepStrictEqual([
				isNewConversation(startedAgentHost, true),
				isNewConversation(startedAgentHost, false),
				isNewConversation(untitledAgentHost, true),
				isNewConversation(untitledAgentHost, false),
				isNewConversation(localSession, true),
				isNewConversation(localSession, false),
			], [false, false, true, false, true, false]);
		});

		test('drops cross-pool draft models in both directions', () => {
			assert.deepStrictEqual([
				shouldDropAgnosticDraftModel(agnosticAuto, allMerged, sessionType),
				shouldDropAgnosticDraftModel(agentHostOpus, allMerged, undefined),
				shouldDropAgnosticDraftModel(agentHostOpus, allMerged, sessionType),
			], [true, true, false]);
		});
	});

	suite('BYOK agent-host visibility (isModelHiddenInPicker / getAgentHostByokManageModelsIdentifier)', () => {

		function createAgentHostByokModel(vendor: string, modelId: string, manageModelsIdentifier: string): ILanguageModelChatMetadataAndIdentifier {
			const sessionType = 'agent-host-copilotcli';
			const appendedId = `${vendor}/${modelId}`;
			return {
				identifier: `${sessionType}:${appendedId}`,
				metadata: {
					extension: new ExtensionIdentifier('vscode.chat'),
					id: appendedId,
					name: modelId,
					vendor: sessionType,
					version: '1.0',
					family: appendedId,
					maxInputTokens: 128000,
					maxOutputTokens: 4096,
					isDefaultForLocation: {},
					isUserSelectable: true,
					targetChatSessionType: sessionType,
					modelGroup: { id: vendor },
					byokModelIdentifier: manageModelsIdentifier,
					capabilities: { toolCalling: true, agentMode: true },
				} as ILanguageModelChatMetadata,
			};
		}

		function createNativeAgentHostModel(modelId: string): ILanguageModelChatMetadataAndIdentifier {
			const sessionType = 'agent-host-copilotcli';
			return {
				identifier: `${sessionType}:${modelId}`,
				metadata: {
					extension: new ExtensionIdentifier('vscode.chat'),
					id: modelId,
					name: modelId,
					vendor: sessionType,
					version: '1.0',
					family: modelId,
					maxInputTokens: 128000,
					maxOutputTokens: 4096,
					isDefaultForLocation: {},
					isUserSelectable: true,
					targetChatSessionType: sessionType,
					modelGroup: { id: 'copilotcli' },
					capabilities: { toolCalling: true, agentMode: true },
				} as ILanguageModelChatMetadata,
			};
		}

		test('returns the carried Manage Models identifier for a groupless BYOK copy', () => {
			const model = createAgentHostByokModel('anthropic', 'claude-sonnet-4', 'anthropic/claude-sonnet-4');
			assert.strictEqual(getAgentHostByokManageModelsIdentifier(model.metadata), 'anthropic/claude-sonnet-4');
		});

		test('returns the carried grouped identifier verbatim (group name + slashes preserved)', () => {
			const model = createAgentHostByokModel('openrouter', 'ai21/jamba-large-1.7', 'openrouter/OpenRouter 2/ai21/jamba-large-1.7');
			assert.strictEqual(getAgentHostByokManageModelsIdentifier(model.metadata), 'openrouter/OpenRouter 2/ai21/jamba-large-1.7');
		});

		test('returns undefined for native harness models (no carried identifier)', () => {
			const model = createNativeAgentHostModel('claude-haiku-4.5');
			assert.strictEqual(getAgentHostByokManageModelsIdentifier(model.metadata), undefined);
		});

		test('returns undefined for non-agent-host models', () => {
			const model = createModel('gpt-5', 'GPT-5');
			assert.strictEqual(getAgentHostByokManageModelsIdentifier(model.metadata), undefined);
		});

		test('hides a grouped BYOK copy via its carried registered identifier', () => {
			const model = createAgentHostByokModel('openrouter', 'ai21/jamba-large-1.7', 'openrouter/OpenRouter 2/ai21/jamba-large-1.7');
			const hidden = new Set(['openrouter/OpenRouter 2/ai21/jamba-large-1.7']);
			assert.strictEqual(isModelHiddenInPicker(model, id => hidden.has(id)), true);
		});

		test('hides a groupless BYOK copy via its carried identifier', () => {
			const model = createAgentHostByokModel('anthropic', 'claude-sonnet-4', 'anthropic/claude-sonnet-4');
			const hidden = new Set(['anthropic/claude-sonnet-4']);
			assert.strictEqual(isModelHiddenInPicker(model, id => hidden.has(id)), true);
		});

		test('shows an agent-host BYOK copy when nothing is hidden', () => {
			const model = createAgentHostByokModel('openrouter', 'ai21/jamba-large-1.7', 'openrouter/OpenRouter 2/ai21/jamba-large-1.7');
			assert.strictEqual(isModelHiddenInPicker(model, () => false), false);
		});

		test('also hides when the agent-host copy identifier itself is hidden', () => {
			const model = createAgentHostByokModel('anthropic', 'claude-sonnet-4', 'anthropic/claude-sonnet-4');
			const hidden = new Set([model.identifier]);
			assert.strictEqual(isModelHiddenInPicker(model, id => hidden.has(id)), true);
		});

		test('filters out a hidden grouped BYOK model but keeps visible peers', () => {
			const visible = createAgentHostByokModel('anthropic', 'claude-sonnet-4', 'anthropic/claude-sonnet-4');
			const hiddenModel = createAgentHostByokModel('openrouter', 'ai21/jamba-large-1.7', 'openrouter/OpenRouter 2/ai21/jamba-large-1.7');
			const hidden = new Set(['openrouter/OpenRouter 2/ai21/jamba-large-1.7']);
			const result = [visible, hiddenModel].filter(m => !isModelHiddenInPicker(m, id => hidden.has(id)));
			assert.deepStrictEqual(result.map(m => m.identifier), ['agent-host-copilotcli:anthropic/claude-sonnet-4']);
		});
	});

	suite('resolveEditedRequestSelection', () => {

		test('a resubmit uses the inline editor\'s selection, not the composer\'s', () => {
			assert.deepStrictEqual({
				edited: resolveEditedRequestSelection('gpt-5.5', 'claude-opus-4.8'),
				noEditInFlight: resolveEditedRequestSelection(undefined, 'claude-opus-4.8'),
				editedMatchesComposer: resolveEditedRequestSelection('gpt-5.5', 'gpt-5.5'),
			}, {
				edited: 'gpt-5.5',
				noEditInFlight: 'claude-opus-4.8',
				editedMatchesComposer: 'gpt-5.5',
			});
		});
	});
});
