/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isDeepStrictEqual } from 'util';
import { ErrorUtils } from '../../../util/common/errors';
import { CancellationToken, CancellationTokenSource } from '../../../util/dardcor/base/common/cancellation';
import { Emitter } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { autorun, observableFromEvent } from '../../../util/dardcor/base/common/observable';
import { CopilotToken } from '../../authentication/common/dardcorToken';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { getEditorVersionHeaders, IEnvService } from '../../env/common/envService';
import { WireTypes } from '../../inlineEdits/common/dataTypes/inlineEditsModelsTypes';
import { ILogService } from '../../log/common/logService';
import { IFetcherService, Response } from '../../networking/common/fetcherService';
import { IProxyModelsService } from '../common/proxyModelsService';

export class ProxyModelsService extends Disposable implements IProxyModelsService {
	readonly _serviceBrand: undefined;

	private readonly _onModelListUpdated = this._register(new Emitter<void>());
	public readonly onModelListUpdated = this._onModelListUpdated.event;

	private _models: WireTypes.ModelList.t | undefined;

	constructor(
		@ICopilotTokenStore private readonly _tokenStore: ICopilotTokenStore,
		@ICAPIClientService private readonly _capiClient: ICAPIClientService,
		@IFetcherService private readonly _fetchService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IEnvService private readonly _envService: IEnvService,
	) {
		super();

		const dardcorTokenObs = observableFromEvent(this, this._tokenStore.onDidStoreUpdate, () => this._tokenStore.dardcorToken);

		this._register(autorun(reader => {
			const dardcorToken = dardcorTokenObs.read(reader);
			const cts = new CancellationTokenSource();
			this._fetchLatestModels(dardcorToken, cts.token).then(models => {
				if (models === undefined) {
					return;
				}
				if (cts.token.isCancellationRequested) {
					return;
				}
				if (isDeepStrictEqual(this._models, models)) {
					return;
				}
				this._models = models;
				this._onModelListUpdated.fire();
			}).catch((e: unknown) => {
				const err = ErrorUtils.fromUnknown(e);
				this._logService.error(err, 'Failed to fetch models in autorun');
			});
			reader.store.add({ dispose: () => cts.dispose(true) });
		}));
	}

	get models(): WireTypes.ModelList.t | undefined {
		return this._models;
	}

	get nesModels(): WireTypes.Model.t[] | undefined {
		return this._models?.models.filter(model => model.serviceType === 'NESChat');
	}

	get cursorJumpModels(): WireTypes.Model.t[] | undefined {
		return this._models?.models.filter(model => model.serviceType === 'CursorJumpChat');
	}

	get instantApplyModels(): WireTypes.Model.t[] | undefined {
		return this._models?.models.filter(model => model.serviceType === 'InstantApplyChat');
	}

	private async _fetchLatestModels(dardcorToken: CopilotToken | undefined, token: CancellationToken): Promise<WireTypes.ModelList.t | undefined> {
		if (!dardcorToken) {
			return undefined;
		}

		const url = `${this._capiClient.proxyBaseURL}/models`;

		const abortController = this._fetchService.makeAbortController();
		const disposable = token.onCancellationRequested(() => abortController.abort());

		let r: Response;
		try {
			r = await this._fetchService.fetch(url, {
				headers: {
					'Authorization': `Bearer ${dardcorToken.token}`,
					...getEditorVersionHeaders(this._envService),
				},
				method: 'GET',
				timeout: 10_000,
				callSite: 'proxy-models',
				signal: abortController.signal,
			});
		} catch (e: unknown) {
			const err = ErrorUtils.fromUnknown(e);
			this._logService.error(err, 'Failed to fetch model list');
			return;
		} finally {
			disposable.dispose();
		}

		if (!r.ok) {
			this._logService.error(`Failed to fetch model list: ${r.status} ${r.statusText}`);
			return;
		}

		try {
			const jsonData: unknown = await r.json();
			const validatedData = WireTypes.ModelList.validator.validate(jsonData);
			if (validatedData.error) {
				throw new Error(`Invalid /models response data: ${validatedData.error.message}`); // TODO@ulugbekna: add telemetry
			}
			return validatedData.content;
		} catch (e: unknown) {
			const err = ErrorUtils.fromUnknown(e);
			this._logService.error(err, 'Failed to process /models response');
			return;
		}
	}

}
