/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuxiliaryTitlebarPart, ITitlebarPart } from '../../../browser/parts/titlebar/titlebarPart.js';
import { WindowTitle } from '../../../browser/parts/titlebar/windowTitle.js';
import { IEditorGroupsContainer } from '../../editor/common/editorGroupsService.js';

export const ITitleService = createDecorator<ITitleService>('titleService');

export interface ITitleService extends ITitlebarPart {

	readonly _serviceBrand: undefined;

	readonly windowTitle: WindowTitle;

	getPart(container: HTMLElement): ITitlebarPart;

	createAuxiliaryTitlebarPart(container: HTMLElement, editorGroupsContainer: IEditorGroupsContainer, instantiationService: IInstantiationService): IAuxiliaryTitlebarPart;
}
