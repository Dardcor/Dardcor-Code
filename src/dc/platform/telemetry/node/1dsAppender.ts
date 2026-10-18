/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPayloadData, IXHROverride } from '@microsoft/1ds-post-js';
import { streamToBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IRequestOptions } from '../../../base/parts/request/common/request.js';
import { IRequestService, NO_FETCH_TELEMETRY } from '../../request/common/request.js';
import { AbstractOneDataSystemAppender, IAppInsightsCore } from '../common/1dsAppender.js';

type OnCompleteFunc = (status: number, headers: { [headerName: string]: string }, response?: string) => void;

interface IResponseData {
	headers: { [headerName: string]: string };
	statusCode: number;
	responseData: string;
}

async function makeTelemetryRequest(options: IRequestOptions, requestService: IRequestService): Promise<IResponseData> {
	const response = await requestService.request(options, CancellationToken.None);
	const responseData = (await streamToBuffer(response.stream)).toString();
	const statusCode = response.res.statusCode ?? 200;
	const headers = response.res.headers as Record<string, string>;
	return {
		headers,
		statusCode,
		responseData
	};
}

async function makeLegacyTelemetryRequest(options: IRequestOptions): Promise<IResponseData> {
	const https = await import('https');
	const httpsOptions = {
		method: options.type,
		headers: options.headers
	};
	const responsePromise = new Promise<IResponseData>((resolve, reject) => {
		const req = https.request(options.url ?? '', httpsOptions, res => {
			res.on('data', function (responseData) {
				resolve({
					headers: res.headers as Record<string, string>,
					statusCode: res.statusCode ?? 200,
					responseData: responseData.toString()
				});
			});
			res.on('error', function (err) {
				reject(err);
			});
		});
		req.write(options.data, (err) => {
			if (err) {
				reject(err);
			}
		});
		req.end();
	});
	return responsePromise;
}

async function sendPostAsync(requestService: IRequestService | undefined, payload: IPayloadData, oncomplete: OnCompleteFunc) {
	const telemetryRequestData = typeof payload.data === 'string' ? payload.data : new TextDecoder().decode(payload.data);
	const requestOptions: IRequestOptions = {
		type: 'POST',
		headers: {
			...payload.headers,
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(payload.data).toString()
		},
		url: payload.urlString,
		data: telemetryRequestData,
		callSite: NO_FETCH_TELEMETRY
	};

	try {
		const responseData = requestService ? await makeTelemetryRequest(requestOptions, requestService) : await makeLegacyTelemetryRequest(requestOptions);
		oncomplete(responseData.statusCode, responseData.headers, responseData.responseData);
	} catch {
		oncomplete(0, {});
	}
}


export class OneDataSystemAppender extends AbstractOneDataSystemAppender {

	constructor(
		requestService: IRequestService | undefined,
		isInternalTelemetry: boolean,
		eventPrefix: string,
		defaultData: { [key: string]: unknown } | null,
		iKeyOrClientFactory: string | (() => IAppInsightsCore),
	) {
		const customHttpXHROverride: IXHROverride = {
			sendPOST: (payload: IPayloadData, oncomplete: OnCompleteFunc) => {
				sendPostAsync(requestService, payload, oncomplete);
			}
		};

		super(isInternalTelemetry, eventPrefix, defaultData, iKeyOrClientFactory, customHttpXHROverride);
	}
}
