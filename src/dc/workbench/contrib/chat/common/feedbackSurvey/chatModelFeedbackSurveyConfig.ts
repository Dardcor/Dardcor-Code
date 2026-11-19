/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { expandModelMatchCandidates, ID_PATTERN, isObject, MAX_ID_LENGTH, normalizeSelector, parseExpPayloadEnvelope, readSelectorList, readText } from '../expPayload.js';

export const CHAT_MODEL_FEEDBACK_SURVEY_CONFIG_VERSION = 1;

export const CHAT_MODEL_FEEDBACK_SURVEY_NO_HARNESS = 'none';

const MAX_STEPS = 8;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_TITLE_LENGTH = 200;
const MAX_LABEL_LENGTH = 120;
const MAX_PLACEHOLDER_LENGTH = 100;
const MAX_COMMENT_LENGTH = 1000;

const MATCH_FIELDS = ['selectedModels', 'resolvedModels', 'modes', 'harnesses', 'sessionTypes'] as const;

export const enum ChatModelFeedbackSurveyStepKind {
	Choice = 'choice',
	Text = 'text',
}

export interface IChatModelFeedbackSurveyOption {
	readonly id: string;
	readonly label: string;
}

interface IChatModelFeedbackSurveyStepBase {
	readonly id: string;
	readonly title: string;
}

export interface IChatModelFeedbackSurveyChoiceStep extends IChatModelFeedbackSurveyStepBase {
	readonly kind: ChatModelFeedbackSurveyStepKind.Choice;
	readonly options: readonly IChatModelFeedbackSurveyOption[];
}

export interface IChatModelFeedbackSurveyTextStep extends IChatModelFeedbackSurveyStepBase {
	readonly kind: ChatModelFeedbackSurveyStepKind.Text;
	readonly placeholder?: string;
	readonly maxLength: number;
}

export type ChatModelFeedbackSurveyStep = IChatModelFeedbackSurveyChoiceStep | IChatModelFeedbackSurveyTextStep;

export interface IChatModelFeedbackSurveyMatch {
	readonly selectedModels: readonly string[];
	readonly resolvedModels: readonly string[];
	readonly modes: readonly string[];
	readonly harnesses: readonly string[];
	readonly sessionTypes: readonly string[];
}

export interface IChatModelFeedbackSurveyPrompt {
	readonly cooldownDays: number;
	readonly maxPerSession: number;
	readonly chance: IChatModelFeedbackSurveyChance;
	readonly triggers: IChatModelFeedbackSurveyTriggers;
}

export interface IChatModelFeedbackSurveyChance {
	readonly initial: number;
	readonly increment: number;
	readonly max: number;
}

export interface IChatModelFeedbackSurveyTriggers {
	readonly modelSwitchedAway: IChatModelFeedbackSurveyTrigger;
}

export interface IChatModelFeedbackSurveyTrigger {
	readonly enabled: boolean;
	readonly bypassCooldown: boolean;
}

export interface IChatModelFeedbackSurveyConfig {
	readonly version: number;
	readonly id: string;
	readonly match: IChatModelFeedbackSurveyMatch;
	readonly prompt: IChatModelFeedbackSurveyPrompt;
	readonly steps: readonly ChatModelFeedbackSurveyStep[];
}

export type ChatModelFeedbackSurveyParseResult =
	| { readonly config: IChatModelFeedbackSurveyConfig; readonly error?: undefined }
	| { readonly config?: undefined; readonly error: string };

export interface IChatModelFeedbackSurveyMatchContext {
	readonly selectedModelId?: string;
	readonly selectedModelAliases?: readonly string[];
	readonly resolvedModelId?: string;
	readonly modeId?: string;
	readonly harness?: string;
	readonly sessionType?: string;
}

export function parseChatModelFeedbackSurveyConfig(raw: string | undefined): ChatModelFeedbackSurveyParseResult {
	const parsed = parseExpPayloadEnvelope(raw, CHAT_MODEL_FEEDBACK_SURVEY_CONFIG_VERSION);
	if (typeof parsed === 'string') {
		return { error: parsed };
	}

	const id = readText(parsed.id, MAX_ID_LENGTH, ID_PATTERN);
	if (!id) {
		return { error: 'missing or malformed survey id' };
	}

	const match = readMatch(parsed.match);
	if (typeof match === 'string') {
		return { error: match };
	}

	const prompt = readPrompt(parsed.prompt);
	if (typeof prompt === 'string') {
		return { error: prompt };
	}

	const steps = readSteps(parsed.steps);
	if (typeof steps === 'string') {
		return { error: steps };
	}

	return { config: { version: CHAT_MODEL_FEEDBACK_SURVEY_CONFIG_VERSION, id, match, prompt, steps } };
}

