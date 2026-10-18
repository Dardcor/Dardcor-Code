/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDimension } from '../../../base/browser/dom.js';
import { Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ILayoutService = createDecorator<ILayoutService>('layoutService');

export interface ILayoutOffsetInfo {

	readonly top: number;

	readonly quickPickTop: number;
}

export interface ILayoutService {

	readonly _serviceBrand: undefined;

	readonly onDidLayoutMainContainer: Event<IDimension>;

	readonly onDidLayoutContainer: Event<{ readonly container: HTMLElement; readonly dimension: IDimension }>;

	readonly onDidLayoutActiveContainer: Event<IDimension>;

	readonly onDidAddContainer: Event<{ readonly container: HTMLElement; readonly disposables: DisposableStore }>;

	readonly onDidChangeActiveContainer: Event<void>;

	readonly mainContainerDimension: IDimension;

	readonly activeContainerDimension: IDimension;

	readonly mainContainer: HTMLElement;

	readonly activeContainer: HTMLElement;

	readonly containers: Iterable<HTMLElement>;

	getContainer(window: Window): HTMLElement;

	whenContainerStylesLoaded(window: Window): Promise<void> | undefined;

	readonly mainContainerOffset: ILayoutOffsetInfo;

	readonly activeContainerOffset: ILayoutOffsetInfo;

	focus(): void;
}
