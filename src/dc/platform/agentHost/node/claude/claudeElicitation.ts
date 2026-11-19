/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ElicitationRequest, ElicitationResult } from '@anthropic-ai/claude-agent-sdk';
import type { PrimitiveSchemaDefinition } from '@modelcontextprotocol/sdk/types.js';
import { isObject, isString } from '../../../../base/common/types.js';
import { vArray, vNumber, vObj, vOptionalProp, vString, vUnknown, type ValidatorType } from '../../../../base/common/validation.js';
import { ChatInputRequestPurpose, withChatInputRequestPurpose } from '../../common/meta/agentChatInputRequestMeta.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, type ChatInputAnswer, type ChatInputOption, type ChatInputQuestion, type ChatInputRequest } from '../../common/state/sessionState.js';


type ElicitationFieldValue = NonNullable<ElicitationResult['content']>[string];

const vTitledOption = vObj({ const: vString(), title: vOptionalProp(vString()) });

const vElicitationField = vObj({
	type: vOptionalProp(vString()),
	title: vOptionalProp(vString()),
	description: vOptionalProp(vString()),
	format: vOptionalProp(vString()),
	default: vOptionalProp(vUnknown()),
	minimum: vOptionalProp(vNumber()),
	maximum: vOptionalProp(vNumber()),
	minLength: vOptionalProp(vNumber()),
	maxLength: vOptionalProp(vNumber()),
	minItems: vOptionalProp(vNumber()),
	maxItems: vOptionalProp(vNumber()),
	enum: vOptionalProp(vArray(vString())),
	enumNames: vOptionalProp(vArray(vString())),
	oneOf: vOptionalProp(vArray(vTitledOption)),
	items: vOptionalProp(vObj({
		enum: vOptionalProp(vArray(vString())),
		anyOf: vOptionalProp(vArray(vTitledOption)),
	})),
});

type IElicitationField = ValidatorType<typeof vElicitationField>;

function _assertElicitationFieldCoversSchema(field: PrimitiveSchemaDefinition): IElicitationField {
	return field;
}
void _assertElicitationFieldCoversSchema;

interface IParsedElicitationSchema {
	readonly fields: ReadonlyArray<readonly [string, IElicitationField]>;
	readonly required: ReadonlySet<string>;
}

function parseElicitationSchema(schema: unknown): IParsedElicitationSchema | undefined {
	if (!isObject(schema)) {
		return undefined;
	}
	const properties = (schema as { properties?: unknown }).properties;
	if (!isObject(properties)) {
		return undefined;
	}
	const rawRequired = (schema as { required?: unknown }).required;
	const required = new Set<string>(Array.isArray(rawRequired) ? rawRequired.filter(isString) : []);
	const fields: Array<readonly [string, IElicitationField]> = [];
	for (const [name, field] of Object.entries(properties)) {
		const { content, error } = vElicitationField.validate(field);
		if (!error) {
			fields.push([name, content]);
		}
	}
	return { fields, required };
}

export function buildElicitationRequest(requestId: string, request: ElicitationRequest): ChatInputRequest {
	if (request.mode === 'url') {
		const result: ChatInputRequest = { id: requestId, message: request.message };
		if (request.url) {
			result.url = request.url;
		}
		return withChatInputRequestPurpose(result, ChatInputRequestPurpose.Elicitation);
	}
	const schema = parseElicitationSchema(request.requestedSchema);
	if (!schema || schema.fields.length === 0) {
		return withChatInputRequestPurpose({ id: requestId, message: request.message }, ChatInputRequestPurpose.Elicitation);
	}
	const questions = schema.fields.map(([name, field]) => elicitationFieldToQuestion(name, field, schema.required.has(name)));
	return withChatInputRequestPurpose({ id: requestId, message: request.message, questions }, ChatInputRequestPurpose.Elicitation);
}

