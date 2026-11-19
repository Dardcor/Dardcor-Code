/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { AGENT_SDK_SETUP_DOWNLOAD_REQUEST_KEY, AGENT_SDK_SETUP_RELOAD_REQUEST_KEY, AgentSdkDownloadStatus, IAgentSdkSetupInfo, agentSdkSetupStatusKey, isAgentSdkSetupRequestFor } from '../common/agentSdkSetup.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';
import { IAgentSdkDownloader, type IAgentSdkDownloadProgress, type IAgentSdkPackage } from './agentSdkDownloader.js';

export interface IAgentSdkSetupChannelAgent {
	readonly id: string;
	readonly sdkPackage: IAgentSdkPackage;

	readonly setupInfo: Omit<IAgentSdkSetupInfo, 'agent' | 'download'>;

	isSdkLocal(): Promise<boolean>;

	downloadSdk(): Promise<void>;

	restartChatDiscovery(): void;

	refreshModels(): Promise<void>;
}

export class AgentSdkSetupChannel extends Disposable {

	private readonly _lastRequests = new Map<string, string>();
	private readonly _operations = new Sequencer();

	private _downloadActivity: 'idle' | 'explicit' | 'lazy' = 'idle';
	private _downloadFailed = false;

	constructor(
		private readonly _agent: IAgentSdkSetupChannelAgent,
		private readonly _configurationService: IAgentConfigurationService,
		private readonly _downloader: IAgentSdkDownloader,
		private readonly _logService: ILogService,
	) {
		super();
		this._register(this._configurationService.onDidRootConfigChange(() => this._handleRequest()));
		this._register(this._downloader.onDidDownloadProgress(progress => this._handleDownloadProgress(progress)));
		this.refresh();
	}

	refresh(): void {
		this._queue('failed to refresh agent SDK setup', async () => this._publish(await this._agent.isSdkLocal()));
	}

	private _publish(sdkIsLocal: boolean): void {
		const download: AgentSdkDownloadStatus = this._downloadActivity !== 'idle'
			? 'downloading'
			: sdkIsLocal
				? 'ready'
				: this._hasDownloadConsent() && !this._downloadFailed ? 'downloadOnUse' : 'notDownloaded';
		const info: Omit<IAgentSdkSetupInfo, 'agent'> = { ...this._agent.setupInfo, download };
		this._configurationService.publishRootTransientValues?.({ [agentSdkSetupStatusKey(this._agent.id)]: info });
	}

	private _handleDownloadProgress(progress: IAgentSdkDownloadProgress): void {
		if (progress.packageId !== this._agent.sdkPackage.id) {
			return;
		}
		switch (progress.phase) {
			case 'started':
				if (this._downloadActivity === 'idle') {
					this._downloadActivity = 'lazy';
					this._downloadFailed = false;
					this._publish(false);
					this._queue('failed to record agent SDK download consent', () => this._recordDownloadConsent());
				}
				break;
			case 'completed':
				if (this._downloadActivity === 'lazy') {
					this._queue('refresh after agent SDK download failed', () => this._finishLazyDownload());
				}
				break;
			case 'failed':
				if (this._downloadActivity === 'lazy') {
					this._downloadActivity = 'idle';
					this._downloadFailed = true;
					this._publish(false);
				}
				break;
		}
	}

	private _handleRequest(): void {
		const values = this._configurationService.getRootConfigValues?.() ?? {};
		if (this._takeRequest(values, AGENT_SDK_SETUP_DOWNLOAD_REQUEST_KEY)) {
			if (this._downloadActivity === 'idle') {
				this._downloadActivity = 'explicit';
				this._downloadFailed = false;
				this._publish(false);
				this._queue('explicit agent SDK download failed', async () => {
					await this._recordDownloadConsent();
					await this._download();
				});
			}
		}
		if (this._takeRequest(values, AGENT_SDK_SETUP_RELOAD_REQUEST_KEY)) {
			this._queue('agent SDK configuration reload failed', async () => {
				this._logService.info(`[AgentSdkSetup] ${this._agent.id}: reloading the agent's configuration at the user's request`);
				await this._lookAgain();
			});
		}
	}

	private _queue(failureMessage: string, operation: () => Promise<void>): void {
		void this._operations.queue(operation).catch(error => {
			this._logService.error(error, `[AgentSdkSetup] ${this._agent.id}: ${failureMessage}`);
		});
	}

	private _takeRequest(values: Readonly<Record<string, unknown>>, key: string): boolean {
		const request = values[key];
		if (!isAgentSdkSetupRequestFor(request, this._agent.id) || request.request === this._lastRequests.get(key)) {
			return false;
		}
		this._lastRequests.set(key, request.request);
		this._configurationService.updateRootConfig({ [key]: undefined });
		return true;
	}

	private _hasDownloadConsent(): boolean {
		return this._downloader.hasDownloadConsent(this._agent.sdkPackage);
	}

	private async _recordDownloadConsent(): Promise<void> {
		try {
			await this._downloader.recordDownloadConsent(this._agent.sdkPackage);
		} catch (error) {
			this._logService.error(error, `[AgentSdkSetup] ${this._agent.id}: failed to persist agent SDK download consent`);
		}
	}

	private async _download(): Promise<void> {
		if (this._downloadActivity !== 'explicit') {
			return;
		}
		const progressInterest = this._downloader.acquireDownloadProgressInterest(this._agent.sdkPackage);
		let downloaded = false;
		try {
			this._logService.info(`[AgentSdkSetup] ${this._agent.id}: downloading the agent SDK at the user's request`);
			try {
				await this._agent.downloadSdk();
				downloaded = true;
			} catch (error) {
				this._downloadFailed = true;
				this._logService.error(error, `[AgentSdkSetup] ${this._agent.id}: agent SDK download failed`);
			}
			if (downloaded) {
				await this._lookAgain();
			}
		} finally {
			this._downloadActivity = 'idle';
			progressInterest.dispose();
			this._publish(downloaded);
		}
	}

	private async _finishLazyDownload(): Promise<void> {
		try {
			await this._lookAgain();
		} finally {
			this._downloadActivity = 'idle';
			this._publish(true);
		}
	}

	private async _lookAgain(): Promise<void> {
		this._agent.restartChatDiscovery();
		await this._agent.refreshModels();
	}
}
