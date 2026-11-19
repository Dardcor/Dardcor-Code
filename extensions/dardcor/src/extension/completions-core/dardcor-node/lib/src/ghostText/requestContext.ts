/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BlockMode } from '../config';
import { CompletionHeaders } from '../openai/fetch';
import { ContextIndentation } from '../prompt/parseBlock';
import { Prompt } from '../prompt/prompt';
import { MaybeRepoInfo } from '../prompt/repository';

export interface RequestContext {
	blockMode: BlockMode;
	languageId: string;
	repoInfo: MaybeRepoInfo;
	engineModelId: string;
	ourRequestId: string;
	prefix: string;
	prompt: Prompt;
	multiline: boolean;
	indentation: ContextIndentation;
	isCycling: boolean;
	headers: CompletionHeaders;
	stop?: string[];
	maxTokens?: number;
	afterAccept: boolean;
}

