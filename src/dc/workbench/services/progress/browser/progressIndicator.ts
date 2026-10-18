/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProgressBar } from '../../../../base/browser/ui/progressbar/progressbar.js';
import { IProgressRunner, IProgressIndicator, emptyProgressRunner } from '../../../../platform/progress/common/progress.js';
import { IEditorGroupView } from '../../../browser/parts/editor/editor.js';
import { GroupModelChangeKind } from '../../../common/editor.js';

export class EditorProgressIndicator extends Disposable implements IProgressIndicator {

	constructor(
		private readonly progressBar: ProgressBar,
		private readonly group: IEditorGroupView
	) {
		super();

		this.registerListeners();
	}

	private registerListeners() {

		this._register(this.group.onDidModelChange(e => {
			if (
				e.kind === GroupModelChangeKind.EDITOR_ACTIVE ||
				(e.kind === GroupModelChangeKind.EDITOR_CLOSE && this.group.isEmpty)
			) {
				this.progressBar.stop().hide();
			}
		}));
	}

	show(infinite: true, delay?: number): IProgressRunner;
	show(total: number, delay?: number): IProgressRunner;
	show(infiniteOrTotal: true | number, delay?: number): IProgressRunner {

		if (this.group.isEmpty) {
			return emptyProgressRunner;
		}

		if (infiniteOrTotal === true) {
			return this.doShow(true, delay);
		}

		return this.doShow(infiniteOrTotal, delay);
	}

	private doShow(infinite: true, delay?: number): IProgressRunner;
	private doShow(total: number, delay?: number): IProgressRunner;
	private doShow(infiniteOrTotal: true | number, delay?: number): IProgressRunner {
		if (typeof infiniteOrTotal === 'boolean') {
			this.progressBar.infinite().show(delay);
		} else {
			this.progressBar.total(infiniteOrTotal).show(delay);
		}

		return {
			total: (total: number) => {
				this.progressBar.total(total);
			},

			worked: (worked: number) => {
				if (this.progressBar.hasTotal()) {
					this.progressBar.worked(worked);
				} else {
					this.progressBar.infinite().show();
				}
			},

			done: () => {
				this.progressBar.stop().hide();
			}
		};
	}

	async showWhile(promise: Promise<unknown>, delay?: number): Promise<void> {

		if (this.group.isEmpty) {
			try {
				await promise;
			} catch (error) {
			}
		}

		return this.doShowWhile(promise, delay);
	}

	private async doShowWhile(promise: Promise<unknown>, delay?: number): Promise<void> {
		try {
			this.progressBar.infinite().show(delay);

			await promise;
		} catch (error) {
		} finally {
			this.progressBar.stop().hide();
		}
	}
}

namespace ProgressIndicatorState {

	export const enum Type {
		None,
		Done,
		Infinite,
		While,
		Work
	}

	export const None = { type: Type.None } as const;
	export const Done = { type: Type.Done } as const;
	export const Infinite = { type: Type.Infinite } as const;

	export class While {

		readonly type = Type.While;

		constructor(
			readonly whilePromise: Promise<unknown>,
			readonly whileStart: number,
			readonly whileDelay: number,
		) { }
	}

	export class Work {

		readonly type = Type.Work;

		constructor(
			readonly total: number | undefined,
			readonly worked: number | undefined
		) { }
	}

	export type State =
		typeof None
		| typeof Done
		| typeof Infinite
		| While
		| Work;
}

export interface IProgressScope {

	readonly onDidChangeActive: Event<void>;

	readonly isActive: boolean;
}

export class ScopedProgressIndicator extends Disposable implements IProgressIndicator {

	private progressState: ProgressIndicatorState.State = ProgressIndicatorState.None;

	constructor(
		private readonly progressBar: ProgressBar,
		private readonly scope: IProgressScope
	) {
		super();

		this.registerListeners();
	}

	registerListeners() {
		this._register(this.scope.onDidChangeActive(() => {
			if (this.scope.isActive) {
				this.onDidScopeActivate();
			} else {
				this.onDidScopeDeactivate();
			}
		}));
	}

