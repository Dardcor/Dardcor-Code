/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { IKeyMods, IQuickPickDidAcceptEvent, IQuickPickSeparator, IQuickPick, IQuickPickItem, IQuickInputButton, isKeyModified } from '../common/quickInput.js';
import { IQuickAccessProvider, IQuickAccessProviderRunOptions } from '../common/quickAccess.js';
import { isFunction } from '../../../base/common/types.js';

export enum TriggerAction {

	NO_ACTION,

	CLOSE_PICKER,

	REFRESH_PICKER,

	REMOVE_ITEM
}

export interface IPickerQuickAccessItem extends IQuickPickItem {

	accept?(keyMods: IKeyMods, event: IQuickPickDidAcceptEvent): void;

	trigger?(buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction>;

	attach?(keyMods: IKeyMods, event: IQuickPickDidAcceptEvent): void;
}

export interface IPickerQuickAccessSeparator extends IQuickPickSeparator {
	trigger?(buttonIndex: number, keyMods: IKeyMods): TriggerAction | Promise<TriggerAction>;
}

export interface IPickerQuickAccessProviderOptions<T extends IPickerQuickAccessItem> {

	readonly canAcceptInBackground?: boolean;

	readonly noResultsPick?: T | ((filter: string) => T);

	readonly shouldSkipTrimPickFilter?: boolean;
}

export type Pick<T> = T | IQuickPickSeparator;
export type PicksWithActive<T> = { items: readonly Pick<T>[]; active?: T };
export type Picks<T> = readonly Pick<T>[] | PicksWithActive<T>;
export type FastAndSlowPicks<T> = {

	readonly picks: Picks<T>;

	readonly additionalPicks: Promise<Picks<T>>;

	readonly mergeDelay?: number;
};

function isPicksWithActive<T>(obj: unknown): obj is PicksWithActive<T> {
	const candidate = obj as PicksWithActive<T>;

	return Array.isArray(candidate.items);
}

function isFastAndSlowPicks<T>(obj: unknown): obj is FastAndSlowPicks<T> {
	const candidate = obj as FastAndSlowPicks<T>;

	return !!candidate.picks && candidate.additionalPicks instanceof Promise;
}

export abstract class PickerQuickAccessProvider<T extends IPickerQuickAccessItem> extends Disposable implements IQuickAccessProvider {

	constructor(private prefix: string, protected options?: IPickerQuickAccessProviderOptions<T>) {
		super();
	}

