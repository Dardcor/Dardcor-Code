/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDelayedChannel, IChannel, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { arch, platform } from '../../../../base/common/process.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILocalTranscriptionService, localTranscriptionChannelName } from '../../../../platform/localTranscription/common/localTranscription.js';
import { IUtilityProcessWorkerWorkbenchService } from '../../utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';

const SUPPORTED_TARGETS = new Set<string>([
	'darwin-arm64',
	'linux-x64',
	'linux-arm64',
	'win32-x64',
	'win32-arm64',
]);

function isOnDeviceTranscriptionSupported(): boolean {
	return !!platform && !!arch && SUPPORTED_TARGETS.has(`${platform}-${arch}`);
}

export class LocalTranscriptionService {

	declare readonly _serviceBrand: undefined;

	readonly isSupported = isOnDeviceTranscriptionSupported();

	private _channel: IChannel | undefined;
	private _proxy: ILocalTranscriptionService | undefined;

	constructor(
		@IUtilityProcessWorkerWorkbenchService private readonly utilityProcessWorkerWorkbenchService: IUtilityProcessWorkerWorkbenchService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
	) { }

	private _getChannel(): IChannel {
		if (!this._channel) {
			this._channel = getDelayedChannel((async () => {
				const { client } = await this.utilityProcessWorkerWorkbenchService.createWorker({
					moduleId: 'dc/platform/localTranscription/node/localTranscriptionMain',
					type: 'localTranscription',
					name: 'local-transcription',
					allowLoadingUnsignedLibraries: true
				});
				return client.getChannel(localTranscriptionChannelName);
			})());
		}
		return this._channel;
	}

	private _getProxy(): ILocalTranscriptionService {
		if (!this._proxy) {
			this._proxy = ProxyChannel.toService<ILocalTranscriptionService>(this._getChannel(), { disableMarshalling: true });
		}
		return this._proxy;
	}

	get onDidChangeModelStatus() { return this._getProxy().onDidChangeModelStatus; }
	get onDidTranscribe() { return this._getProxy().onDidTranscribe; }

	getModelStatus() { return this._getProxy().getModelStatus(); }
	importModel(options: Parameters<ILocalTranscriptionService['importModel']>[0]) { return this._getProxy().importModel(options); }
	start(options: { cacheDir: string; model?: string; language?: string }) {
		const { proxyUrl, noProxy, proxyStrictSSL, proxyAuthorization } = this._resolveProxyConfig();
		const runtime = this.productService.dictationRuntime;
		return this._getProxy().start({
			cacheDir: options.cacheDir,
			model: options.model,
			language: options.language,
			proxyUrl,
			noProxy,
			proxyStrictSSL,
			proxyAuthorization,
			runtimeUrlTemplate: runtime?.urlTemplate,
			runtimeVersion: runtime?.version,
		});
	}
	pushAudio(chunk: Parameters<ILocalTranscriptionService['pushAudio']>[0]) { return this._getProxy().pushAudio(chunk); }
	stop() { return this._getProxy().stop(); }
	cancel() { return this._getProxy().cancel(); }

	private _resolveProxyConfig(): { proxyUrl: string | undefined; noProxy: string | undefined; proxyStrictSSL: boolean | undefined; proxyAuthorization: string | undefined } {
		const proxyUrl = this.configurationService.getValue<string>('http.proxy')?.trim() || undefined;
		const noProxyList = this.configurationService.getValue<string[]>('http.noProxy');
		const noProxy = Array.isArray(noProxyList) && noProxyList.length ? noProxyList.join(',') : undefined;
		const strictSSL = this.configurationService.getValue<boolean>('http.proxyStrictSSL');
		const proxyStrictSSL = strictSSL === false ? false : undefined;
		const proxyAuthorization = this.configurationService.getValue<string>('http.proxyAuthorization')?.trim() || undefined;
		return { proxyUrl, noProxy, proxyStrictSSL, proxyAuthorization };
	}
}

registerSingleton(ILocalTranscriptionService, LocalTranscriptionService, InstantiationType.Delayed);