function readMatch(raw: unknown): IChatModelFeedbackSurveyMatch | string {
	if (raw !== undefined && !isObject(raw)) {
		return 'match must be an object';
	}
	const source = isObject(raw) ? raw : {};

	const match: Record<string, string[]> = {};
	for (const field of MATCH_FIELDS) {
		const selectors = readSelectorList(source[field], `match.${field}`);
		if (typeof selectors === 'string') {
			return selectors;
		}
		match[field] = selectors;
	}

	if (MATCH_FIELDS.every(field => match[field].length === 0)) {
		return 'match must narrow at least one dimension';
	}

	return {
		selectedModels: match.selectedModels,
		resolvedModels: match.resolvedModels,
		modes: match.modes,
		harnesses: match.harnesses,
		sessionTypes: match.sessionTypes,
	};
}


function readPrompt(raw: unknown): IChatModelFeedbackSurveyPrompt | string {
	if (raw !== undefined && !isObject(raw)) {
		return 'prompt must be an object';
	}
	const source = isObject(raw) ? raw : {};

	const cooldownDays = readNonNegativeNumber(source.cooldownDays, 7);
	if (cooldownDays === undefined) {
		return 'prompt.cooldownDays must be a non-negative number';
	}

	const maxPerSession = readPositiveInteger(source.maxPerSession, 1);
	if (maxPerSession === undefined) {
		return 'prompt.maxPerSession must be a positive integer';
	}

	const chance = readChance(source.chance);
	if (typeof chance === 'string') {
		return chance;
	}

	const triggers = readTriggers(source.triggers);
	if (typeof triggers === 'string') {
		return triggers;
	}

	return { cooldownDays, maxPerSession, chance, triggers };
}

function readChance(raw: unknown): IChatModelFeedbackSurveyChance | string {
	if (raw !== undefined && !isObject(raw)) {
		return 'prompt.chance must be an object';
	}
	const source = isObject(raw) ? raw : {};

	const initial = readProbability(source.initial, 0);
	if (initial === undefined) {
		return 'prompt.chance.initial must be a probability between 0 and 1';
	}
	const increment = readProbability(source.increment, 0);
	if (increment === undefined) {
		return 'prompt.chance.increment must be a probability between 0 and 1';
	}
	const max = readProbability(source.max, 1);
	if (max === undefined) {
		return 'prompt.chance.max must be a probability between 0 and 1';
	}
	if (max < initial) {
		return 'prompt.chance.max must be greater than or equal to prompt.chance.initial';
	}

	return { initial, increment, max };
}

function readTriggers(raw: unknown): IChatModelFeedbackSurveyTriggers | string {
	if (raw !== undefined && !isObject(raw)) {
		return 'prompt.triggers must be an object';
	}
	const source = isObject(raw) ? raw : {};

	const modelSwitchedAway = readTrigger(source.modelSwitchedAway, 'prompt.triggers.modelSwitchedAway');
	if (typeof modelSwitchedAway === 'string') {
		return modelSwitchedAway;
	}

	return { modelSwitchedAway };
}

function readTrigger(raw: unknown, path: string): IChatModelFeedbackSurveyTrigger | string {
	if (raw === undefined) {
		return { enabled: false, bypassCooldown: false };
	}
	if (typeof raw === 'boolean') {
		return { enabled: raw, bypassCooldown: false };
	}
	if (!isObject(raw)) {
		return `${path} must be a boolean or an object`;
	}
	if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
		return `${path}.enabled must be a boolean`;
	}
	if (raw.bypassCooldown !== undefined && typeof raw.bypassCooldown !== 'boolean') {
		return `${path}.bypassCooldown must be a boolean`;
	}
	return { enabled: raw.enabled ?? true, bypassCooldown: raw.bypassCooldown ?? false };
}

function readSteps(raw: unknown): ChatModelFeedbackSurveyStep[] | string {
	if (!Array.isArray(raw) || raw.length === 0) {
		return 'steps must be a non-empty array';
	}
	if (raw.length > MAX_STEPS) {
		return `steps exceeds ${MAX_STEPS} entries`;
	}

	const steps: ChatModelFeedbackSurveyStep[] = [];
	const seenIds = new Set<string>();

	for (let i = 0; i < raw.length; i++) {
		const step = readStep(raw[i], i);
		if (typeof step === 'string') {
			return step;
		}
		if (seenIds.has(step.id)) {
			return `steps[${i}].id "${step.id}" is duplicated`;
		}
		seenIds.add(step.id);
		steps.push(step);
	}

	const textStepIndexes = steps.map((step, index) => step.kind === ChatModelFeedbackSurveyStepKind.Text ? index : -1).filter(index => index >= 0);
	if (textStepIndexes.length > 1) {
		return 'steps may contain at most one text step';
	}
	if (textStepIndexes.length === 1 && textStepIndexes[0] !== steps.length - 1) {
		return 'a text step must be the last step';
	}

	return steps;
}

