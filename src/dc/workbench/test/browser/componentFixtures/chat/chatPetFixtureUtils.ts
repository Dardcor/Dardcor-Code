/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../../base/common/observable.js';
import { ChatPetAccessoryId, ChatPetAchievementId } from '../../../../contrib/chat/browser/chatPetAchievements.js';
import { ChatPetVariant, IChatPetService } from '../../../../contrib/chat/browser/chatPetService.js';

export interface IChatPetFixtureOptions {
	readonly enabled?: boolean;
	readonly variant?: ChatPetVariant;
	readonly onTheRun?: boolean;
	readonly scale?: number;
	readonly unlockedAchievements?: readonly ChatPetAchievementId[];
	readonly unseenAchievements?: readonly ChatPetAchievementId[];
	readonly selectedAccessory?: ChatPetAccessoryId;
}

export class FixtureChatPetService extends Disposable implements IChatPetService {
	declare readonly _serviceBrand: undefined;

	readonly enabled: IObservable<boolean>;
	readonly variant: IObservable<ChatPetVariant>;
	readonly onTheRun: IObservable<boolean>;
	readonly scale: IObservable<number>;
	readonly unlockedAchievements: IObservable<readonly ChatPetAchievementId[]>;
	readonly unseenAchievements: IObservable<readonly ChatPetAchievementId[]>;
	readonly selectedAccessory: IObservable<ChatPetAccessoryId | undefined>;
	readonly horizontalPosition: IObservable<number | undefined>;

	private readonly _onDidUnlockAchievement = this._register(new Emitter<ChatPetAchievementId>());
	readonly onDidUnlockAchievement: Event<ChatPetAchievementId> = this._onDidUnlockAchievement.event;

	constructor(options?: IChatPetFixtureOptions) {
		super();
		this.enabled = observableValue(this, options?.enabled ?? true);
		this.variant = observableValue(this, options?.variant ?? 'stable');
		this.onTheRun = observableValue(this, options?.onTheRun ?? false);
		this.scale = observableValue(this, options?.scale ?? 1);
		this.unlockedAchievements = observableValue(this, options?.unlockedAchievements ?? []);
		this.unseenAchievements = observableValue(this, options?.unseenAchievements ?? []);
		this.selectedAccessory = observableValue(this, options?.selectedAccessory);
		this.horizontalPosition = observableValue(this, undefined);
	}

	toggle(): boolean { return true; }
	setVariant(_variant: ChatPetVariant): void { }
	setOnTheRun(_onTheRun: boolean): void { }
	setScale(_scale: number): void { }
	resetScale(): void { }
	unlockAchievement(id: ChatPetAchievementId): boolean {
		this._onDidUnlockAchievement.fire(id);
		return true;
	}
	markAchievementSeen(_id: ChatPetAchievementId): boolean { return true; }
	setAccessory(_id: ChatPetAccessoryId | undefined): void { }
	resetAchievements(): void { }
	setHorizontalPosition(_position: number): void { }
}

export function configureChatPetFixtureFileRoot(_store?: DisposableStore): void { }

export function assertChatPetInScreenshot(_element?: HTMLElement): void { }
