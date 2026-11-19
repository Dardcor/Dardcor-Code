/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IBrowserViewOwner } from './browserView.js';
import { CDPEvent, CDPRequest, CDPResponse } from './cdp/types.js';

export const ipcBrowserViewGroupChannelName = 'browserViewGroup';

export interface IBrowserViewGroupViewEvent {
	readonly viewId: string;

	readonly targetId?: string;
	readonly url?: string;
	readonly title?: string;
}

export interface IBrowserViewGroup extends IDisposable {
	readonly id: string;

	readonly onDidAddView: Event<IBrowserViewGroupViewEvent>;
	readonly onDidRemoveView: Event<IBrowserViewGroupViewEvent>;
	readonly onDidDestroy: Event<void>;
	readonly onCDPMessage: Event<CDPResponse | CDPEvent>;

	addView(viewId: string): Promise<void>;
	removeView(viewId: string): Promise<void>;
	sendCDPMessage(msg: CDPRequest): Promise<void>;
}

export interface IBrowserViewGroupService {

	onDynamicDidAddView(groupId: string): Event<IBrowserViewGroupViewEvent>;
	onDynamicDidRemoveView(groupId: string): Event<IBrowserViewGroupViewEvent>;
	onDynamicDidDestroy(groupId: string): Event<void>;
	onDynamicCDPMessage(groupId: string): Event<CDPResponse | CDPEvent>;

	createGroup(owner: IBrowserViewOwner): Promise<string>;

	destroyGroup(groupId: string): Promise<void>;

	addViewToGroup(groupId: string, viewId: string): Promise<void>;

	removeViewFromGroup(groupId: string, viewId: string): Promise<void>;

	sendCDPMessage(groupId: string, message: CDPRequest): Promise<void>;
}
