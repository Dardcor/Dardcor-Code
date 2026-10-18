/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IStateService } from '../../state/node/state.js';
import { hasNativeTitlebar, TitlebarStyle } from '../../window/common/window.js';
import { IBaseWindow, WindowMode } from '../../window/electron-main/window.js';
import { BaseWindow } from '../../windows/electron-main/windowImpl.js';

export interface IAuxiliaryWindow extends IBaseWindow {
	readonly parentId: number;
}

export class AuxiliaryWindow extends BaseWindow implements IAuxiliaryWindow {

	readonly id: number;
	parentId = -1;

	override get win() {
		if (!super.win) {
			this.tryClaimWindow();
		}

		return super.win;
	}

	private stateApplied = false;

	constructor(
		private readonly webContents: WebContents,
		private readonly windowOptions: BrowserWindowConstructorOptions | undefined,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@ILogService logService: ILogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStateService stateService: IStateService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService
	) {
		super(configurationService, stateService, environmentMainService, logService);

		this.id = this.webContents.id;

		this.tryClaimWindow();
	}

	tryClaimWindow(options?: BrowserWindowConstructorOptions): void {
		if (this._store.isDisposed || this.webContents.isDestroyed()) {
			return;
		}

		const effectiveOptions = options ?? this.windowOptions;

		this.doTryClaimWindow(effectiveOptions);

		if (effectiveOptions && !this.stateApplied) {
			this.stateApplied = true;

			this.applyState({
				x: effectiveOptions.x,
				y: effectiveOptions.y,
				width: effectiveOptions.width,
				height: effectiveOptions.height,
				mode: effectiveOptions.show === false ? WindowMode.Maximized : WindowMode.Normal
			});
		}
	}

	private doTryClaimWindow(options?: BrowserWindowConstructorOptions): void {
		if (this._win) {
			return;
		}

		const window = BrowserWindow.fromWebContents(this.webContents);
		if (window) {
			this.logService.trace('[aux window] Claimed browser window instance');

			this.setWin(window, options);

			window.setMenu(null);
			if ((isWindows || isLinux) && hasNativeTitlebar(this.configurationService, options?.titleBarStyle === 'hidden' ? TitlebarStyle.CUSTOM : undefined )) {
				window.setAutoHideMenuBar(true);
			}

			this.lifecycleMainService.registerAuxWindow(this);

			if (options?.frame === false) {
				window.setMinimumSize(1, 1);

				if (isMacintosh) {
					window.setWindowButtonVisibility(false);
				}
			}

			if (options?.resizable === false) {
				window.setResizable(false);
			}
		}
	}

	matches(webContents: WebContents): boolean {
		return this.webContents.id === webContents.id;
	}
}
