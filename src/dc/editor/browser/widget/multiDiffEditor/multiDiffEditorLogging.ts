/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, autorunWithStore, IObservable, observableFromEvent } from '../../../../base/common/observable.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import { MultiDiffEditorViewModel } from './multiDiffEditorViewModel.js';

export interface ILoggedDiffItem {
	getKey(): string;
	getLabel(): string;
	readonly collapsed: IObservable<boolean>;
	readonly contentHeight: IObservable<number>;
}

export interface ILoggedEditorState {
	readonly viewModel: IObservable<MultiDiffEditorViewModel | undefined>;
	readonly items: IObservable<readonly ILoggedDiffItem[]>;
	readonly spaceBetweenPx: number;
	readonly getScrollTop: () => number;
	readonly isPreserveFocusOnLoad: () => boolean;
}

export class MultiDiffEditorLogger extends Disposable {
	private readonly _lastLoggedCollapsed = new Map<string, boolean>();
	private readonly _lastLoggedContentHeight = new Map<string, number>();

	private readonly _isEnabled: IObservable<boolean>;

	constructor(private readonly _logService: ILogService) {
		super();

		this._isEnabled = observableFromEvent(this, this._logService.onDidChangeLogLevel, () => this._logService.getLevel() <= LogLevel.Trace);
	}

	public get isEnabled(): boolean {
		return this._isEnabled.get();
	}

	public log(message: string, data?: Record<string, unknown>): void {
		if (!this.isEnabled) {
			return;
		}
		const formattedData = data ? Object.entries(data).map(([key, value]) => `${key}: ${formatValue(value)}`).join(', ') : undefined;
		this._logService.trace(`[MultiDiffEditor] ${message}${formattedData ? ` (${formattedData})` : ''}`);
	}

	public logStateChanges(state: ILoggedEditorState): void {
		this._register(autorunWithStore((reader, store) => {
			if (!this._isEnabled.read(reader)) {
				return;
			}

			store.add(toDisposable(() => {
				this._lastLoggedCollapsed.clear();
				this._lastLoggedContentHeight.clear();
			}));

			store.add(autorun(reader => {
				const viewModel = state.viewModel.read(reader);
				this.log('view model changed', {
					hasViewModel: !!viewModel,
					isLoading: viewModel?.isLoading.read(reader),
					preserveFocusOnLoad: state.isPreserveFocusOnLoad(),
				});
			}));

			store.add(autorun(reader => {
				const changed: string[] = [];
				for (const item of state.items.read(reader)) {
					const collapsed = item.collapsed.read(reader);
					const key = item.getKey();
					if (this._lastLoggedCollapsed.get(key) !== collapsed) {
						this._lastLoggedCollapsed.set(key, collapsed);
						changed.push(`${item.getLabel()}=${collapsed}`);
					}
				}
				if (changed.length > 0) {
					this.log('collapsed state changed', { changed });
				}
			}));

			store.add(autorun(reader => {
				const scrollTop = state.getScrollTop();
				const changed: string[] = [];
				let totalHeight = 0;
				for (const item of state.items.read(reader)) {
					const contentHeight = item.contentHeight.read(reader);
					const key = item.getKey();
					const lastContentHeight = this._lastLoggedContentHeight.get(key);
					if (lastContentHeight !== contentHeight) {
						const abovePosition = totalHeight < scrollTop ? ' (above scroll offset)' : '';
						changed.push(`${item.getLabel()}: ${lastContentHeight ?? '?'} -> ${contentHeight}${abovePosition}`);
						this._lastLoggedContentHeight.set(key, contentHeight);
					}
					totalHeight += contentHeight + state.spaceBetweenPx;
				}
				if (changed.length > 0) {
					this.log('content height changed', { changed, totalHeight, scrollTop });
				}
			}));
		}));
	}
}

export function formatUri(uri: URI | undefined): string {
	if (!uri) {
		return '<none>';
	}
	return basename(uri) || uri.authority || uri.scheme;
}

export function formatDiffItemKey(key: string | undefined): string {
	if (key === undefined) {
		return '<none>';
	}
	try {
		const [original, modified] = JSON.parse(key) as (string | undefined)[];
		const uri = modified ?? original;
		return uri ? formatUri(URI.parse(uri)) : '<none>';
	} catch {
		return key;
	}
}

function formatValue(value: unknown): string {
	if (value === undefined) {
		return '<undefined>';
	}
	if (URI.isUri(value)) {
		return formatUri(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(formatValue).join(', ')}]`;
	}
	if (typeof value === 'number') {
		return String(Math.round(value * 100) / 100);
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}
