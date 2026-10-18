/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const BrowserChatToolReferenceName = {
	OpenBrowserPage: 'openBrowserPage',
	ReadPage: 'readPage',
	ScreenshotPage: 'screenshotPage',
	NavigatePage: 'navigatePage',
	ClickElement: 'clickElement',
	TypeInPage: 'typeInPage',
	HoverElement: 'hoverElement',
	DragElement: 'dragElement',
	HandleDialog: 'handleDialog',
	RunPlaywrightCode: 'runPlaywrightCode',
} as const;

export const browserChatToolReferenceNames = Object.values(BrowserChatToolReferenceName);
