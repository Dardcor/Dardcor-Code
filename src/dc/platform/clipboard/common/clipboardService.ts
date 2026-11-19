/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IClipboardService = createDecorator<IClipboardService>('clipboardService');

export interface IClipboardService {

	readonly _serviceBrand: undefined;

	triggerPaste(targetWindowId: number): Promise<void> | undefined;

	writeText(text: string, type?: string): Promise<void>;

	readText(type?: string): Promise<string>;

	readFindText(): Promise<string>;

	writeFindText(text: string): Promise<void>;

	writeResources(resources: URI[]): Promise<void>;

	readResources(): Promise<URI[]>;

	hasResources(): Promise<boolean>;

	clearInternalState?(): void;

	readImage(): Promise<Uint8Array>;
}
