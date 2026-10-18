/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWindows } from '../../../../../base/common/platform.js';
import { count } from '../../../../../base/common/strings.js';
import { isString } from '../../../../../base/common/types.js';
import { SimpleCompletionModel, type LineContext } from '../../../../services/suggest/browser/simpleCompletionModel.js';
import { TerminalCompletionItemKind, type TerminalCompletionItem } from './terminalCompletionItem.js';

export class TerminalCompletionModel extends SimpleCompletionModel<TerminalCompletionItem> {
	constructor(
		items: TerminalCompletionItem[],
		lineContext: LineContext
	) {
		super(items, lineContext, compareCompletionsFn);
	}
}

const compareCompletionsFn = (leadingLineContent: string, a: TerminalCompletionItem, b: TerminalCompletionItem) => {
	if (a.completion.kind === TerminalCompletionItemKind.InlineSuggestionAlwaysOnTop && a.completion.kind !== b.completion.kind) {
		return -1;
	}
	if (b.completion.kind === TerminalCompletionItemKind.InlineSuggestionAlwaysOnTop && a.completion.kind !== b.completion.kind) {
		return 1;
	}

	let score = b.score[0] - a.score[0];
	if (score !== 0) {
		return score;
	}

	if (a.completion.kind === TerminalCompletionItemKind.InlineSuggestion && a.completion.kind !== b.completion.kind) {
		return -1;
	}
	if (b.completion.kind === TerminalCompletionItemKind.InlineSuggestion && a.completion.kind !== b.completion.kind) {
		return 1;
	}

	if (a.punctuationPenalty !== b.punctuationPenalty) {
		return a.punctuationPenalty - b.punctuationPenalty;
	}

	const isArg = leadingLineContent.includes(' ');
	if (!isArg && a.completion.kind === TerminalCompletionItemKind.File && b.completion.kind === TerminalCompletionItemKind.File) {
		if (a.labelLowExcludeFileExt !== b.labelLowExcludeFileExt) {
			return a.labelLowExcludeFileExt.localeCompare(b.labelLowExcludeFileExt, undefined, { ignorePunctuation: true });
		}
		score = a.labelLowExcludeFileExt.length - b.labelLowExcludeFileExt.length;
		if (score !== 0) {
			return score;
		}
		score = fileExtScore(b.fileExtLow) - fileExtScore(a.fileExtLow);
		if (score !== 0) {
			return score;
		}
		score = a.fileExtLow.length - b.fileExtLow.length;
		if (score !== 0) {
			return score;
		}
	}

	if (a.completion.kind === TerminalCompletionItemKind.Argument && b.completion.kind === TerminalCompletionItemKind.Argument && /^\s*git\b/.test(leadingLineContent)) {
		const aLabel = isString(a.completion.label) ? a.completion.label : a.completion.label.label;
		const bLabel = isString(b.completion.label) ? b.completion.label : b.completion.label.label;
		const aIsMainOrMaster = aLabel === 'main' || aLabel === 'master';
		const bIsMainOrMaster = bLabel === 'main' || bLabel === 'master';

		if (aIsMainOrMaster && !bIsMainOrMaster) {
			return -1;
		}
		if (bIsMainOrMaster && !aIsMainOrMaster) {
			return 1;
		}
	}

	if (a.completion.kind === TerminalCompletionItemKind.Method && b.completion.kind === TerminalCompletionItemKind.Method) {
		if (!isString(a.completion.label) && a.completion.label.description && !isString(b.completion.label) && b.completion.label.description) {
			score = 0;
		} else if (!isString(a.completion.label) && a.completion.label.description) {
			score = -2;
		} else if (!isString(b.completion.label) && b.completion.label.description) {
			score = 2;
		}
		score += (b.completion.detail ? 1 : 0) + (b.completion.documentation ? 2 : 0) - (a.completion.detail ? 1 : 0) - (a.completion.documentation ? 2 : 0);
		if (score !== 0) {
			return score;
		}
	}

	if (a.completion.kind === TerminalCompletionItemKind.Folder && b.completion.kind === TerminalCompletionItemKind.Folder) {
		if (a.labelLowNormalizedPath && b.labelLowNormalizedPath) {
			score = count(a.labelLowNormalizedPath, '/') - count(b.labelLowNormalizedPath, '/');
			if (score !== 0) {
				return score;
			}

			if (b.labelLowNormalizedPath.startsWith(a.labelLowNormalizedPath)) {
				return -1;
			}
			if (a.labelLowNormalizedPath.startsWith(b.labelLowNormalizedPath)) {
				return 1;
			}
		}
	}

	if (a.completion.kind !== b.completion.kind) {
		if ((a.completion.kind === TerminalCompletionItemKind.Method || a.completion.kind === TerminalCompletionItemKind.Alias) && (b.completion.kind !== TerminalCompletionItemKind.Method && b.completion.kind !== TerminalCompletionItemKind.Alias)) {
			return -1;
		}
		if ((b.completion.kind === TerminalCompletionItemKind.Method || b.completion.kind === TerminalCompletionItemKind.Alias) && (a.completion.kind !== TerminalCompletionItemKind.Method && a.completion.kind !== TerminalCompletionItemKind.Alias)) {
			return 1;
		}
		if (a.completion.kind === TerminalCompletionItemKind.Argument && b.completion.kind !== TerminalCompletionItemKind.Argument) {
			return -1;
		}
		if (b.completion.kind === TerminalCompletionItemKind.Argument && a.completion.kind !== TerminalCompletionItemKind.Argument) {
			return 1;
		}
		if (isResourceKind(a.completion.kind) && !isResourceKind(b.completion.kind)) {
			return 1;
		}
		if (isResourceKind(b.completion.kind) && !isResourceKind(a.completion.kind)) {
			return -1;
		}
	}

	return a.labelLow.localeCompare(b.labelLow, undefined, { ignorePunctuation: true });
};

const isResourceKind = (kind: TerminalCompletionItemKind | undefined) =>
	kind === TerminalCompletionItemKind.File ||
	kind === TerminalCompletionItemKind.Folder ||
	kind === TerminalCompletionItemKind.SymbolicLinkFile ||
	kind === TerminalCompletionItemKind.SymbolicLinkFolder;

const fileExtScores = new Map<string, number>(isWindows ? [
	['ps1', 0.09],
	['exe', 0.08],
	['bat', 0.07],
	['cmd', 0.07],
	['msi', 0.06],
	['com', 0.06],
	['sh', -0.05],
	['bash', -0.05],
	['zsh', -0.05],
	['fish', -0.05],
	['csh', -0.06],
	['ksh', -0.06],
] : [
	['ps1', 0.05],
	['bat', -0.05],
	['cmd', -0.05],
	['exe', -0.05],
	['sh', 0.05],
	['bash', 0.05],
	['zsh', 0.05],
	['fish', 0.05],
	['csh', 0.04],
	['ksh', 0.04],
	['py', 0.05],
	['pl', 0.05],
]);

function fileExtScore(ext: string): number {
	return fileExtScores.get(ext) || 0;
}
