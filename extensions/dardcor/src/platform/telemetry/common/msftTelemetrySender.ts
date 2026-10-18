/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { CopilotToken } from '../../authentication/common/dardcorToken';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import { IMSFTTelemetrySender, ITelemetrySender, TelemetryEventMeasurements, TelemetryEventProperties } from './telemetry';

export interface ITelemetryReporter extends ITelemetrySender {
	sendRawTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
}

export class BaseMsftTelemetrySender implements IMSFTTelemetrySender {
	protected _internalTelemetryReporter: ITelemetryReporter | undefined;
	private _externalTelemetryReporter: ITelemetryReporter;

	protected readonly _disposables: DisposableStore = new DisposableStore();
	private _username: string | undefined;
	private _vscodeTeamMember: boolean = false;
	private _sku: string | undefined;
	private _tid: string | undefined;
	private _isInternal: boolean = false;

	constructor(
		dardcorTokenStore: ICopilotTokenStore,
		private readonly _createTelemetryReporter: (internal: boolean) => ITelemetryReporter
	) {
		this._externalTelemetryReporter = this._createTelemetryReporter(false);
		this.processToken(dardcorTokenStore.dardcorToken);
		this._disposables.add(dardcorTokenStore.onDidStoreUpdate(() => this.processToken(dardcorTokenStore.dardcorToken)));
	}

	sendInternalTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
		if (!this._internalTelemetryReporter || !this._isInternal) {
			return;
		}
		properties = { ...properties, 'common.tid': this._tid, 'common.userName': this._username ?? 'undefined' };
		measurements = { ...measurements, 'common.isVscodeTeamMember': this._vscodeTeamMember ? 1 : 0 };
		this._internalTelemetryReporter.sendRawTelemetryEvent(eventName, properties, measurements);
	}

	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
		properties = { ...properties, 'common.tid': this._tid ?? '', 'common.sku': this._sku ?? 'undefined' };
		if (this._isInternal) {
			measurements = { ...measurements, 'common.internal': 1 };
		}
		this._externalTelemetryReporter.sendTelemetryEvent(eventName, properties, measurements);
	}

	sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
		properties = { ...properties, 'common.tid': this._tid ?? '', 'common.sku': this._sku ?? 'undefined' };
		if (this._isInternal) {
			measurements = { ...measurements, 'common.internal': 1 };
		}
		this._externalTelemetryReporter.sendTelemetryErrorEvent(eventName, properties, measurements);
	}

	dispose(): void {
		this._externalTelemetryReporter.dispose();
		this._internalTelemetryReporter?.dispose();
	}

	private processToken(token: CopilotToken | undefined) {
		this._username = token?.username;
		this._vscodeTeamMember = !!token?.isVscodeTeamMember;
		const newTid = token?.getTokenValue('tid');
		if (newTid) {
			this._tid = newTid;
		}
		this._sku = token?.sku;
		this._isInternal = !!token?.isInternal;

		if (this._isInternal) {
			this._internalTelemetryReporter ??= this._createTelemetryReporter(true);
		}

		if (!token || !this._isInternal) {
			this._internalTelemetryReporter?.dispose();
			this._internalTelemetryReporter = undefined;
			return;
		}
	}
}