function readStep(raw: unknown, index: number): ChatModelFeedbackSurveyStep | string {
	if (!isObject(raw)) {
		return `steps[${index}] must be an object`;
	}

	const id = readText(raw.id, MAX_ID_LENGTH, ID_PATTERN);
	if (!id) {
		return `steps[${index}].id is missing or malformed`;
	}

	const title = readText(raw.title, MAX_TITLE_LENGTH);
	if (!title) {
		return `steps[${index}].title is missing or too long`;
	}

	if (raw.kind === ChatModelFeedbackSurveyStepKind.Text) {
		const placeholder = raw.placeholder === undefined ? undefined : readText(raw.placeholder, MAX_PLACEHOLDER_LENGTH);
		if (raw.placeholder !== undefined && !placeholder) {
			return `steps[${index}].placeholder is empty or too long`;
		}
		const requestedMaxLength = readPositiveInteger(raw.maxLength, MAX_COMMENT_LENGTH);
		if (requestedMaxLength === undefined) {
			return `steps[${index}].maxLength must be a positive integer`;
		}
		return {
			kind: ChatModelFeedbackSurveyStepKind.Text,
			id,
			title,
			placeholder,
			maxLength: Math.min(requestedMaxLength, MAX_COMMENT_LENGTH),
		};
	}

	if (raw.kind !== ChatModelFeedbackSurveyStepKind.Choice) {
		return `steps[${index}].kind must be "${ChatModelFeedbackSurveyStepKind.Choice}" or "${ChatModelFeedbackSurveyStepKind.Text}"`;
	}

	if (!Array.isArray(raw.options) || raw.options.length < MIN_OPTIONS || raw.options.length > MAX_OPTIONS) {
		return `steps[${index}].options must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} entries`;
	}

	const options: IChatModelFeedbackSurveyOption[] = [];
	const seenOptionIds = new Set<string>();
	for (let i = 0; i < raw.options.length; i++) {
		const option = raw.options[i];
		if (!isObject(option)) {
			return `steps[${index}].options[${i}] must be an object`;
		}
		const optionId = readText(option.id, MAX_ID_LENGTH, ID_PATTERN);
		if (!optionId) {
			return `steps[${index}].options[${i}].id is missing or malformed`;
		}
		if (seenOptionIds.has(optionId)) {
			return `steps[${index}].options[${i}].id "${optionId}" is duplicated`;
		}
		const label = readText(option.label, MAX_LABEL_LENGTH);
		if (!label) {
			return `steps[${index}].options[${i}].label is missing or too long`;
		}
		seenOptionIds.add(optionId);
		options.push({ id: optionId, label });
	}

	return { kind: ChatModelFeedbackSurveyStepKind.Choice, id, title, options };
}



function readPositiveInteger(raw: unknown, fallback: number): number | undefined {
	if (raw === undefined) {
		return fallback;
	}
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
		return undefined;
	}
	return raw;
}

function readNonNegativeNumber(raw: unknown, fallback: number): number | undefined {
	if (raw === undefined) {
		return fallback;
	}
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
		return undefined;
	}
	return raw;
}

function readProbability(raw: unknown, fallback: number): number | undefined {
	if (raw === undefined) {
		return fallback;
	}
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
		return undefined;
	}
	return raw;
}



export function matchesChatModelFeedbackSurvey(config: IChatModelFeedbackSurveyConfig, context: IChatModelFeedbackSurveyMatchContext): boolean {
	const { match } = config;

	if (match.selectedModels.length) {
		const candidates = expandModelMatchCandidates(context.selectedModelId, context.selectedModelAliases);
		if (!match.selectedModels.some(selector => candidates.has(selector))) {
			return false;
		}
	}

	if (match.resolvedModels.length) {
		const candidates = expandModelMatchCandidates(context.resolvedModelId);
		if (!match.resolvedModels.some(selector => candidates.has(selector))) {
			return false;
		}
	}

	if (match.modes.length && !matchesScalar(match.modes, context.modeId)) {
		return false;
	}

	if (match.harnesses.length && !matchesScalar(match.harnesses, context.harness ?? CHAT_MODEL_FEEDBACK_SURVEY_NO_HARNESS)) {
		return false;
	}

	if (match.sessionTypes.length && !matchesScalar(match.sessionTypes, context.sessionType)) {
		return false;
	}

	return true;
}

function matchesScalar(selectors: readonly string[], value: string | undefined): boolean {
	const normalized = value === undefined ? undefined : normalizeSelector(value);
	return !!normalized && selectors.includes(normalized);
}

