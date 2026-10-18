/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { OpenAIEndpoint } from './openAIEndpoint';

export class AzureOpenAIEndpoint extends OpenAIEndpoint {
	public override getExtraHeaders(): Record<string, string> {
		const headers = super.getExtraHeaders();
		headers['Authorization'] = `Bearer ${this._apiKey}`;
		delete headers['api-key'];
		return headers;
	}
}
