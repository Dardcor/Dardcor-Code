/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { DeferredPromise } from '../../base/common/async.js';
import { createDecorator, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IChatEntitlementService } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { WELCOME_COMPLETE_KEY } from '../common/welcome.js';

export const ISessionsSetUpService = createDecorator<ISessionsSetUpService>('sessionsSetUpService');

export interface ISessionsSetUpService {
	readonly _serviceBrand: undefined;
	readonly initialSignInDialogShown: boolean;
	/**
	 * Resolves when the welcome/setup flow has completed (or immediately
	 * if it is not currently active). Use this to defer work until after
	 * the user has finished the initial sign-in or setup dialog.
	 */
	whenWelcomeDone(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal welcome widget — owns all the welcome UI logic.
// ---------------------------------------------------------------------------

class SessionsSetUpWidget extends Disposable {

	constructor(
		private readonly onCompleted: () => void,
		private readonly serviceMarkDone: () => void,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._start();
	}

	private _start(): void {
		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
		this.onCompleted();
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SessionsSetUpService extends Disposable implements ISessionsSetUpService {

	declare readonly _serviceBrand: undefined;

	private readonly _welcomeDoneDeferred = new DeferredPromise<void>();
	private _initialSignInDialogShown = false;

	get initialSignInDialogShown(): boolean {
		return this._initialSignInDialogShown;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.chatEntitlementService.markSetupCompleted();
		this._welcomeDoneDeferred.complete();

		this._register(this.instantiationService.createInstance(
			SessionsSetUpWidget,
			() => this._welcomeDoneDeferred.complete(),
			() => this.chatEntitlementService.markSetupCompleted()
		));
	}

	whenWelcomeDone(): Promise<void> {
		return this._welcomeDoneDeferred.p;
	}
}
