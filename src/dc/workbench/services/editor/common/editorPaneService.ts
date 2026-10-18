/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWillInstantiateEditorPaneEvent } from '../../../common/editor.js';
import { Event } from '../../../../base/common/event.js';

export const IEditorPaneService = createDecorator<IEditorPaneService>('editorPaneService');

export interface IEditorPaneService {

	readonly _serviceBrand: undefined;

	readonly onWillInstantiateEditorPane: Event<IWillInstantiateEditorPaneEvent>;

	didInstantiateEditorPane(typeId: string): boolean;
}
