/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { DocumentSemanticTokensProvider, ProviderResult, SemanticTokens, SemanticTokensLegend } from '../../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { getPromptsTypeForLanguageId } from '../promptTypes.js';
import { IPromptsService } from '../service/promptsService.js';
import { getTarget, isVSCodeOrDefaultTarget } from './promptFileAttributes.js';

export class PromptDocumentSemanticTokensProvider implements DocumentSemanticTokensProvider {
	public readonly _debugDisplayName: string = 'PromptDocumentSemanticTokensProvider';

	constructor(
		@IPromptsService private readonly promptsService: IPromptsService,
	) {
	}

	provideDocumentSemanticTokens(model: ITextModel, lastResultId: string | null, token: CancellationToken): ProviderResult<SemanticTokens> {
		const promptType = getPromptsTypeForLanguageId(model.getLanguageId());
		if (!promptType) {
			return undefined;
		}

		const promptAST = this.promptsService.getParsedPromptFile(model);
		if (!promptAST.body) {
			return undefined;
		}
		const target = getTarget(promptType, promptAST.header ?? model.uri);
		if (!isVSCodeOrDefaultTarget(target)) {
			return undefined;
		}

		const variableReferences = promptAST.body.variableReferences;
		if (!variableReferences.length) {
			return undefined;
		}

		const data: number[] = [];
		let lastLine = 0;
		let lastChar = 0;

		const ordered = [...variableReferences].sort((a, b) => a.range.startLineNumber === b.range.startLineNumber
			? a.range.startColumn - b.range.startColumn
			: a.range.startLineNumber - b.range.startLineNumber);

		for (const ref of ordered) {
			const extraCharCount = '#tool:'.length;
			const line = ref.range.startLineNumber - 1;
			const char = ref.range.startColumn - extraCharCount - 1;
			const length = ref.range.endColumn - ref.range.startColumn + extraCharCount;
			const deltaLine = line - lastLine;
			const deltaChar = deltaLine === 0 ? char - lastChar : char;
			data.push(deltaLine, deltaChar, length, 0 , 0 );
			lastLine = line;
			lastChar = char;
			if (token.isCancellationRequested) {
				break;
			}
		}

		return { data: new Uint32Array(data) };
	}

	getLegend(): SemanticTokensLegend {
		return { tokenTypes: ['variable'], tokenModifiers: [] };
	}

	releaseDocumentSemanticTokens(resultId: string | undefined): void {
	}
}
