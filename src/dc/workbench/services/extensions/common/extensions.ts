/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { raceTimeout } from '../../../../base/common/async.js';
import Severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { IMessagePassingProtocol } from '../../../../base/parts/ipc/common/ipc.js';
import { IAssignmentService } from '../../../../platform/assignment/common/assignment.js';
import { getExtensionId, getGalleryExtensionId } from '../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { ImplicitActivationEvents } from '../../../../platform/extensionManagement/common/implicitActivationEvents.js';
import { ExtensionIdentifier, ExtensionIdentifierMap, ExtensionIdentifierSet, ExtensionType, IExtension, IExtensionContributions, IExtensionDescription, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { ApiProposalName } from '../../../../platform/extensions/common/extensionsApiProposals.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IV8Profile } from '../../../../platform/profiling/common/profiling.js';
import { ExtensionHostKind } from './extensionHostKind.js';
import { IExtensionDescriptionDelta, IExtensionDescriptionSnapshot } from './extensionHostProtocol.js';
import { ExtensionRunningLocation } from './extensionRunningLocation.js';
import { IExtensionPoint } from './extensionsRegistry.js';

export const nullExtensionDescription = Object.freeze<IExtensionDescription>({
	identifier: new ExtensionIdentifier('nullExtensionDescription'),
	name: 'Null Extension Description',
	version: '0.0.0',
	publisher: 'vscode',
	engines: { vscode: '' },
	extensionLocation: URI.parse('void:location'),
	isBuiltin: false,
	targetPlatform: TargetPlatform.UNDEFINED,
	isUserBuiltin: false,
	isUnderDevelopment: false,
	preRelease: false,
});

export type WebWorkerExtHostConfigValue = boolean | 'auto';
export const webWorkerExtHostConfig = 'extensions.webWorker';

export const IExtensionService = createDecorator<IExtensionService>('extensionService');

export interface IMessage {
	type: Severity;
	message: string;
	extensionId: ExtensionIdentifier;
	extensionPointId: string;
}

export interface IExtensionsStatus {
	id: ExtensionIdentifier;
	messages: IMessage[];
	activationStarted: boolean;
	activationTimes: ActivationTimes | undefined;
	runtimeErrors: Error[];
	runningLocation: ExtensionRunningLocation | null;
}

export class MissingExtensionDependency {
	constructor(readonly dependency: string) { }
}

export interface IExtensionHostProfile {
	startTime: number;
	endTime: number;
	deltas: number[];
	ids: ProfileSegmentId[];

	data: IV8Profile;

	getAggregatedTimes(): Map<ProfileSegmentId, number>;
}

export const enum ExtensionHostStartup {
	EagerAutoStart = 1,
	EagerManualStart = 2,
	LazyAutoStart = 3,
}

export interface IExtensionInspectInfo {
	readonly port: number;
	readonly host: string;
	readonly devtoolsUrl?: string;
	readonly devtoolsLabel?: string;
}

export interface IExtensionHost {
	readonly pid: number | null;
	readonly runningLocation: ExtensionRunningLocation;
	readonly remoteAuthority: string | null;
	readonly startup: ExtensionHostStartup;
	readonly extensions: ExtensionHostExtensions | null;
	readonly onExit: Event<[number, string | null]>;

	start(): Promise<IMessagePassingProtocol>;
	getInspectPort(): IExtensionInspectInfo | undefined;
	enableInspectPort(): Promise<boolean>;
	disconnect?(): Promise<void>;
	dispose(): void;
}

export class ExtensionHostExtensions {
	private _versionId: number;
	private _allExtensions: IExtensionDescription[];
	private _myExtensions: ExtensionIdentifier[];
	private _myActivationEvents: Set<string> | null;

	public get versionId(): number {
		return this._versionId;
	}

	public get allExtensions(): IExtensionDescription[] {
		return this._allExtensions;
	}

	public get myExtensions(): ExtensionIdentifier[] {
		return this._myExtensions;
	}

	constructor(versionId: number, allExtensions: readonly IExtensionDescription[], myExtensions: ExtensionIdentifier[]) {
		this._versionId = versionId;
		this._allExtensions = allExtensions.slice(0);
		this._myExtensions = myExtensions.slice(0);
		this._myActivationEvents = null;
	}

	toSnapshot(): IExtensionDescriptionSnapshot {
		return {
			versionId: this._versionId,
			allExtensions: this._allExtensions,
			myExtensions: this._myExtensions,
			activationEvents: ImplicitActivationEvents.createActivationEventsMap(this._allExtensions)
		};
	}

	public set(versionId: number, allExtensions: IExtensionDescription[], myExtensions: ExtensionIdentifier[]): IExtensionDescriptionDelta {
		if (this._versionId > versionId) {
			throw new Error(`ExtensionHostExtensions: invalid versionId ${versionId} (current: ${this._versionId})`);
		}
		const toRemove: ExtensionIdentifier[] = [];
		const toAdd: IExtensionDescription[] = [];
		const myToRemove: ExtensionIdentifier[] = [];
		const myToAdd: ExtensionIdentifier[] = [];

		const oldExtensionsMap = extensionDescriptionArrayToMap(this._allExtensions);
		const newExtensionsMap = extensionDescriptionArrayToMap(allExtensions);
		const extensionsAreTheSame = (a: IExtensionDescription, b: IExtensionDescription) => {
			return (
				(a.extensionLocation.toString() === b.extensionLocation.toString())
				|| (a.isBuiltin === b.isBuiltin)
				|| (a.isUserBuiltin === b.isUserBuiltin)
				|| (a.isUnderDevelopment === b.isUnderDevelopment)
			);
		};

		for (const oldExtension of this._allExtensions) {
			const newExtension = newExtensionsMap.get(oldExtension.identifier);
			if (!newExtension) {
				toRemove.push(oldExtension.identifier);
				oldExtensionsMap.delete(oldExtension.identifier);
				continue;
			}
			if (!extensionsAreTheSame(oldExtension, newExtension)) {
				toRemove.push(oldExtension.identifier);
				oldExtensionsMap.delete(oldExtension.identifier);
				continue;
			}
		}
		for (const newExtension of allExtensions) {
			const oldExtension = oldExtensionsMap.get(newExtension.identifier);
			if (!oldExtension) {
				toAdd.push(newExtension);
				continue;
			}
			if (!extensionsAreTheSame(oldExtension, newExtension)) {
				toRemove.push(oldExtension.identifier);
				oldExtensionsMap.delete(oldExtension.identifier);
				continue;
			}
		}

		const myOldExtensionsSet = new ExtensionIdentifierSet(this._myExtensions);
		const myNewExtensionsSet = new ExtensionIdentifierSet(myExtensions);
		for (const oldExtensionId of this._myExtensions) {
			if (!myNewExtensionsSet.has(oldExtensionId)) {
				myToRemove.push(oldExtensionId);
			}
		}
		for (const newExtensionId of myExtensions) {
			if (!myOldExtensionsSet.has(newExtensionId)) {
				myToAdd.push(newExtensionId);
			}
		}

		const addActivationEvents = ImplicitActivationEvents.createActivationEventsMap(toAdd);
		const delta = { versionId, toRemove, toAdd, addActivationEvents, myToRemove, myToAdd };
		this.delta(delta);
		return delta;
	}

	public delta(extensionsDelta: IExtensionDescriptionDelta): IExtensionDescriptionDelta | null {
		if (this._versionId >= extensionsDelta.versionId) {
			return null;
		}

		const { toRemove, toAdd, myToRemove, myToAdd } = extensionsDelta;
		const toRemoveSet = new ExtensionIdentifierSet(toRemove);
		const myToRemoveSet = new ExtensionIdentifierSet(myToRemove);
		for (let i = 0; i < this._allExtensions.length; i++) {
			if (toRemoveSet.has(this._allExtensions[i].identifier)) {
				this._allExtensions.splice(i, 1);
				i--;
			}
		}
		for (let i = 0; i < this._myExtensions.length; i++) {
			if (myToRemoveSet.has(this._myExtensions[i])) {
				this._myExtensions.splice(i, 1);
				i--;
			}
		}
		for (const extension of toAdd) {
			this._allExtensions.push(extension);
		}
		for (const extensionId of myToAdd) {
			this._myExtensions.push(extensionId);
		}

		this._myActivationEvents = null;

		return extensionsDelta;
	}

	public containsExtension(extensionId: ExtensionIdentifier): boolean {
		for (const myExtensionId of this._myExtensions) {
			if (ExtensionIdentifier.equals(myExtensionId, extensionId)) {
				return true;
			}
		}
		return false;
	}

	public containsActivationEvent(activationEvent: string): boolean {
		if (!this._myActivationEvents) {
			this._myActivationEvents = this._readMyActivationEvents();
		}
		return this._myActivationEvents.has(activationEvent);
	}

	private _readMyActivationEvents(): Set<string> {
		const result = new Set<string>();

		for (const extensionDescription of this._allExtensions) {
			if (!this.containsExtension(extensionDescription.identifier)) {
				continue;
			}

			const activationEvents = ImplicitActivationEvents.readActivationEvents(extensionDescription);
			for (const activationEvent of activationEvents) {
				result.add(activationEvent);
			}
		}

		return result;
	}
}

function extensionDescriptionArrayToMap(extensions: IExtensionDescription[]): ExtensionIdentifierMap<IExtensionDescription> {
	const result = new ExtensionIdentifierMap<IExtensionDescription>();
	for (const extension of extensions) {
		result.set(extension.identifier, extension);
	}
	return result;
}

export function isProposedApiEnabled(extension: IExtensionDescription, proposal: ApiProposalName): boolean {
	if (!extension.enabledApiProposals) {
		return false;
	}
	let enabled = extension.enabledApiProposals.includes(proposal);
	if (!enabled && _proposedApiEnabledResolver?.(extension, proposal)) {
		enabled = true;
	}
	if (!enabled) {
		reportDisabledProposedApiUsage(extension, proposal);
	}
	return enabled;
}

export interface IProposedApiUsage {
	readonly extensionId: string;
	readonly proposalName: ApiProposalName;
}

type ProposedApiUsageReporter = (usage: IProposedApiUsage) => void;

let _proposedApiUsageReporter: ProposedApiUsageReporter | undefined;
const _reportedProposedApiUsages = new Set<string>();

export function setProposedApiUsageReporter(reporter: ProposedApiUsageReporter): IDisposable {
	_proposedApiUsageReporter = reporter;
	return toDisposable(() => {
		if (_proposedApiUsageReporter === reporter) {
			_proposedApiUsageReporter = undefined;
		}
	});
}

function reportDisabledProposedApiUsage(extension: IExtensionDescription, proposal: ApiProposalName): void {
	const reporter = _proposedApiUsageReporter;
	if (!reporter) {
		return;
	}
	const key = `${ExtensionIdentifier.toKey(extension.identifier)}/${proposal}`;
	if (_reportedProposedApiUsages.has(key)) {
		return;
	}
	_reportedProposedApiUsages.add(key);
	reporter({ extensionId: extension.identifier.value, proposalName: proposal });
}

type ProposedApiEnabledResolver = (extension: IExtensionDescription, proposal: ApiProposalName) => boolean;

let _proposedApiEnabledResolver: ProposedApiEnabledResolver | undefined;

export const enabledApiProposalsFallbackExperimentName = 'extensionEnabledApiProposalsFallback';

export const enabledApiProposalsFallbackNone = 'none';

export async function resolveEnabledApiProposalsFallbackExperiment(assignmentService: IAssignmentService, quality: string | undefined): Promise<string | undefined> {
	if (quality !== 'stable') {
		return undefined;
	}
	try {
		return await raceTimeout(assignmentService.getTreatment<string>(enabledApiProposalsFallbackExperimentName), 5000);
	} catch {
		return undefined;
	}
}

export function setEnabledApiProposalsFallbackExperiment(value: string | undefined, quality: string | undefined): IDisposable {
	if (quality !== 'stable') {
		return Disposable.None;
	}

	const allowed = new Set<string>();
	if (value !== undefined && value !== enabledApiProposalsFallbackNone) {
		for (const entry of value.split(',')) {
			const trimmed = entry.trim();
			const idx = trimmed.indexOf(':');
			if (idx <= 0 || idx === trimmed.length - 1) {
				continue;
			}
			const extensionId = ExtensionIdentifier.toKey(trimmed.slice(0, idx));
			const proposal = trimmed.slice(idx + 1);
			allowed.add(`${extensionId}:${proposal}`);
		}
	}

	const resolver: ProposedApiEnabledResolver = value === undefined
		? () => true
		: (extension, proposal) => allowed.has(`${ExtensionIdentifier.toKey(extension.identifier)}:${proposal}`);
	_proposedApiEnabledResolver = resolver;
	return toDisposable(() => {
		if (_proposedApiEnabledResolver === resolver) {
			_proposedApiEnabledResolver = undefined;
		}
	});
}

export function checkProposedApiEnabled(extension: IExtensionDescription, proposal: ApiProposalName): void {
	if (!isProposedApiEnabled(extension, proposal)) {
		throw new Error(`Extension '${extension.identifier.value}' CANNOT use API proposal: ${proposal}.\nIts package.json#enabledApiProposals-property declares: ${extension.enabledApiProposals?.join(', ') ?? '[]'} but NOT ${proposal}.\n The missing proposal MUST be added and you must start in extension development mode or use the following command line switch: --enable-proposed-api ${extension.identifier.value}`);
	}
}


export type ProfileSegmentId = string | 'idle' | 'program' | 'gc' | 'self';

export interface ExtensionActivationReason {
	readonly startup: boolean;
	readonly extensionId: ExtensionIdentifier;
	readonly activationEvent: string;
}

export class ActivationTimes {
	constructor(
		public readonly codeLoadingTime: number,
		public readonly activateCallTime: number,
		public readonly activateResolvedTime: number,
		public readonly activationReason: ExtensionActivationReason
	) {
	}
}

export class ExtensionPointContribution<T> {
	readonly description: IExtensionDescription;
	readonly value: T;

	constructor(description: IExtensionDescription, value: T) {
		this.description = description;
		this.value = value;
	}
}

export interface IWillActivateEvent {
	readonly event: string;
	readonly activation: Promise<void>;
	readonly activationKind: ActivationKind;
}

export interface IResponsiveStateChangeEvent {
	extensionHostKind: ExtensionHostKind;
	isResponsive: boolean;
	getInspectListener(tryEnableInspector: boolean): Promise<IExtensionInspectInfo | undefined>;
}

export const enum ActivationKind {
	Normal = 0,
	Immediate = 1
}

export interface WillStopExtensionHostsEvent {

	readonly reason: string;

	readonly auto: boolean;

	veto(value: boolean | Promise<boolean>, reason: string): void;
}

export interface IExtensionService {
	readonly _serviceBrand: undefined;

	readonly onDidRegisterExtensions: Event<void>;

	readonly onDidChangeExtensionsStatus: Event<ExtensionIdentifier[]>;

	readonly onDidChangeExtensions: Event<{ readonly added: readonly IExtensionDescription[]; readonly removed: readonly IExtensionDescription[] }>;

	readonly extensions: readonly IExtensionDescription[];

	readonly onWillActivateByEvent: Event<IWillActivateEvent>;

	readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent>;

	readonly onWillStop: Event<WillStopExtensionHostsEvent>;

	activateByEvent(activationEvent: string, activationKind?: ActivationKind): Promise<void>;

	activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void>;

	activationEventIsDone(activationEvent: string): boolean;

	whenInstalledExtensionsRegistered(): Promise<boolean>;

	getExtension(id: string): Promise<IExtensionDescription | undefined>;

	canAddExtension(extension: IExtensionDescription): boolean;

	canRemoveExtension(extension: IExtensionDescription): boolean;

	readExtensionPointContributions<T extends IExtensionContributions[keyof IExtensionContributions]>(extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]>;

	getExtensionsStatus(): { [id: string]: IExtensionsStatus };

	getInspectPorts(extensionHostKind: ExtensionHostKind, tryEnableInspector: boolean): Promise<IExtensionInspectInfo[]>;

	stopExtensionHosts(reason: string, auto?: boolean): Promise<boolean>;

	startExtensionHosts(updates?: { readonly toAdd: readonly IExtension[]; readonly toRemove: readonly string[] }): Promise<void>;

	setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void>;
}

export interface IInternalExtensionService {
	_activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void>;
	_onWillActivateExtension(extensionId: ExtensionIdentifier): void;
	_onDidActivateExtension(extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void;
	_onDidActivateExtensionError(extensionId: ExtensionIdentifier, error: Error): void;
	_onExtensionRuntimeError(extensionId: ExtensionIdentifier, err: Error): void;
}

export interface ProfileSession {
	stop(): Promise<IExtensionHostProfile>;
}

export function toExtension(extensionDescription: IExtensionDescription): IExtension {
	return {
		type: extensionDescription.isBuiltin ? ExtensionType.System : ExtensionType.User,
		isBuiltin: extensionDescription.isBuiltin || extensionDescription.isUserBuiltin,
		identifier: { id: getGalleryExtensionId(extensionDescription.publisher, extensionDescription.name), uuid: extensionDescription.uuid },
		manifest: extensionDescription,
		location: extensionDescription.extensionLocation,
		targetPlatform: extensionDescription.targetPlatform,
		validations: [],
		isValid: true,
		preRelease: extensionDescription.preRelease,
		publisherDisplayName: extensionDescription.publisherDisplayName,
	};
}

export function toExtensionDescription(extension: IExtension, isUnderDevelopment?: boolean): IExtensionDescription {
	const id = getExtensionId(extension.manifest.publisher, extension.manifest.name);
	return {
		id,
		identifier: new ExtensionIdentifier(id),
		isBuiltin: extension.type === ExtensionType.System,
		isUserBuiltin: extension.type === ExtensionType.User && extension.isBuiltin,
		isUnderDevelopment: !!isUnderDevelopment,
		extensionLocation: extension.location,
		uuid: extension.identifier.uuid,
		targetPlatform: extension.targetPlatform,
		publisherDisplayName: extension.publisherDisplayName,
		preRelease: extension.preRelease,
		...extension.manifest
	};
}


export class NullExtensionService implements IExtensionService {
	declare readonly _serviceBrand: undefined;
	readonly onDidRegisterExtensions: Event<void> = Event.None;
	readonly onDidChangeExtensionsStatus: Event<ExtensionIdentifier[]> = Event.None;
	onDidChangeExtensions = Event.None;
	readonly onWillActivateByEvent: Event<IWillActivateEvent> = Event.None;
	readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent> = Event.None;
	readonly onWillStop: Event<WillStopExtensionHostsEvent> = Event.None;
	readonly extensions = [];
	activateByEvent(_activationEvent: string): Promise<void> { return Promise.resolve(undefined); }
	activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> { return Promise.resolve(undefined); }
	activationEventIsDone(_activationEvent: string): boolean { return false; }
	whenInstalledExtensionsRegistered(): Promise<boolean> { return Promise.resolve(true); }
	getExtension() { return Promise.resolve(undefined); }
	readExtensionPointContributions<T>(_extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]> { return Promise.resolve(Object.create(null)); }
	getExtensionsStatus(): { [id: string]: IExtensionsStatus } { return Object.create(null); }
	getInspectPorts(_extensionHostKind: ExtensionHostKind, _tryEnableInspector: boolean): Promise<IExtensionInspectInfo[]> { return Promise.resolve([]); }
	async stopExtensionHosts(): Promise<boolean> { return true; }
	async startExtensionHosts(): Promise<void> { }
	async setRemoteEnvironment(_env: { [key: string]: string | null }): Promise<void> { }
	canAddExtension(): boolean { return false; }
	canRemoveExtension(): boolean { return false; }
}
