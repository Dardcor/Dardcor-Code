/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IMeteredConnectionService = createDecorator<IMeteredConnectionService>('meteredConnectionService');

export interface IMeteredConnectionService {
	readonly _serviceBrand: undefined;

	readonly isConnectionMetered: boolean;

	readonly onDidChangeIsConnectionMetered: Event<boolean>;
}

export const METERED_CONNECTION_SETTING_KEY = 'network.meteredConnection';

export type MeteredConnectionSettingValue = 'on' | 'off' | 'auto';

export interface NetworkInformation {
	saveData?: boolean;
	metered?: boolean;
	effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

export interface NavigatorWithConnection {
	readonly connection?: NetworkInformation;
}

export function getIsBrowserConnectionMetered() {
	const connection = (navigator as NavigatorWithConnection).connection;
	if (!connection) {
		return false;
	}

	if (connection.saveData || connection.metered) {
		return true;
	}

	const effectiveType = connection.effectiveType;
	return effectiveType === '2g' || effectiveType === 'slow-2g';
}

export abstract class AbstractMeteredConnectionService extends Disposable implements IMeteredConnectionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeIsConnectionMetered = this._register(new Emitter<boolean>());
	public readonly onDidChangeIsConnectionMetered = this._onDidChangeIsConnectionMetered.event;

	private _isConnectionMetered: boolean;
	private _isBrowserConnectionMetered: boolean;
	private _meteredConnectionSetting: MeteredConnectionSettingValue;

	constructor(configurationService: IConfigurationService, isBrowserConnectionMetered: boolean) {
		super();

		this._isBrowserConnectionMetered = isBrowserConnectionMetered;
		this._meteredConnectionSetting = configurationService.getValue<MeteredConnectionSettingValue>(METERED_CONNECTION_SETTING_KEY);
		this._isConnectionMetered = this._meteredConnectionSetting === 'on' || (this._meteredConnectionSetting !== 'off' && this._isBrowserConnectionMetered);

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(METERED_CONNECTION_SETTING_KEY)) {
				const value = configurationService.getValue<MeteredConnectionSettingValue>(METERED_CONNECTION_SETTING_KEY);
				if (value !== this._meteredConnectionSetting) {
					this._meteredConnectionSetting = value;
					this.onUpdated();
				}
			}
		}));
	}

	public get isConnectionMetered(): boolean {
		return this._isConnectionMetered;
	}

	protected get isBrowserConnectionMetered(): boolean {
		return this._isBrowserConnectionMetered;
	}

	public setIsBrowserConnectionMetered(value: boolean) {
		if (value !== this._isBrowserConnectionMetered) {
			this._isBrowserConnectionMetered = value;
			this.onChangeBrowserConnection();
		}
	}

	protected onChangeBrowserConnection() {
		this.onUpdated();
	}

	protected onUpdated() {
		const value = this._meteredConnectionSetting === 'on' || (this._meteredConnectionSetting !== 'off' && this._isBrowserConnectionMetered);
		if (value !== this._isConnectionMetered) {
			this._isConnectionMetered = value;
			this.onChangeIsConnectionMetered();
		}
	}

	protected onChangeIsConnectionMetered() {
		this._onDidChangeIsConnectionMetered.fire(this._isConnectionMetered);
	}
}
