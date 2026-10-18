/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionSummaryMeta } from './state/sessionState.js';

export const enum SessionArtifactType {
	PullRequest = 'pullRequest',
	Issue = 'issue',
	Commit = 'commit',
	Website = 'website',
	File = 'file',
	Resource = 'resource',
}

export const SESSION_ARTIFACT_TYPES: readonly SessionArtifactType[] = [
	SessionArtifactType.PullRequest,
	SessionArtifactType.Issue,
	SessionArtifactType.Commit,
	SessionArtifactType.Website,
	SessionArtifactType.File,
	SessionArtifactType.Resource,
];

export interface ISessionArtifact {
	readonly id: string;
	readonly type: SessionArtifactType;
	readonly label: string;
	readonly isArtifact: boolean;
	readonly link?: string;
	readonly uri?: string;
	readonly commitHash?: string;
	readonly isGitHub?: boolean;
}

export const SESSION_META_ARTIFACTS_KEY = 'agentHost/sessionArtifacts';

function isSessionArtifactType(value: unknown): value is SessionArtifactType {
	return typeof value === 'string' && (SESSION_ARTIFACT_TYPES as readonly string[]).includes(value);
}

function parseSessionArtifact(value: unknown): ISessionArtifact | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['id'] !== 'string' || typeof raw['label'] !== 'string' || !isSessionArtifactType(raw['type'])) {
		return undefined;
	}
	const isArtifact = raw['isArtifact'];
	if (isArtifact !== undefined && typeof isArtifact !== 'boolean') {
		return undefined;
	}
	const artifact: {
		id: string;
		type: SessionArtifactType;
		label: string;
		isArtifact: boolean;
		link?: string;
		uri?: string;
		commitHash?: string;
		isGitHub?: boolean;
	} = {
		id: raw['id'],
		type: raw['type'],
		label: raw['label'],
		isArtifact: isArtifact ?? true,
	};

	if (typeof raw['link'] === 'string') { artifact.link = raw['link']; }
	if (typeof raw['uri'] === 'string') { artifact.uri = raw['uri']; }
	if (typeof raw['commitHash'] === 'string') { artifact.commitHash = raw['commitHash']; }
	if (typeof raw['isGitHub'] === 'boolean') { artifact.isGitHub = raw['isGitHub']; }
	return artifact;
}

export function readSessionArtifacts(meta: SessionSummaryMeta | undefined): readonly ISessionArtifact[] {
	const value = meta?.[SESSION_META_ARTIFACTS_KEY];
	if (!Array.isArray(value)) {
		return [];
	}
	const artifacts: ISessionArtifact[] = [];
	for (const entry of value) {
		const artifact = parseSessionArtifact(entry);
		if (artifact) {
			artifacts.push(artifact);
		}
	}
	return artifacts;
}

export function readSessionArtifactsNewestFirst(meta: SessionSummaryMeta | undefined): readonly ISessionArtifact[] {
	return readSessionArtifacts(meta).slice().reverse();
}

export function withSessionArtifacts(meta: SessionSummaryMeta | undefined, artifacts: readonly ISessionArtifact[]): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (artifacts.length > 0) {
		next[SESSION_META_ARTIFACTS_KEY] = artifacts;
	} else {
		delete next[SESSION_META_ARTIFACTS_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function stringifySessionArtifacts(artifacts: readonly ISessionArtifact[]): string {
	return JSON.stringify(artifacts);
}

export interface IParsedSessionArtifacts {
	readonly artifacts: readonly ISessionArtifact[];
	readonly error?: Error;
	readonly dropped: number;
}

export function parseSessionArtifacts(value: string | undefined): IParsedSessionArtifacts {
	if (!value) {
		return { artifacts: [], dropped: 0 };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(value);
	} catch (error) {
		return { artifacts: [], error: error instanceof Error ? error : new Error(String(error)), dropped: 0 };
	}
	if (!Array.isArray(raw)) {
		return { artifacts: [], error: new Error('expected an array of artifacts'), dropped: 0 };
	}
	const artifacts = readSessionArtifacts({ [SESSION_META_ARTIFACTS_KEY]: raw });
	return { artifacts, dropped: raw.length - artifacts.length };
}

export function getSessionArtifactValue(artifact: ISessionArtifact): string {
	const value = artifact.link ?? artifact.uri ?? artifact.commitHash ?? '';
	return value.trim().toLowerCase();
}

export function isGitHubArtifactLink(link: string): boolean {
	try {
		const { hostname } = new URL(link);
		return hostname === 'github.com' || hostname === 'www.github.com' || hostname.endsWith('.github.com') || hostname.startsWith('github.');
	} catch {
		return false;
	}
}
