/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { getSessionArtifactValue, isGitHubArtifactLink, SESSION_ARTIFACT_TYPES, SessionArtifactType, type ISessionArtifact } from './sessionArtifacts.js';

export interface ISessionArtifactInput {
	readonly type: SessionArtifactType;
	readonly label: string;
	readonly isArtifact: boolean;
	readonly link?: string;
	readonly uri?: string;
	readonly commitHash?: string;
}

export interface IAddSessionArtifactResult {
	readonly artifacts: readonly ISessionArtifact[];
	readonly artifact: ISessionArtifact;
	readonly added: boolean;
}

export interface IRemoveSessionArtifactResult {
	readonly artifacts: readonly ISessionArtifact[];
	readonly removed: ISessionArtifact | undefined;
}

const linkTypes: ReadonlySet<SessionArtifactType> = new Set([SessionArtifactType.PullRequest, SessionArtifactType.Issue, SessionArtifactType.Website, SessionArtifactType.Commit]);
const uriTypes: ReadonlySet<SessionArtifactType> = new Set([SessionArtifactType.File, SessionArtifactType.Resource]);
const gitHubTypes: ReadonlySet<SessionArtifactType> = new Set([SessionArtifactType.PullRequest, SessionArtifactType.Issue]);

function requireString(value: unknown, field: string, toolName: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Invalid ${toolName} input: ${field} must be a non-empty string.`);
	}
	return value.trim();
}

function requireWebLink(value: unknown, field: string, toolName: string): string {
	const link = requireString(value, field, toolName);
	let scheme: string;
	try {
		scheme = new URL(link).protocol;
	} catch {
		throw new Error(`Invalid ${toolName} input: ${field} must be an absolute http(s) URL.`);
	}
	if (scheme !== 'http:' && scheme !== 'https:') {
		throw new Error(`Invalid ${toolName} input: ${field} must be an http(s) URL, but was '${scheme}'.`);
	}
	return link;
}

function requireUri(value: unknown, field: string, toolName: string): string {
	const uri = requireString(value, field, toolName);
	let scheme: string | undefined;
	try {
		scheme = URI.parse(uri, true).scheme;
	} catch {
		scheme = undefined;
	}
	if (!scheme || scheme.length === 1) {
		throw new Error(`Invalid ${toolName} input: ${field} must be an absolute URI including its scheme, such as 'file:///path/to/file' — not a plain file system path.`);
	}
	return uri;
}

function parseSessionArtifactInputAt(rawArgs: unknown, toolName: string, fieldPrefix?: string): ISessionArtifactInput {
	if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
		throw new Error(`Invalid ${toolName} input: ${fieldPrefix ? `${fieldPrefix} must be an object.` : 'expected an object.'}`);
	}
	const args = rawArgs as Record<string, unknown>;
	const field = (name: string) => fieldPrefix ? `${fieldPrefix}.${name}` : name;
	const type = args['type'];
	if (typeof type !== 'string' || !(SESSION_ARTIFACT_TYPES as readonly string[]).includes(type)) {
		throw new Error(`Invalid ${toolName} input: ${field('type')} must be one of ${SESSION_ARTIFACT_TYPES.join(', ')}.`);
	}
	if (typeof args['isArtifact'] !== 'boolean') {
		throw new Error(`Invalid ${toolName} input: ${field('isArtifact')} must be a boolean — true for an artifact, false for a reference.`);
	}

	const artifactType = type as SessionArtifactType;
	const input: { type: SessionArtifactType; label: string; isArtifact: boolean; link?: string; uri?: string; commitHash?: string } = {
		type: artifactType,
		label: requireString(args['label'], field('label'), toolName),
		isArtifact: args['isArtifact'],
	};

	if (linkTypes.has(artifactType)) {
		input.link = requireWebLink(args['link'], field('link'), toolName);
	}
	if (uriTypes.has(artifactType)) {
		input.uri = requireUri(args['uri'], field('uri'), toolName);
	}
	if (artifactType === SessionArtifactType.Commit) {
		input.commitHash = requireString(args['commitHash'], field('commitHash'), toolName);
	}
	return input;
}

export function parseSessionArtifactInput(rawArgs: unknown, toolName: string): ISessionArtifactInput {
	return parseSessionArtifactInputAt(rawArgs, toolName);
}

export function parseSessionArtifactInputs(rawArgs: unknown, toolName: string): readonly ISessionArtifactInput[] {
	if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
		throw new Error(`Invalid ${toolName} input: expected an object.`);
	}
	const items = (rawArgs as Record<string, unknown>)['items'];
	if (items === undefined) {
		return [parseSessionArtifactInput(rawArgs, toolName)];
	}
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error(`Invalid ${toolName} input: items must be a non-empty array.`);
	}
	return items.map((item, index) => parseSessionArtifactInputAt(item, toolName, `items[${index}]`));
}

export class SessionArtifactCollection {

	constructor(private readonly _artifacts: readonly ISessionArtifact[] = []) { }

	get artifacts(): readonly ISessionArtifact[] {
		return this._artifacts;
	}

	add(input: ISessionArtifactInput, createId: () => string): IAddSessionArtifactResult {
		const artifact = this._create(input, createId);
		const value = getSessionArtifactValue(artifact);
		const existing = this._artifacts.find(candidate => getSessionArtifactValue(candidate) === value);
		if (existing) {
			return { artifacts: this._artifacts, artifact: existing, added: false };
		}
		return { artifacts: [...this._artifacts, artifact], artifact, added: true };
	}

	remove(id: string): IRemoveSessionArtifactResult {
		const removed = this._artifacts.find(artifact => artifact.id === id);
		return {
			artifacts: removed ? this._artifacts.filter(artifact => artifact !== removed) : this._artifacts,
			removed,
		};
	}

	private _create(input: ISessionArtifactInput, createId: () => string): ISessionArtifact {
		const artifact: {
			id: string;
			type: SessionArtifactType;
			label: string;
			isArtifact: boolean;
			link?: string;
			uri?: string;
			commitHash?: string;
			isGitHub?: boolean;
		} = { id: createId(), type: input.type, label: input.label, isArtifact: input.isArtifact };

		if (input.link !== undefined) { artifact.link = input.link; }
		if (input.uri !== undefined) { artifact.uri = input.uri; }
		if (input.commitHash !== undefined) { artifact.commitHash = input.commitHash; }
		if (input.link !== undefined && gitHubTypes.has(input.type)) { artifact.isGitHub = isGitHubArtifactLink(input.link); }
		return artifact;
	}
}
