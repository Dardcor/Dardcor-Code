/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import OpenAI from 'openai';
import * as path from 'path';
import { ILogService } from '../../log/common/logService';

const ENABLE_RESPONSES_STREAM_DUMP = false
	;

export interface IResponsesStreamDumper {
	logEvent(responseStreamEvent: OpenAI.Responses.ResponseStreamEvent): void;
}

const noopDumper: IResponsesStreamDumper = {
	logEvent() { }
};

class ResponsesStreamDumper implements IResponsesStreamDumper {
	constructor(private readonly filePath: string) { }

	logEvent(responseStreamEvent: OpenAI.Responses.ResponseStreamEvent): void {
		const timestamp = new Date();
		try {
			const prettyData = JSON.stringify({ ...responseStreamEvent, type: undefined }, null, 2);
			fs.appendFileSync(this.filePath, `${timestamp.toISOString()} ${responseStreamEvent.type}\n${prettyData}\n\n`);
		} catch {
		}
	}
}

export function createResponsesStreamDumper(requestId: string, logService: ILogService): IResponsesStreamDumper {
	if (!ENABLE_RESPONSES_STREAM_DUMP) {
		return noopDumper;
	}

	try {
		const repoRoot = path.resolve(__dirname, '..', '..', '..');
		const dumpDir = path.join(repoRoot, '.responses-stream-dumps');
		fs.mkdirSync(dumpDir, { recursive: true });
		const ts = new Date().toISOString().replace(/[:.]/g, '-');
		const filePath = path.join(dumpDir, `responses-stream-${ts}-${requestId.slice(0, 4)}.log`);
		fs.writeFileSync(filePath, `# Responses API SSE stream dump\n# requestId=${requestId}\n# started=${new Date().toISOString()}\n\n`);
		logService.info(`[responsesAPI] Dumping SSE stream to ${filePath}`);
		return new ResponsesStreamDumper(filePath);
	} catch {
		return noopDumper;
	}
}
