/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../../../base/common/async.js';
import { DisposableStore, MutableDisposable, toDisposable, type IDisposable } from '../../../../../../base/common/lifecycle.js';
import type { IMarker as IXtermMarker } from '@xterm/xterm';

export function setupRecreatingStartMarker(
	xterm: { raw: { registerMarker(): IXtermMarker | undefined } },
	startMarker: MutableDisposable<IXtermMarker>,
	fire: (marker: IXtermMarker | undefined) => void,
	store: DisposableStore,
	log?: (message: string) => void,
): IDisposable {
	const markerListener = new MutableDisposable<IDisposable>();
	const recreateStartMarker = () => {
		if (store.isDisposed) {
			return;
		}
		const marker = xterm.raw.registerMarker();
		startMarker.value = marker ?? undefined;
		fire(marker);
		if (!marker) {
			markerListener.clear();
			return;
		}
		markerListener.value = marker.onDispose(() => {
			log?.('Start marker was disposed, recreating');
			recreateStartMarker();
		});
	};
	recreateStartMarker();
	store.add(toDisposable(() => {
		markerListener.dispose();
		startMarker.clear();
		fire(undefined);
	}));
	store.add(startMarker);

	return toDisposable(() => markerListener.dispose());
}

export function createAltBufferPromise(
	xterm: { raw: { buffer: { active: unknown; alternate: unknown; onBufferChange: (callback: () => void) => IDisposable } } },
	store: DisposableStore,
	log?: (message: string) => void,
): Promise<void> {
	const deferred = new DeferredPromise<void>();
	const complete = () => {
		if (!deferred.isSettled) {
			log?.('Detected alternate buffer entry');
			deferred.complete();
		}
	};

	if (xterm.raw.buffer.active === xterm.raw.buffer.alternate) {
		complete();
	} else {
		store.add(xterm.raw.buffer.onBufferChange(() => {
			if (xterm.raw.buffer.active === xterm.raw.buffer.alternate) {
				complete();
			}
		}));
	}

	return deferred.p;
}

export function stripCommandEchoAndPrompt(output: string, commandLine: string, log?: (message: string) => void): string {
	log?.(`stripCommandEchoAndPrompt input: output length=${output.length}, commandLine length=${commandLine.length}`);

	const result = _stripCommandEchoAndPromptOnce(output, commandLine, log);

	if (result.trim().length > 0 && findCommandEcho(result, commandLine)) {
		return _stripCommandEchoAndPromptOnce(result, commandLine, log);
	}

	return result;
}

