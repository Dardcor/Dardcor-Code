/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { PaneCompositeDescriptor } from '../../../browser/panecomposite.js';
import { IProgressIndicator } from '../../../../platform/progress/common/progress.js';
import { IPaneComposite } from '../../../common/panecomposite.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { SINGLE_WINDOW_PARTS } from '../../layout/browser/layoutService.js';

export const IPaneCompositePartService = createDecorator<IPaneCompositePartService>('paneCompositePartService');

export interface IPaneCompositePartService {

	readonly _serviceBrand: undefined;

	readonly onDidPaneCompositeOpen: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;
	readonly onDidPaneCompositeClose: Event<{ composite: IPaneComposite; viewContainerLocation: ViewContainerLocation }>;

	getRegistryId(viewContainerLocation: ViewContainerLocation): string;

	getPartId(viewContainerLocation: ViewContainerLocation): SINGLE_WINDOW_PARTS;

	openPaneComposite(id: string | undefined, viewContainerLocation: ViewContainerLocation, focus?: boolean): Promise<IPaneComposite | undefined>;

	getActivePaneComposite(viewContainerLocation: ViewContainerLocation): IPaneComposite | undefined;

	getPaneComposite(id: string, viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor | undefined;

	getPaneComposites(viewContainerLocation: ViewContainerLocation): PaneCompositeDescriptor[];

	getPinnedPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	getVisiblePaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	getPaneCompositeIds(viewContainerLocation: ViewContainerLocation): string[];

	getProgressIndicator(id: string, viewContainerLocation: ViewContainerLocation): IProgressIndicator | undefined;

	hideActivePaneComposite(viewContainerLocation: ViewContainerLocation): void;

	getLastActivePaneCompositeId(viewContainerLocation: ViewContainerLocation): string;
}
