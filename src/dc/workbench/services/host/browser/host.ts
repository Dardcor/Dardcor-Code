/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { FocusMode } from '../../../../platform/native/common/native.js';
import { IWindowOpenable, IOpenWindowOptions, IOpenEmptyWindowOptions, IPoint, IRectangle, IOpenedMainWindow, IOpenedAuxiliaryWindow } from '../../../../platform/window/common/window.js';

export const IHostService = createDecorator<IHostService>('hostService');

export interface IToastOptions {
	readonly title: string;
	readonly body?: string;

	readonly actions?: readonly string[];

	readonly silent?: boolean;

	readonly dedupeKey?: string;
}

export interface IToastResult {
	readonly supported: boolean;

	readonly clicked: boolean;
	readonly actionIndex?: number;
}

export interface IHostService {

	readonly _serviceBrand: undefined;


	readonly onDidChangeFocus: Event<boolean>;

	readonly hasFocus: boolean;

	hadLastFocus(): Promise<boolean>;

	focus(targetWindow: Window, options?: { mode?: FocusMode }): Promise<void>;



	readonly onDidChangeActiveWindow: Event<number>;

	readonly onDidChangeFullScreen: Event<{ windowId: number; fullscreen: boolean }>;

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;

	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;

	toggleFullScreen(targetWindow: Window): Promise<void>;

	moveTop(targetWindow: Window): Promise<void>;

	setWindowDimmed(targetWindow: Window, dimmed: boolean): Promise<void>;

	getCursorScreenPoint(): Promise<{ readonly point: IPoint; readonly display: IRectangle } | undefined>;

	getWindows(options: { includeAuxiliaryWindows: true }): Promise<Array<IOpenedMainWindow | IOpenedAuxiliaryWindow>>;
	getWindows(options: { includeAuxiliaryWindows: false }): Promise<Array<IOpenedMainWindow>>;



	restart(): Promise<void>;

	reload(options?: { disableExtensions?: boolean }): Promise<void>;

	close(): Promise<void>;

	shutdown(): Promise<void>;

	withExpectedShutdown<T>(expectedShutdownTask: () => Promise<T>): Promise<T>;



	getScreenshot(rect?: IRectangle): Promise<VSBuffer | undefined>;



	getNativeWindowHandle(windowId: number): Promise<VSBuffer | undefined>;



	showToast(options: IToastOptions, token: CancellationToken): Promise<IToastResult>;

}
