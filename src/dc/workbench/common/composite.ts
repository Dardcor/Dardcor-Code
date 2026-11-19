/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';

export interface IComposite {

	readonly onDidFocus: Event<void>;

	readonly onDidBlur: Event<void>;

	hasFocus(): boolean;

	getId(): string;

	getTitle(): string | undefined;

	getControl(): ICompositeControl | undefined;

	focus(): void;
}

export interface ICompositeControl { }