	provide(picker: IQuickPick<T, { useSeparators: true }>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable {
		const disposables = new DisposableStore();

		picker.canAcceptInBackground = !!this.options?.canAcceptInBackground;

		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;

		let picksCts: CancellationTokenSource | undefined = undefined;
		const picksDisposable = disposables.add(new MutableDisposable());
		const updatePickerItems = async () => {
			picksCts?.dispose(true);
			picker.busy = false;

			const picksDisposables = picksDisposable.value = new DisposableStore();

			picksCts = picksDisposables.add(new CancellationTokenSource(token));

			const picksToken = picksCts.token;
			let picksFilter = picker.value.substring(this.prefix.length);

			if (!this.options?.shouldSkipTrimPickFilter) {
				picksFilter = picksFilter.trim();
			}

			const providedPicks = this._getPicks(picksFilter, picksDisposables, picksToken, runOptions);

			const applyPicks = (picks: Picks<T>, skipEmpty?: boolean): boolean => {
				let items: readonly Pick<T>[];
				let activeItem: T | undefined = undefined;

				if (isPicksWithActive(picks)) {
					items = picks.items;
					activeItem = picks.active;
				} else {
					items = picks;
				}

				if (items.length === 0) {
					if (skipEmpty) {
						return false;
					}

					if ((picksFilter.length > 0 || picker.hideInput) && this.options?.noResultsPick) {
						if (isFunction(this.options.noResultsPick)) {
							items = [this.options.noResultsPick(picksFilter)];
						} else {
							items = [this.options.noResultsPick];
						}
					}
				}

				picker.items = items;
				if (activeItem) {
					picker.activeItems = [activeItem];
				}

				return true;
			};

			const applyFastAndSlowPicks = async (fastAndSlowPicks: FastAndSlowPicks<T>): Promise<void> => {
				let fastPicksApplied = false;
				let slowPicksApplied = false;

				await Promise.all([


					(async () => {
						if (typeof fastAndSlowPicks.mergeDelay === 'number') {
							await timeout(fastAndSlowPicks.mergeDelay);
							if (picksToken.isCancellationRequested) {
								return;
							}
						}

						if (!slowPicksApplied) {
							fastPicksApplied = applyPicks(fastAndSlowPicks.picks, true );
						}
					})(),


					(async () => {
						picker.busy = true;
						try {
							const awaitedAdditionalPicks = await fastAndSlowPicks.additionalPicks;
							if (picksToken.isCancellationRequested) {
								return;
							}

							let picks: readonly Pick<T>[];
							let activePick: Pick<T> | undefined = undefined;
							if (isPicksWithActive(fastAndSlowPicks.picks)) {
								picks = fastAndSlowPicks.picks.items;
								activePick = fastAndSlowPicks.picks.active;
							} else {
								picks = fastAndSlowPicks.picks;
							}

							let additionalPicks: readonly Pick<T>[];
							let additionalActivePick: Pick<T> | undefined = undefined;
							if (isPicksWithActive(awaitedAdditionalPicks)) {
								additionalPicks = awaitedAdditionalPicks.items;
								additionalActivePick = awaitedAdditionalPicks.active;
							} else {
								additionalPicks = awaitedAdditionalPicks;
							}

							if (additionalPicks.length > 0 || !fastPicksApplied) {
								let fallbackActivePick: Pick<T> | undefined = undefined;
								if (!activePick && !additionalActivePick) {
									const fallbackActivePickCandidate = picker.activeItems[0];
									if (fallbackActivePickCandidate && picks.indexOf(fallbackActivePickCandidate) !== -1) {
										fallbackActivePick = fallbackActivePickCandidate;
									}
								}

								applyPicks({
									items: [...picks, ...additionalPicks],
									active: activePick || additionalActivePick || fallbackActivePick
								});
							}
						} finally {
							if (!picksToken.isCancellationRequested) {
								picker.busy = false;
							}

							slowPicksApplied = true;
						}
					})()
				]);
			};

			if (providedPicks === null) {
			}

			else if (isFastAndSlowPicks(providedPicks)) {
				await applyFastAndSlowPicks(providedPicks);
			}

			else if (!(providedPicks instanceof Promise)) {
				applyPicks(providedPicks);
			}

			else {
				picker.busy = true;
				try {
					const awaitedPicks = await providedPicks;
					if (picksToken.isCancellationRequested) {
						return;
					}

					if (isFastAndSlowPicks(awaitedPicks)) {
						await applyFastAndSlowPicks(awaitedPicks);
					} else {
						applyPicks(awaitedPicks);
					}
				} finally {
					if (!picksToken.isCancellationRequested) {
						picker.busy = false;
					}
				}
			}
		};
		disposables.add(picker.onDidChangeValue(() => updatePickerItems()));
		updatePickerItems();

		disposables.add(picker.onDidAccept(event => {
			if (runOptions?.handleAccept) {
				if (!event.inBackground) {
					picker.hide();
				}
				runOptions.handleAccept?.(picker.activeItems[0], event.inBackground);
				return;
			}

			const [item] = picker.selectedItems;
			if (typeof item?.accept === 'function') {
				const isAttachAction = isKeyModified(picker.keyMods) && !!item.attach;
				if (isAttachAction) {
					item.attach!(picker.keyMods, event);
					return;
				}
				if (!event.inBackground) {
					picker.hide();
				}

				item.accept(picker.keyMods, event);
			}
		}));

		const buttonTrigger = async (button: IQuickInputButton, item: T | IPickerQuickAccessSeparator) => {
			if (typeof item.trigger !== 'function') {
				return;
			}

			const buttonIndex = item.buttons?.indexOf(button) ?? -1;
			if (buttonIndex >= 0) {
				const result = item.trigger(buttonIndex, picker.keyMods);
				const action = (typeof result === 'number') ? result : await result;

				if (token.isCancellationRequested) {
					return;
				}

				switch (action) {
					case TriggerAction.NO_ACTION:
						break;
					case TriggerAction.CLOSE_PICKER:
						picker.hide();
						break;
					case TriggerAction.REFRESH_PICKER:
						updatePickerItems();
						break;
					case TriggerAction.REMOVE_ITEM: {
						const index = picker.items.indexOf(item);
						if (index !== -1) {
							const items = picker.items.slice();
							const removed = items.splice(index, 1);
							const activeItems = picker.activeItems.filter(activeItem => activeItem !== removed[0]);
							const keepScrollPositionBefore = picker.keepScrollPosition;
							picker.keepScrollPosition = true;
							picker.items = items;
							if (activeItems) {
								picker.activeItems = activeItems;
							}
							picker.keepScrollPosition = keepScrollPositionBefore;
						}
						break;
					}
				}
			}
		};

		disposables.add(picker.onDidTriggerItemButton(({ button, item }) => buttonTrigger(button, item)));
		disposables.add(picker.onDidTriggerSeparatorButton(({ button, separator }) => buttonTrigger(button, separator)));

		return disposables;
	}

	protected abstract _getPicks(filter: string, disposables: DisposableStore, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): Picks<T> | Promise<Picks<T> | FastAndSlowPicks<T>> | FastAndSlowPicks<T> | null;
}
