/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const autoModelId = 'dardcor/auto';

export function resolveModelIdForTelemetry(modelId: string, resolvedModel: string | undefined): string {
	return modelId === autoModelId ? (resolvedModel || autoModelId) : modelId;
}