	private onDidScopeActivate(): void {

		if (this.progressState.type === ProgressIndicatorState.Done.type) {
			return;
		}

		if (this.progressState.type === ProgressIndicatorState.Type.While) {
			let delay: number | undefined;
			if (this.progressState.whileDelay > 0) {
				const remainingDelay = this.progressState.whileDelay - (Date.now() - this.progressState.whileStart);
				if (remainingDelay > 0) {
					delay = remainingDelay;
				}
			}

			this.doShowWhile(delay);
		}

		else if (this.progressState.type === ProgressIndicatorState.Type.Infinite) {
			this.progressBar.infinite().show();
		}

		else if (this.progressState.type === ProgressIndicatorState.Type.Work) {
			if (this.progressState.total) {
				this.progressBar.total(this.progressState.total).show();
			}

			if (this.progressState.worked) {
				this.progressBar.worked(this.progressState.worked).show();
			}
		}
	}

	private onDidScopeDeactivate(): void {
		this.progressBar.stop().hide();
	}

	show(infinite: true, delay?: number): IProgressRunner;
	show(total: number, delay?: number): IProgressRunner;
	show(infiniteOrTotal: true | number, delay?: number): IProgressRunner {

		if (typeof infiniteOrTotal === 'boolean') {
			this.progressState = ProgressIndicatorState.Infinite;
		} else {
			this.progressState = new ProgressIndicatorState.Work(infiniteOrTotal, undefined);
		}

		if (this.scope.isActive) {

			if (this.progressState.type === ProgressIndicatorState.Type.Infinite) {
				this.progressBar.infinite().show(delay);
			}

			else if (this.progressState.type === ProgressIndicatorState.Type.Work && typeof this.progressState.total === 'number') {
				this.progressBar.total(this.progressState.total).show(delay);
			}
		}

		return {
			total: (total: number) => {
				this.progressState = new ProgressIndicatorState.Work(
					total,
					this.progressState.type === ProgressIndicatorState.Type.Work ? this.progressState.worked : undefined);

				if (this.scope.isActive) {
					this.progressBar.total(total);
				}
			},

			worked: (worked: number) => {

				if (!this.scope.isActive || this.progressBar.hasTotal()) {
					this.progressState = new ProgressIndicatorState.Work(
						this.progressState.type === ProgressIndicatorState.Type.Work ? this.progressState.total : undefined,
						this.progressState.type === ProgressIndicatorState.Type.Work && typeof this.progressState.worked === 'number' ? this.progressState.worked + worked : worked);

					if (this.scope.isActive) {
						this.progressBar.worked(worked);
					}
				}

				else {
					this.progressState = ProgressIndicatorState.Infinite;
					this.progressBar.infinite().show();
				}
			},

			done: () => {
				this.progressState = ProgressIndicatorState.Done;

				if (this.scope.isActive) {
					this.progressBar.stop().hide();
				}
			}
		};
	}

	async showWhile(promise: Promise<unknown>, delay?: number): Promise<void> {

		if (this.progressState.type === ProgressIndicatorState.Type.While) {
			promise = Promise.allSettled([promise, this.progressState.whilePromise]);
		}

		this.progressState = new ProgressIndicatorState.While(promise, delay || 0, Date.now());

		try {
			this.doShowWhile(delay);

			await promise;
		} catch (error) {
		} finally {

			if (this.progressState.type !== ProgressIndicatorState.Type.While || this.progressState.whilePromise === promise) {

				this.progressState = ProgressIndicatorState.None;

				if (this.scope.isActive) {
					this.progressBar.stop().hide();
				}
			}
		}
	}

	private doShowWhile(delay?: number): void {

		if (this.scope.isActive) {
			this.progressBar.infinite().show(delay);
		}
	}
}

export abstract class AbstractProgressScope extends Disposable implements IProgressScope {

	private readonly _onDidChangeActive = this._register(new Emitter<void>());
	readonly onDidChangeActive = this._onDidChangeActive.event;

	get isActive() { return this._isActive; }

	constructor(
		private scopeId: string,
		private _isActive: boolean
	) {
		super();
	}

	protected onScopeOpened(scopeId: string) {
		if (scopeId === this.scopeId) {
			if (!this._isActive) {
				this._isActive = true;

				this._onDidChangeActive.fire();
			}
		}
	}

	protected onScopeClosed(scopeId: string) {
		if (scopeId === this.scopeId) {
			if (this._isActive) {
				this._isActive = false;

				this._onDidChangeActive.fire();
			}
		}
	}
}
