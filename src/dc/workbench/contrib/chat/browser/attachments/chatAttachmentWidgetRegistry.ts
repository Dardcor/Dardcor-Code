/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as event from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatRequestVariableEntry } from '../../common/attachments/chatVariableEntries.js';

export interface IChatAttachmentWidgetInstance extends IDisposable {
	readonly element: HTMLElement;
	readonly onDidDelete: event.Event<Event>;
	readonly onDidOpen: event.Event<void>;
	readonly label?: { readonly element: HTMLElement };
}

export type ChatAttachmentWidgetFactory = (
	attachment: IChatRequestVariableEntry,
	options: { shouldFocusClearButton: boolean; supportsDeletion: boolean },
	container: HTMLElement,
) => IChatAttachmentWidgetInstance;

export const IChatAttachmentWidgetRegistry = createDecorator<IChatAttachmentWidgetRegistry>('chatAttachmentWidgetRegistry');

export interface IChatAttachmentWidgetRegistry {
	readonly _serviceBrand: undefined;

	registerFactory(kind: string, factory: ChatAttachmentWidgetFactory): IDisposable;

	createWidget(
		attachment: IChatRequestVariableEntry,
		options: { shouldFocusClearButton: boolean; supportsDeletion: boolean },
		container: HTMLElement,
	): IChatAttachmentWidgetInstance | undefined;
}

export class ChatAttachmentWidgetRegistry implements IChatAttachmentWidgetRegistry {

	declare readonly _serviceBrand: undefined;

	private readonly _factories = new Map<string, ChatAttachmentWidgetFactory>();

	registerFactory(kind: string, factory: ChatAttachmentWidgetFactory): IDisposable {
		this._factories.set(kind, factory);
		return {
			dispose: () => {
				if (this._factories.get(kind) === factory) {
					this._factories.delete(kind);
				}
			}
		};
	}

	createWidget(
		attachment: IChatRequestVariableEntry,
		options: { shouldFocusClearButton: boolean; supportsDeletion: boolean },
		container: HTMLElement,
	): IChatAttachmentWidgetInstance | undefined {
		const factory = this._factories.get(attachment.kind);
		if (!factory) {
			return undefined;
		}
		return factory(attachment, options, container);
	}
}
