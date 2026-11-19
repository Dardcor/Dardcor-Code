/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface RepetitionConfig {
	max_token_sequence_length: number;
	last_tokens_to_consider: number;
}

const configs: RepetitionConfig[] = [
	{ max_token_sequence_length: 1, last_tokens_to_consider: 10 },
	{ max_token_sequence_length: 10, last_tokens_to_consider: 30 },
	{ max_token_sequence_length: 20, last_tokens_to_consider: 45 },
	{ max_token_sequence_length: 30, last_tokens_to_consider: 60 },
];

export function isRepetitive(tokens: readonly string[]): boolean {
	const tokensBackwards = tokens.slice();
	tokensBackwards.reverse();
	return (
		isRepeatedPattern(tokensBackwards) ||
		isRepeatedPattern(tokensBackwards.filter(token => token.trim().length > 0))
	);
}

function isRepeatedPattern<T>(s: ArrayLike<T>): boolean {
	const prefix = kmp_prefix_function(s);
	for (const config of configs) {
		if (s.length < config.last_tokens_to_consider) {
			continue;
		}
		const patternLength = config.last_tokens_to_consider - 1 - prefix[config.last_tokens_to_consider - 1];
		if (patternLength <= config.max_token_sequence_length) {
			return true;
		}
	}
	return false;
}

function kmp_prefix_function<T>(s: ArrayLike<T>): number[] {
	const pi = Array<number>(s.length).fill(0);
	pi[0] = -1;
	let k = -1;
	for (let q = 1; q < s.length; q++) {
		while (k >= 0 && s[k + 1] !== s[q]) {
			k = pi[k];
		}
		if (s[k + 1] === s[q]) {
			k++;
		}
		pi[q] = k;
	}
	return pi;
}
