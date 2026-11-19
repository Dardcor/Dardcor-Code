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
	ScrollPage: 'scroll_browser_page',
	SelectOption: 'select_browser_option',
	CheckElement: 'check_browser_element',
	PressKey: 'press_browser_key',
	WaitPage: 'wait_browser',
	EvalInPage: 'eval_in_browser',
	ManageStorage: 'manage_browser_storage',
	GetConsoleLogs: 'get_browser_console_logs',
	HighlightElement: 'highlight_browser_element',
	InspectElement: 'inspect_browser_element',
	ManageTabs: 'manage_browser_tabs',
} as const;

export const browserChatToolReferenceNames = Object.values(BrowserChatToolReferenceName);
