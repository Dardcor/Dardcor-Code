/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function normalizeResponseModel(requestModel: string | undefined, responseModel: string | undefined): string | undefined {
	if (!responseModel) {
		return undefined;
	}
	if (!requestModel) {
		return responseModel;
	}
	const canonical = (s: string) => s.replace(/\./g, '-').toLowerCase();
	const cReq = canonical(requestModel);
	const cRes = canonical(responseModel);
	if (cReq === cRes) {
		return requestModel;
	}
	if (cReq.startsWith(cRes + '-')) {
		return requestModel;
	}
	return responseModel;
}
