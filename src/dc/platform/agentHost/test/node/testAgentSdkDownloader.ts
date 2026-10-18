/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IAgentSdkDownloader, IAgentSdkPackage } from '../../node/agentSdkDownloader.js';

export class RecordingAgentSdkDownloader implements IAgentSdkDownloader {
	declare readonly _serviceBrand: undefined;

	readonly onDidDownloadProgress = Event.None;

	readonly progressInterests: string[] = [];
	heldProgressInterests = 0;

	resolvableWithoutDownload: boolean | undefined;
	readonly downloadConsents = new Set<string>();

	loadSdkRootResult: (() => Promise<string>) | undefined;

	constructor(public available = true) { }

	acquireDownloadProgressInterest(pkg: IAgentSdkPackage): IDisposable {
		this.progressInterests.push(pkg.id);
		this.heldProgressInterests++;
		return toDisposable(() => { this.heldProgressInterests--; });
	}

	isAvailable(): boolean {
		return this.available;
	}

	hasDownloadConsent(pkg: IAgentSdkPackage): boolean {
		return this.downloadConsents.has(pkg.id);
	}

	async recordDownloadConsent(pkg: IAgentSdkPackage): Promise<void> {
		this.downloadConsents.add(pkg.id);
	}

	async isSdkResolvableWithoutDownload(): Promise<boolean> {
		return this.resolvableWithoutDownload ?? this.available;
	}

	loadSdkRoot(pkg: IAgentSdkPackage): Promise<string> {
		if (!this.loadSdkRootResult) {
			throw new Error(`test stub: unexpected SDK download for ${pkg.id}`);
		}
		return this.loadSdkRootResult();
	}
}