function _stripCommandEchoAndPromptOnce(output: string, commandLine: string, log?: (message: string) => void): string {
	const echoResult = findCommandEcho(output, commandLine, true);
	const lines = echoResult ? echoResult.linesAfter : output.split('\n');
	const startIndex = 0;

	const promptBefore = echoResult?.contentBefore ?? '';
	const isUnixAt = /\w+@[\w.-]+:/.test(promptBefore);
	const isUnixHost = !isUnixAt && /[\w.-]+:\S/.test(promptBefore);
	const isUnix = isUnixAt || isUnixHost;
	const isPowerShell = /^PS\s/i.test(promptBefore);
	const isCmd = !isPowerShell && /^[A-Z]:\\/.test(promptBefore);
	const isStarship = /\u276f/.test(promptBefore);
	const isPython = />>>/.test(promptBefore);
	const knownPrompt = isUnix || isPowerShell || isCmd || isStarship || isPython;

	let endIndex = lines.length;
	let trailingStrippedCount = 0;
	const maxTrailingPromptLines = 2;
	while (endIndex > startIndex) {
		const line = lines[endIndex - 1].trimEnd();
		if (line.length === 0) {
			endIndex--;
			continue;
		}
		if (trailingStrippedCount >= maxTrailingPromptLines) {
			break;
		}

		const isCompletePrompt =
			((!knownPrompt || isUnixAt) && /^\s*\w+@[\w.-]+:.*[#$]\s*$/.test(line)) ||
			((!knownPrompt || isUnixHost) && /^\s*[\w.-]+:\S.*\s\w+[#$]\s*$/.test(line)) ||
			((!knownPrompt || isPowerShell) && /^PS\s+[A-Z]:\\.*>\s*$/.test(line)) ||
			((!knownPrompt || isCmd) && /^[A-Z]:\\.*>\s*$/.test(line)) ||
			((!knownPrompt || isStarship) && /\u276f\s*$/.test(line)) ||
			((!knownPrompt || isPython) && /^>>>\s*$/.test(line));

		const isPromptFragment =
			((!knownPrompt || isUnix) && /^\s*[\w/.-]+[#$]\s*$/.test(line)) ||
			((!knownPrompt || isUnix) && /^\[\s*[\w.-]+(@[\w.-]+)?:[~\/]/.test(line)) ||
			((!knownPrompt || isUnix) && trailingStrippedCount > 0 && /^\s*[\w][-\w.]*(@[\w.-]+)?:\S/.test(line)) ||
			((!knownPrompt || isUnix) && /\]\s*[#$]\s*$/.test(line));

		if (isCompletePrompt) {
			endIndex--;
			trailingStrippedCount++;
			break;
		} else if (isPromptFragment) {
			endIndex--;
			trailingStrippedCount++;
		} else {
			break;
		}
	}

	const result = lines.slice(startIndex, endIndex).join('\n');
	log?.(`stripCommandEchoAndPrompt result: length=${result.length} (startIndex=${startIndex}, endIndex=${endIndex}, totalLines=${lines.length})`);
	return result;
}

export function findCommandEcho(output: string, commandLine: string, allowSuffixMatch?: boolean): { contentBefore: string; linesAfter: string[] } | undefined {
	const trimmedCommand = commandLine.trim();
	if (trimmedCommand.length === 0) {
		return undefined;
	}

	const { strippedOutput, indexMapping } = stripNewLinesAndBuildMapping(output);
	const matchIndex = strippedOutput.indexOf(trimmedCommand);

	let matchEndInStripped: number;
	let contentBefore: string;

	if (matchIndex !== -1) {
		contentBefore = strippedOutput.substring(0, matchIndex).trim();
		matchEndInStripped = matchIndex + trimmedCommand.length - 1;
	} else if (allowSuffixMatch) {
		let suffixLen = 0;
		for (let len = trimmedCommand.length - 1; len >= 1; len--) {
			const suffix = trimmedCommand.substring(trimmedCommand.length - len);
			if (strippedOutput.startsWith(suffix)) {
				const charBefore = trimmedCommand[trimmedCommand.length - len - 1];
				if (charBefore !== undefined && charBefore !== ' ' && charBefore !== '\t') {
					suffixLen = len;
				}
				break;
			}
		}
		if (suffixLen === 0) {
			return undefined;
		}
		contentBefore = '';
		matchEndInStripped = suffixLen - 1;
	} else {
		return undefined;
	}

	const originalEnd = indexMapping[matchEndInStripped];

	const lines = output.split('\n');
	let echoEndLine = 0;
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		const lineEnd = offset + lines[i].length;
		if (offset <= originalEnd && originalEnd <= lineEnd) {
			echoEndLine = i + 1;
			break;
		}
		offset = lineEnd + 1;
	}

	return {
		contentBefore,
		linesAfter: lines.slice(echoEndLine),
	};
}

export function stripNewLinesAndBuildMapping(output: string): { strippedOutput: string; indexMapping: number[] } {
	const indexMapping: number[] = [];
	const strippedChars: string[] = [];
	for (let i = 0; i < output.length; i++) {
		if (output[i] !== '\n') {
			strippedChars.push(output[i]);
			indexMapping.push(i);
		}
	}
	return { strippedOutput: strippedChars.join(''), indexMapping };
}
