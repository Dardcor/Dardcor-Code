/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, IDisposable, toDisposable, DisposableStore, DisposableMap } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IWorkingCopy, IWorkingCopyIdentifier, IWorkingCopySaveEvent as IBaseWorkingCopySaveEvent } from './workingCopy.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';

export const IWorkingCopyService = createDecorator<IWorkingCopyService>('workingCopyService');

export interface IWorkingCopySaveEvent extends IBaseWorkingCopySaveEvent {

	readonly workingCopy: IWorkingCopy;
}

export interface IWorkingCopyService {

	readonly _serviceBrand: undefined;



	readonly onDidRegister: Event<IWorkingCopy>;

	readonly onDidUnregister: Event<IWorkingCopy>;

	readonly onDidChangeDirty: Event<IWorkingCopy>;

	readonly onDidChangeContent: Event<IWorkingCopy>;

	readonly onDidSave: Event<IWorkingCopySaveEvent>;




	readonly dirtyCount: number;

	readonly dirtyWorkingCopies: readonly IWorkingCopy[];

	readonly modifiedCount: number;

	readonly modifiedWorkingCopies: readonly IWorkingCopy[];

	readonly hasDirty: boolean;

	isDirty(resource: URI, typeId?: string): boolean;




	readonly workingCopies: readonly IWorkingCopy[];

	registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable;

	has(identifier: IWorkingCopyIdentifier): boolean;
	has(resource: URI): boolean;

	get(identifier: IWorkingCopyIdentifier): IWorkingCopy | undefined;

	getAll(resource: URI): readonly IWorkingCopy[] | undefined;

}

class WorkingCopyLeakError extends Error {

	constructor(message: string, stack: string) {
		super(message);

		this.name = 'WorkingCopyLeakError';
		this.stack = stack;
	}
}

export class WorkingCopyService extends Disposable implements IWorkingCopyService {

	declare readonly _serviceBrand: undefined;


	private readonly _onDidRegister = this._register(new Emitter<IWorkingCopy>());
	readonly onDidRegister = this._onDidRegister.event;

	private readonly _onDidUnregister = this._register(new Emitter<IWorkingCopy>());
	readonly onDidUnregister = this._onDidUnregister.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<IWorkingCopy>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeContent = this._register(new Emitter<IWorkingCopy>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidSave = this._register(new Emitter<IWorkingCopySaveEvent>());
	readonly onDidSave = this._onDidSave.event;




	get workingCopies(): IWorkingCopy[] { return Array.from(this._workingCopies.values()); }
	private _workingCopies = new Set<IWorkingCopy>();

	private readonly mapResourceToWorkingCopies = new ResourceMap<Map<string, IWorkingCopy>>();
	private readonly mapWorkingCopyToListeners = this._register(new DisposableMap<IWorkingCopy>());

	registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable {
		let workingCopiesForResource = this.mapResourceToWorkingCopies.get(workingCopy.resource);
		if (workingCopiesForResource?.has(workingCopy.typeId)) {
			throw new Error(`Cannot register more than one working copy with the same resource ${workingCopy.resource.toString()} and type ${workingCopy.typeId}.`);
		}

		this._workingCopies.add(workingCopy);

		if (!workingCopiesForResource) {
			workingCopiesForResource = new Map();
			this.mapResourceToWorkingCopies.set(workingCopy.resource, workingCopiesForResource);
		}
		workingCopiesForResource.set(workingCopy.typeId, workingCopy);

		const disposables = new DisposableStore();
		disposables.add(workingCopy.onDidChangeContent(() => this._onDidChangeContent.fire(workingCopy)));
		disposables.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));
		disposables.add(workingCopy.onDidSave(e => this._onDidSave.fire({ workingCopy, ...e })));
		this.mapWorkingCopyToListeners.set(workingCopy, disposables);

		this._onDidRegister.fire(workingCopy);
		if (workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}

		const leakId = this.trackLeaks(workingCopy);

