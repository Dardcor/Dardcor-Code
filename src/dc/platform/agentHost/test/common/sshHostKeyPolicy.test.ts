/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { decideHostKeyTrust, type SSHHostKeyDecision } from '../../common/sshHostKeyPolicy.js';
import type { ISSHTrustedHostKey } from '../../common/sshHostKeyTrust.js';
import type { ISSHHostKeyVerificationRequest, SSHKnownHostsMatch, SSHStrictHostKeyChecking } from '../../common/sshRemoteAgentHost.js';

const FINGERPRINT = 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_FINGERPRINT = 'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeRequest(overrides: {
	knownHostsMatch?: SSHKnownHostsMatch;
	strictHostKeyChecking?: SSHStrictHostKeyChecking;
	userInitiated?: boolean;
} = {}): ISSHHostKeyVerificationRequest {
	return {
		requestId: 'hostkey-1',
		connectionKey: 'ssh:testhost',
		displayHost: 'testhost',
		host: 'test.example.com',
		port: 22,
		keyType: 'ssh-ed25519',
		fingerprint: FINGERPRINT,
		knownHostsMatch: overrides.knownHostsMatch ?? 'unknown',
		...(overrides.strictHostKeyChecking ? { strictHostKeyChecking: overrides.strictHostKeyChecking } : undefined),
		userInitiated: overrides.userInitiated ?? true,
	};
}

function trusted(fingerprint: string, keyType = 'ssh-ed25519'): ISSHTrustedHostKey[] {
	return [{ keyType, fingerprint, addedAt: 1 }];
}

function summarize(decision: SSHHostKeyDecision): string {
	return decision.kind === 'trust'
		? `trust(${decision.reason}${decision.persist ? ',persist' : ''})`
		: `${decision.kind}(${decision.reason})`;
}

suite('sshHostKeyPolicy', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('decides from the trust store first', () => {
		assert.deepStrictEqual(
			{
				storedMatch: summarize(decideHostKeyTrust(makeRequest(), trusted(FINGERPRINT))),
				storedDiffers: summarize(decideHostKeyTrust(makeRequest(), trusted(OTHER_FINGERPRINT))),
				storedOtherKeyType: summarize(decideHostKeyTrust(makeRequest(), trusted(OTHER_FINGERPRINT, 'ssh-rsa'))),
			},
			{
				storedMatch: 'trust(stored)',
				storedDiffers: 'deny(mismatch)',
				storedOtherKeyType: 'prompt(unknown)',
			});
	});

	test('falls back to known_hosts when nothing is stored', () => {
		const decide = (knownHostsMatch: SSHKnownHostsMatch) =>
			summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch }), []));
		assert.deepStrictEqual(
			{
				match: decide('match'),
				mismatch: decide('mismatch'),
				revoked: decide('revoked'),
				caOnly: decide('ca-only'),
				unknown: decide('unknown'),
			},
			{
				match: 'trust(known-hosts,persist)',
				mismatch: 'deny(mismatch)',
				revoked: 'deny(revoked)',
				caOnly: 'prompt(ca-only)',
				unknown: 'prompt(unknown)',
			});
	});

	test('revocation overrides a stored trust entry', () => {
		assert.strictEqual(
			summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch: 'revoked' }), trusted(FINGERPRINT))),
			'deny(revoked)');
	});

	test('revocation overrides even a StrictHostKeyChecking opt-out', () => {
		assert.deepStrictEqual(
			{
				no: summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch: 'revoked', strictHostKeyChecking: 'no' }), [])),
				off: summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch: 'revoked', strictHostKeyChecking: 'off' }), [])),
			},
			{ no: 'deny(revoked)', off: 'deny(revoked)' });
	});

	test('a stored key wins over a disagreeing known_hosts file', () => {
		assert.strictEqual(
			summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch: 'match' }), trusted(OTHER_FINGERPRINT))),
			'deny(mismatch)');
	});

	test('honors StrictHostKeyChecking', () => {
		const decide = (strictHostKeyChecking: SSHStrictHostKeyChecking, knownHostsMatch: SSHKnownHostsMatch = 'unknown') =>
			summarize(decideHostKeyTrust(makeRequest({ strictHostKeyChecking, knownHostsMatch }), []));
		assert.deepStrictEqual(
			{
				ask: decide('ask'),
				acceptNewUnknown: decide('accept-new'),
				yesUnknown: decide('yes'),
				no: decide('no'),
				off: decide('off'),
				noWithMismatch: decide('no', 'mismatch'),
				offWithMismatch: decide('off', 'mismatch'),
				noWithStoredMismatch: summarize(decideHostKeyTrust(
					makeRequest({ strictHostKeyChecking: 'no', knownHostsMatch: 'unknown' }),
					trusted(OTHER_FINGERPRINT))),
				acceptNewMismatch: decide('accept-new', 'mismatch'),
				acceptNewRevoked: decide('accept-new', 'revoked'),
			},
			{
				ask: 'prompt(unknown)',
				acceptNewUnknown: 'trust(strict-accept-new,persist)',
				yesUnknown: 'deny(strict-yes)',
				no: 'trust(strict-disabled)',
				off: 'trust(strict-disabled)',
				noWithMismatch: 'deny(mismatch)',
				offWithMismatch: 'deny(mismatch)',
				noWithStoredMismatch: 'deny(mismatch)',
				acceptNewMismatch: 'deny(mismatch)',
				acceptNewRevoked: 'deny(revoked)',
			});
	});

	test('never prompts during a background reconnect', () => {
		const decide = (knownHostsMatch: SSHKnownHostsMatch, keys: ISSHTrustedHostKey[] = []) =>
			summarize(decideHostKeyTrust(makeRequest({ knownHostsMatch, userInitiated: false }), keys));
		assert.deepStrictEqual(
			{
				unknown: decide('unknown'),
				caOnly: decide('ca-only'),
				stored: decide('unknown', trusted(FINGERPRINT)),
				knownHosts: decide('match'),
			},
			{
				unknown: 'deny(not-user-initiated)',
				caOnly: 'deny(not-user-initiated)',
				stored: 'trust(stored)',
				knownHosts: 'trust(known-hosts,persist)',
			});
	});
});
