/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hasKey } from '../../../base/common/types.js';
import { type IDialogService } from '../../dialogs/common/dialogs.js';
import { type IRemoteAgentHostLocationPreferenceService } from './remoteAgentHostLocationPreference.js';
import { promptRemoteAgentHostLocationPreference } from './remoteAgentHostLocationPreferenceDialog.js';
import { type ITunnelGatewayEndpoint, type ITunnelGatewayInventory, type ITunnelGatewaySelection, type TunnelGatewayServerType } from './tunnelAgentHost.js';

function sortedGatewayEndpoints(inventory: ITunnelGatewayInventory, type: TunnelGatewayServerType): ITunnelGatewayEndpoint[] {
	return inventory.endpoints
		.filter(endpoint => endpoint.type === type)
		.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

export function selectEditorGatewayEndpoint(inventory: ITunnelGatewayInventory): ITunnelGatewayEndpoint | undefined {
	return sortedGatewayEndpoints(inventory, 'editor')[0];
}

export function selectDedicatedGatewayFallback(inventory: ITunnelGatewayInventory): ITunnelGatewaySelection {
	const standalone = sortedGatewayEndpoints(inventory, 'standalone')[0];
	return standalone ? { instanceId: standalone.instanceId } : { newDedicated: true };
}

export function selectGatewayFallbackAfterRejection(rejected: ITunnelGatewaySelection, inventory: ITunnelGatewayInventory): ITunnelGatewaySelection | undefined {
	if (inventory.delegatedInstanceId) {
		return { instanceId: inventory.delegatedInstanceId };
	}
	if (!hasKey(rejected, { instanceId: true })) {
		return undefined;
	}
	const standalone = sortedGatewayEndpoints(inventory, 'standalone').find(endpoint => endpoint.instanceId !== rejected.instanceId);
	return standalone ? { instanceId: standalone.instanceId } : { newDedicated: true };
}

export interface IGatewaySelectionRequest {
	readonly hostKey: string;
	readonly hostLabel: string;
	readonly productName: string;
	readonly inventory: ITunnelGatewayInventory;
	readonly userInitiated: boolean;
}

export async function resolveGatewaySelection(
	locationPreferenceService: IRemoteAgentHostLocationPreferenceService,
	dialogService: IDialogService,
	request: IGatewaySelectionRequest,
): Promise<ITunnelGatewaySelection | undefined> {
	const { hostKey, hostLabel, productName, inventory, userInitiated } = request;
	const preference = locationPreferenceService.getPreference(hostKey);
	if (inventory.delegatedInstanceId) {
		if (!preference && userInitiated) {
			locationPreferenceService.setPreference(hostKey, 'editor');
		}
		return { instanceId: inventory.delegatedInstanceId };
	}
	const editor = selectEditorGatewayEndpoint(inventory);

	if (preference === 'editor') {
		return editor ? { instanceId: editor.instanceId } : selectDedicatedGatewayFallback(inventory);
	}
	if (preference === 'dedicated') {
		return selectDedicatedGatewayFallback(inventory);
	}
	if (!editor) {
		if (userInitiated) {
			locationPreferenceService.setPreference(hostKey, 'dedicated');
		}
		return selectDedicatedGatewayFallback(inventory);
	}
	if (!userInitiated) {
		return undefined;
	}

	const chosen = await promptRemoteAgentHostLocationPreference(dialogService, hostLabel, productName);
	if (!chosen) {
		return undefined;
	}
	locationPreferenceService.setPreference(hostKey, chosen);
	return chosen === 'editor' ? { instanceId: editor.instanceId } : selectDedicatedGatewayFallback(inventory);
}

export function shouldNotifyTunnelFailover(
	previousServerType: TunnelGatewayServerType | 'unknown' | undefined,
	newServerType: TunnelGatewayServerType | 'unknown',
	userInitiated: boolean,
	editorFallback = false,
): boolean {
	if (editorFallback) {
		return newServerType === 'standalone' && previousServerType !== 'standalone';
	}
	return !userInitiated && previousServerType === 'editor' && newServerType === 'standalone';
}

export class TunnelFailoverTracker {
	private readonly _lastSelectedServerType = new Map<string, TunnelGatewayServerType | 'unknown'>();

	recordAndShouldNotify(address: string, newServerType: TunnelGatewayServerType | 'unknown', userInitiated: boolean, editorFallback = false): boolean {
		const previousServerType = this._lastSelectedServerType.get(address);
		const notify = shouldNotifyTunnelFailover(previousServerType, newServerType, userInitiated, editorFallback);
		this._lastSelectedServerType.set(address, newServerType);
		return notify;
	}
}
