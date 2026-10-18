/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const INotebookRendererMessagingService = createDecorator<INotebookRendererMessagingService>('INotebookRendererMessagingService');

export interface INotebookRendererMessagingService {
	readonly _serviceBrand: undefined;

	readonly onShouldPostMessage: Event<{ editorId: string; rendererId: string; message: unknown }>;

	prepare(rendererId: string): void;
	getScoped(editorId: string): IScopedRendererMessaging;

	receiveMessage(editorId: string | undefined, rendererId: string, message: unknown): Promise<boolean>;
}

export interface IScopedRendererMessaging extends IDisposable {
	receiveMessageHandler?: (rendererId: string, message: unknown) => Promise<boolean>;

	postMessage(rendererId: string, message: unknown): void;
}
