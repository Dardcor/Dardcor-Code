/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type KnownHostsMatch =
	| 'match'
	| 'mismatch'
	| 'revoked'
	| 'ca-only'
	| 'unknown';

export interface IKnownHostsEntry {
	readonly marker?: 'revoked' | 'cert-authority';
	readonly patterns: readonly string[];
	readonly hashedHost?: { readonly salt: Buffer; readonly hash: Buffer };
	readonly keyType: string;
	readonly key: Buffer;
}

export function computeHostKeyFingerprint(keyBlob: Buffer): string {
	const digest = createHash('sha256').update(keyBlob).digest('base64');
	return `SHA256:${digest.replace(/=+$/, '')}`;
}

export function readHostKeyType(keyBlob: Buffer): string | undefined {
	if (keyBlob.length < 4) {
		return undefined;
	}
	const length = keyBlob.readUInt32BE(0);
	if (length === 0 || length > 64 || 4 + length > keyBlob.length) {
		return undefined;
	}
	return keyBlob.subarray(4, 4 + length).toString('ascii');
}

export function parseKnownHostsLine(line: string): IKnownHostsEntry | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return undefined;
	}

	const fields = trimmed.split(/\s+/);
	let index = 0;

	let marker: 'revoked' | 'cert-authority' | undefined;
	if (fields[index]?.startsWith('@')) {
		const raw = fields[index].substring(1);
		if (raw !== 'revoked' && raw !== 'cert-authority') {
			return undefined;
		}
		marker = raw;
		index++;
	}

	const hostField = fields[index++];
	const keyType = fields[index++];
	const keyBase64 = fields[index++];
	if (!hostField || !keyType || !keyBase64) {
		return undefined;
	}

	let key: Buffer;
	try {
		key = Buffer.from(keyBase64, 'base64');
	} catch {
		return undefined;
	}
	if (key.length === 0 || readHostKeyType(key) !== keyType) {
		return undefined;
	}

	if (hostField.startsWith('|1|')) {
		const parts = hostField.split('|');
		if (parts.length !== 4) {
			return undefined;
		}
		const salt = Buffer.from(parts[2], 'base64');
		const hash = Buffer.from(parts[3], 'base64');
		if (salt.length === 0 || hash.length !== 20) {
			return undefined;
		}
		return { marker, patterns: [], hashedHost: { salt, hash }, keyType, key };
	}

	return { marker, patterns: hostField.split(','), keyType, key };
}

export function parseKnownHosts(contents: string): IKnownHostsEntry[] {
	const entries: IKnownHostsEntry[] = [];
	for (const line of contents.split('\n')) {
		const entry = parseKnownHostsLine(line);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

function hostCandidates(host: string, port: number): string[] {
	const lower = host.toLowerCase();
	return port === 22 ? [lower] : [`[${lower}]:${port}`];
}

function matchesPattern(pattern: string, candidate: string): boolean {
	const escaped = pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
	return regex.test(candidate);
}

function entryAppliesToCandidate(patterns: readonly string[], candidate: string): boolean {
	let matched = false;
	for (const pattern of patterns) {
		if (pattern.startsWith('!')) {
			if (matchesPattern(pattern.substring(1), candidate)) {
				return false;
			}
		} else if (matchesPattern(pattern, candidate)) {
			matched = true;
		}
	}
	return matched;
}

function hashedEntryAppliesToCandidate(hashedHost: { salt: Buffer; hash: Buffer }, candidate: string): boolean {
	const computed = createHmac('sha1', hashedHost.salt).update(candidate).digest();
	return computed.length === hashedHost.hash.length && timingSafeEqual(computed, hashedHost.hash);
}

function entryApplies(entry: IKnownHostsEntry, candidates: readonly string[]): boolean {
	return candidates.some(candidate => entry.hashedHost
		? hashedEntryAppliesToCandidate(entry.hashedHost, candidate)
		: entryAppliesToCandidate(entry.patterns, candidate));
}

export function matchKnownHosts(
	entries: readonly IKnownHostsEntry[],
	host: string,
	port: number,
	keyType: string,
	keyBlob: Buffer,
): KnownHostsMatch {
	const candidates = hostCandidates(host, port);
	const applicable = entries.filter(entry => entryApplies(entry, candidates));

	if (applicable.some(entry => entry.marker === 'revoked' && entry.key.equals(keyBlob))) {
		return 'revoked';
	}

	let sawSameTypeEntry = false;
	let sawCertAuthority = false;

	for (const entry of applicable) {
		if (entry.marker === 'revoked') {
			continue;
		}

		if (entry.marker === 'cert-authority') {
			sawCertAuthority = true;
			continue;
		}

		if (entry.keyType !== keyType) {
			continue;
		}
		if (entry.key.equals(keyBlob)) {
			return 'match';
		}
		sawSameTypeEntry = true;
	}

	if (sawSameTypeEntry) {
		return 'mismatch';
	}
	return sawCertAuthority ? 'ca-only' : 'unknown';
}
