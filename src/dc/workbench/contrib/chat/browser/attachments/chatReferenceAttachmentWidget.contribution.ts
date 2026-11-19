/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { DEFAULT_LABELS_CONTAINER, ResourceLabels } from '../../../../browser/labels.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { isChatReferenceVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import { ChatReferenceAttachmentWidget } from './chatAttachmentWidgets.js';
import { IChatAttachmentWidgetRegistry } from './chatAttachmentWidgetRegistry.js';

export class ChatReferenceAttachmentWidgetContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatReferenceAttachmentWidgetFactory';

	constructor(
		@IChatAttachmentWidgetRegistry registry: IChatAttachmentWidgetRegistry,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const labels = this._register(instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));

		this._register(registry.registerFactory(
			'chatReference',
			(attachment, options, container) => {
				if (!isChatReferenceVariableEntry(attachment)) {
					throw new Error('Expected a chatReference attachment');
				}
				return instantiationService.createInstance(ChatReferenceAttachmentWidget, attachment, undefined, options, container, labels);
			},
		));
	}
}