export function elicitationResultFromAnswers(
	request: ElicitationRequest,
	response: ChatInputResponseKind,
	answers: Record<string, ChatInputAnswer> | undefined,
): ElicitationResult {
	if (response === ChatInputResponseKind.Decline) {
		return { action: 'decline' };
	}
	if (response !== ChatInputResponseKind.Accept) {
		return { action: 'cancel' };
	}
	const schema = request.mode === 'url' ? undefined : parseElicitationSchema(request.requestedSchema);
	if (!schema) {
		return { action: 'accept' };
	}
	const entries: [string, ElicitationFieldValue][] = [];
	for (const [name, field] of schema.fields) {
		const answer = answers && Object.hasOwn(answers, name) ? answers[name] : undefined;
		const value = elicitationAnswerToValue(field, answer);
		if (value !== undefined) {
			entries.push([name, value]);
		}
	}
	return { action: 'accept', content: Object.fromEntries(entries) };
}

export function cancelledElicitationResult(): ElicitationResult {
	return { action: 'cancel' };
}

function elicitationFieldToQuestion(id: string, field: IElicitationField, required: boolean): ChatInputQuestion {
	const base = { id, title: field.title ?? id, message: field.description ?? field.title ?? id, required };

	switch (field.type) {
		case 'boolean':
			return { ...base, kind: ChatInputQuestionKind.Boolean, defaultValue: typeof field.default === 'boolean' ? field.default : undefined };
		case 'number':
		case 'integer':
			return {
				...base,
				kind: field.type === 'integer' ? ChatInputQuestionKind.Integer : ChatInputQuestionKind.Number,
				min: field.minimum,
				max: field.maximum,
				defaultValue: typeof field.default === 'number' ? field.default : undefined,
			};
		case 'array':
			return {
				...base,
				kind: ChatInputQuestionKind.MultiSelect,
				allowFreeformInput: false,
				options: field.items?.anyOf
					? field.items.anyOf.map((o): ChatInputOption => ({ id: o.const, label: o.title || o.const }))
					: (field.items?.enum ?? []).map((v): ChatInputOption => ({ id: v, label: v })),
				min: field.minItems,
				max: field.maxItems,
			};
		case 'string':
		default:
			if (field.oneOf) {
				return {
					...base,
					kind: ChatInputQuestionKind.SingleSelect,
					allowFreeformInput: false,
					options: field.oneOf.map((o): ChatInputOption => ({ id: o.const, label: o.title || o.const })),
				};
			}
			if (field.enum) {
				const names = field.enumNames;
				return {
					...base,
					kind: ChatInputQuestionKind.SingleSelect,
					allowFreeformInput: false,
					options: field.enum.map((v, i): ChatInputOption => ({ id: v, label: names?.[i] || v })),
				};
			}
			return {
				...base,
				kind: ChatInputQuestionKind.Text,
				format: field.format,
				min: field.minLength,
				max: field.maxLength,
				defaultValue: typeof field.default === 'string' ? field.default : undefined,
			};
	}
}

function elicitationAnswerToValue(field: IElicitationField, answer: ChatInputAnswer | undefined): ElicitationFieldValue | undefined {
	if (!answer || answer.state === ChatInputAnswerState.Skipped) {
		return undefined;
	}
	const { value } = answer;
	switch (field.type) {
		case 'boolean':
			if (value.kind === ChatInputAnswerValueKind.Boolean) {
				return value.value;
			}
			if (value.kind === ChatInputAnswerValueKind.Text) {
				if (value.value === 'true') { return true; }
				if (value.value === 'false') { return false; }
			}
			return undefined;
		case 'number':
		case 'integer': {
			const n = value.kind === ChatInputAnswerValueKind.Number
				? value.value
				: value.kind === ChatInputAnswerValueKind.Text && value.value.trim() !== ''
					? Number(value.value)
					: undefined;
			if (n === undefined || !Number.isFinite(n)) {
				return undefined;
			}
			return field.type === 'integer' ? Math.trunc(n) : n;
		}
		case 'array':
			if (value.kind === ChatInputAnswerValueKind.SelectedMany) {
				return [...value.value, ...(value.freeformValues ?? [])];
			}
			if (value.kind === ChatInputAnswerValueKind.Selected) {
				return value.value ? [value.value, ...(value.freeformValues ?? [])] : [...(value.freeformValues ?? [])];
			}
			if (value.kind === ChatInputAnswerValueKind.Text) {
				return value.value ? [value.value] : [];
			}
			return undefined;
		case 'string':
		default:
			if (value.kind === ChatInputAnswerValueKind.Text) {
				return value.value;
			}
			if (value.kind === ChatInputAnswerValueKind.Selected) {
				return value.value;
			}
			return undefined;
	}
}
