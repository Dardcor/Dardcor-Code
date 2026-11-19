/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ISSHHostKeyVerificationRequest } from './sshRemoteAgentHost.js';
import type { ISSHTrustedHostKey } from './sshHostKeyTrust.js';

export type SSHHostKeyDenial =
	| { readonly kind: 'deny'; readonly reason: 'mismatch'; readonly source: 'stored' | 'known-hosts' }
	| { readonly kind: 'deny'; readonly reason: 'revoked' | 'strict-yes' | 'not-user-initiated' };

export type SSHHostKeyDecision =
	| { readonly kind: 'trust'; readonly persist: boolean; readonly reason: 'stored' | 'known-hosts' | 'strict-accept-new' | 'strict-disabled' }
	| SSHHostKeyDenial
	| { readonly kind: 'prompt'; readonly reason: 'unknown' | 'ca-only' };

export function decideHostKeyTrust(
	request: ISSHHostKeyVerificationRequest,
	trustedKeys: readonly ISSHTrustedHostKey[],
): SSHHostKeyDecision {
	const strict = request.strictHostKeyChecking;

	if (request.knownHostsMatch === 'revoked') {
		return { kind: 'deny', reason: 'revoked' };
	}

	if (strict === 'no' || strict === 'off') {
		const storedUnderOptOut = trustedKeys.find(key => key.keyType === request.keyType);
		if (storedUnderOptOut && storedUnderOptOut.fingerprint !== request.fingerprint) {
			return { kind: 'deny', reason: 'mismatch', source: 'stored' };
		}
		if (request.knownHostsMatch === 'mismatch') {
			return { kind: 'deny', reason: 'mismatch', source: 'known-hosts' };
		}
		return { kind: 'trust', persist: false, reason: 'strict-disabled' };
	}

	const storedForKeyType = trustedKeys.find(key => key.keyType === request.keyType);
	if (storedForKeyType) {
		return storedForKeyType.fingerprint === request.fingerprint
			? { kind: 'trust', persist: false, reason: 'stored' }
			: { kind: 'deny', reason: 'mismatch', source: 'stored' };
	}

	if (request.knownHostsMatch === 'mismatch') {
		return { kind: 'deny', reason: 'mismatch', source: 'known-hosts' };
	}

	if (request.knownHostsMatch === 'match') {
		return { kind: 'trust', persist: true, reason: 'known-hosts' };
	}

	if (strict === 'yes') {
		return { kind: 'deny', reason: 'strict-yes' };
	}
	if (strict === 'accept-new') {
		return { kind: 'trust', persist: true, reason: 'strict-accept-new' };
	}
	if (!request.userInitiated) {
		return { kind: 'deny', reason: 'not-user-initiated' };
	}
	return { kind: 'prompt', reason: request.knownHostsMatch === 'ca-only' ? 'ca-only' : 'unknown' };
}
