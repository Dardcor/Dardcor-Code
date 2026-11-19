/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { APIChoice } from '../openai/openai';
import { Prompt } from '../prompt/prompt';
import { ICompletionsCacheService } from './completionsCache';

interface CacheContext {
	prefix: string;
	prompt: Prompt;
	requestForNextLine?: boolean;
}

export function appendToCache(completionsCacheService: ICompletionsCacheService, requestContext: CacheContext, choice: APIChoice) {
	completionsCacheService.append(requestContext.prefix, requestContext.prompt.suffix, choice);
}
