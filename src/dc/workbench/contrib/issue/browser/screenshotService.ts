/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IRectangle } from '../../../../platform/window/common/window.js';

export const IScreenshotService = createDecorator<IScreenshotService>('screenshotService');

export interface IScreenshotService {
	readonly _serviceBrand: undefined;

	captureScreenshot(rect?: IRectangle): Promise<string | undefined>;
}

export class BrowserScreenshotService implements IScreenshotService {
	readonly _serviceBrand: undefined;

	async captureScreenshot(_rect?: IRectangle): Promise<string | undefined> {
		return undefined;
	}
}
