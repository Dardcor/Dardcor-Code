/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Completion } from '../common/completionsAPI';

export async function* jsonlStreamToCompletions(jsonlStream: AsyncIterable<string>): AsyncGenerator<Completion> {
	for await (const line of jsonlStream) {
		if (line.trim() === 'data: [DONE]') {
			continue;
		}

		if (line.startsWith('data: ')) {
			const message: Completion & { error?: { message: string } } = JSON.parse(line.substring('data: '.length));

			if (message.error) {
				throw new Error(message.error.message);
			}

			yield message;
		}
	}
}