		return toDisposable(() => {

			if (leakId) {
				this.untrackLeaks(leakId);
			}

			this.unregisterWorkingCopy(workingCopy);

			this._onDidUnregister.fire(workingCopy);
		});
	}

	protected unregisterWorkingCopy(workingCopy: IWorkingCopy): void {

		this._workingCopies.delete(workingCopy);

		const workingCopiesForResource = this.mapResourceToWorkingCopies.get(workingCopy.resource);
		if (workingCopiesForResource?.delete(workingCopy.typeId) && workingCopiesForResource.size === 0) {
			this.mapResourceToWorkingCopies.delete(workingCopy.resource);
		}

		if (workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}

		this.mapWorkingCopyToListeners.deleteAndDispose(workingCopy);
	}

	has(identifier: IWorkingCopyIdentifier): boolean;
	has(resource: URI): boolean;
	has(resourceOrIdentifier: URI | IWorkingCopyIdentifier): boolean {
		if (URI.isUri(resourceOrIdentifier)) {
			return this.mapResourceToWorkingCopies.has(resourceOrIdentifier);
		}

		return this.mapResourceToWorkingCopies.get(resourceOrIdentifier.resource)?.has(resourceOrIdentifier.typeId) ?? false;
	}

	get(identifier: IWorkingCopyIdentifier): IWorkingCopy | undefined {
		return this.mapResourceToWorkingCopies.get(identifier.resource)?.get(identifier.typeId);
	}

	getAll(resource: URI): readonly IWorkingCopy[] | undefined {
		const workingCopies = this.mapResourceToWorkingCopies.get(resource);
		if (!workingCopies) {
			return undefined;
		}

		return Array.from(workingCopies.values());
	}



	private static readonly LEAK_TRACKING_THRESHOLD = 256;
	private static readonly LEAK_REPORTING_THRESHOLD = 2 * WorkingCopyService.LEAK_TRACKING_THRESHOLD;
	private static LEAK_REPORTED = false;

	private readonly mapLeakToCounter = new Map<string, number>();

	private trackLeaks(workingCopy: IWorkingCopy): string | undefined {
		if (WorkingCopyService.LEAK_REPORTED || this._workingCopies.size < WorkingCopyService.LEAK_TRACKING_THRESHOLD) {
			return undefined;
		}

		const leakId = `${workingCopy.resource.scheme}#${workingCopy.typeId || '<no typeId>'}\n${new Error().stack?.split('\n').slice(2).join('\n') ?? ''}`;
		const leakCounter = (this.mapLeakToCounter.get(leakId) ?? 0) + 1;
		this.mapLeakToCounter.set(leakId, leakCounter);

		if (this._workingCopies.size > WorkingCopyService.LEAK_REPORTING_THRESHOLD) {
			WorkingCopyService.LEAK_REPORTED = true;

			const [topLeak, topCount] = Array.from(this.mapLeakToCounter.entries()).reduce(
				([topLeak, topCount], [key, val]) => val > topCount ? [key, val] : [topLeak, topCount]
			);

			const message = `Potential working copy LEAK detected, having ${this._workingCopies.size} working copies already. Most frequent owner (${topCount})`;
			onUnexpectedError(new WorkingCopyLeakError(message, topLeak));
		}

		return leakId;
	}

	private untrackLeaks(leakId: string): void {
		const stackCounter = (this.mapLeakToCounter.get(leakId) ?? 1) - 1;
		this.mapLeakToCounter.set(leakId, stackCounter);

		if (stackCounter === 0) {
			this.mapLeakToCounter.delete(leakId);
		}
	}



	get hasDirty(): boolean {
		for (const workingCopy of this._workingCopies) {
			if (workingCopy.isDirty()) {
				return true;
			}
		}

		return false;
	}

	get dirtyCount(): number {
		let totalDirtyCount = 0;

		for (const workingCopy of this._workingCopies) {
			if (workingCopy.isDirty()) {
				totalDirtyCount++;
			}
		}

		return totalDirtyCount;
	}

	get dirtyWorkingCopies(): IWorkingCopy[] {
		return this.workingCopies.filter(workingCopy => workingCopy.isDirty());
	}

	get modifiedCount(): number {
		let totalModifiedCount = 0;

		for (const workingCopy of this._workingCopies) {
			if (workingCopy.isModified()) {
				totalModifiedCount++;
			}
		}

		return totalModifiedCount;
	}

	get modifiedWorkingCopies(): IWorkingCopy[] {
		return this.workingCopies.filter(workingCopy => workingCopy.isModified());
	}

	isDirty(resource: URI, typeId?: string): boolean {
		const workingCopies = this.mapResourceToWorkingCopies.get(resource);
		if (workingCopies) {

			if (typeof typeId === 'string') {
				return workingCopies.get(typeId)?.isDirty() ?? false;
			}

			else {
				for (const [, workingCopy] of workingCopies) {
					if (workingCopy.isDirty()) {
						return true;
					}
				}
			}
		}

		return false;
	}

}

registerSingleton(IWorkingCopyService, WorkingCopyService, InstantiationType.Delayed);
