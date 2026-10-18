/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { OptionalChatRequestParams } from '../../networking/common/fetch';
import { Source } from './chatMLFetcher';
import { ChatLocation } from './commonTypes';

export interface IRichChatRequestOptions {
	debugName: string;
	messages: Raw.ChatMessage[];
	location: ChatLocation;
	source?: Source;
	requestOptions?: Omit<OptionalChatRequestParams, 'n'>;
	userInitiatedRequest?: boolean;
}
