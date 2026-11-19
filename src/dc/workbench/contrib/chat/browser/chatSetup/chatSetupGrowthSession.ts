/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';

import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ILifecycleService, LifecyclePhase } from '../../../../services/lifecycle/common/lifecycle.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionsService } from '../../common/chatSessionsService.js';
import { IChatWidgetService } from '../chat.js';


export class GrowthSessionController extends Disposable implements IChatSessionItemController {

	static readonly STORAGE_KEY = 'chat.growthSession.dismissed';

	private static readonly SESSION_URI = URI.from({ scheme: '', path: '/growth-welcome' });

	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<IChatSessionItemsDelta>());
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	private readonly _created = Date.now();

	private _dismissed: boolean;
	get isDismissed(): boolean { return this._dismissed; }

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._dismissed = this.storageService.getBoolean(GrowthSessionController.STORAGE_KEY, StorageScope.APPLICATION, false);

		this.lifecycleService.when(LifecyclePhase.Restored).then(() => {
			if (this._store.isDisposed || this._dismissed) {
				return;
			}
			this._register(this.chatWidgetService.onDidAddWidget(() => {
				this.dismiss();
			}));
		});
	}

	get items(): readonly IChatSessionItem[] {
		if (this._dismissed) {
			return [];
		}

		return [{
			resource: GrowthSessionController.SESSION_URI,
			label: localize('growthSession.label', "Try Dardcor"),
			description: localize('growthSession.description', "Dardcor is available. Try it for free."),
			status: ChatSessionStatus.NeedsInput,
			iconPath: Codicon.lightbulb,
			timing: {
				created: this._created,
				lastRequestStarted: undefined,
				lastRequestEnded: undefined,
			},
		}];
	}

	async refresh(): Promise<void> {
	}

	private dismiss(): void {
		if (this._dismissed) {
			return;
		}

		this.logService.trace('[GrowthSession] Dismissing growth session');
		this._dismissed = true;
		this.storageService.store(GrowthSessionController.STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.USER);

		this._onDidChangeChatSessionItems.fire({
			removed: [GrowthSessionController.SESSION_URI],
		});
		this._onDidDismiss.fire();
	}
}

export function registerGrowthSession(chatSessionsService: IChatSessionsService, growthController: GrowthSessionController): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(chatSessionsService.registerChatSessionItemController('growth', growthController));

	return disposables;
}


registerAction2(class ResetGrowthSessionAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.chat.resetGrowthSession',
			title: localize2('resetGrowthSession', "Reset Growth Session Notification"),
			category: localize2('developer', "Developer"),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const storageService = accessor.get(IStorageService);
		storageService.remove(GrowthSessionController.STORAGE_KEY, StorageScope.APPLICATION);
	}
});

