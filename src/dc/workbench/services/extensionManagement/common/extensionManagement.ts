/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator, refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtension, ExtensionType, IExtensionManifest, IExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IExtensionManagementService, IGalleryExtension, ILocalExtension, InstallOptions, InstallExtensionEvent, DidUninstallExtensionEvent, InstallExtensionResult, Metadata, UninstallExtensionEvent, DidUpdateExtensionMetadata, InstallExtensionInfo } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { URI } from '../../../../base/common/uri.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';

export type DidChangeProfileEvent = { readonly added: ILocalExtension[]; readonly removed: ILocalExtension[] };

export const IProfileAwareExtensionManagementService = refineServiceDecorator<IExtensionManagementService, IProfileAwareExtensionManagementService>(IExtensionManagementService);
export interface IProfileAwareExtensionManagementService extends IExtensionManagementService {
	readonly onProfileAwareDidInstallExtensions: Event<readonly InstallExtensionResult[]>;
	readonly onProfileAwareDidUninstallExtension: Event<DidUninstallExtensionEvent>;
	readonly onProfileAwareDidUpdateExtensionMetadata: Event<DidUpdateExtensionMetadata>;
	readonly onDidChangeProfile: Event<DidChangeProfileEvent>;
}

export interface IExtensionManagementServer {
	readonly id: string;
	readonly label: string;
	readonly extensionManagementService: IProfileAwareExtensionManagementService;
}

export const enum ExtensionInstallLocation {
	Local = 1,
	Remote,
	Web
}

export const IExtensionManagementServerService = createDecorator<IExtensionManagementServerService>('extensionManagementServerService');
export interface IExtensionManagementServerService {
	readonly _serviceBrand: undefined;
	readonly localExtensionManagementServer: IExtensionManagementServer | null;
	readonly remoteExtensionManagementServer: IExtensionManagementServer | null;
	readonly webExtensionManagementServer: IExtensionManagementServer | null;
	getExtensionManagementServer(extension: IExtension): IExtensionManagementServer | null;
	getExtensionInstallLocation(extension: IExtension): ExtensionInstallLocation | null;
}

export interface IResourceExtension {
	readonly type: 'resource';
	readonly identifier: IExtensionIdentifier;
	readonly location: URI;
	readonly manifest: IExtensionManifest;
	readonly readmeUri?: URI;
	readonly changelogUri?: URI;
}

export type InstallExtensionOnServerEvent = InstallExtensionEvent & { server: IExtensionManagementServer };
export type UninstallExtensionOnServerEvent = UninstallExtensionEvent & { server: IExtensionManagementServer };
export type DidUninstallExtensionOnServerEvent = DidUninstallExtensionEvent & { server: IExtensionManagementServer };
export type DidChangeProfileForServerEvent = DidChangeProfileEvent & { server: IExtensionManagementServer };

export interface IPublisherInfo {
	readonly publisher: string;
	readonly publisherDisplayName: string;
}

export const IWorkbenchExtensionManagementService = refineServiceDecorator<IProfileAwareExtensionManagementService, IWorkbenchExtensionManagementService>(IProfileAwareExtensionManagementService);
export interface IWorkbenchExtensionManagementService extends IProfileAwareExtensionManagementService {
	readonly _serviceBrand: undefined;

	readonly onInstallExtension: Event<InstallExtensionOnServerEvent>;
	readonly onDidInstallExtensions: Event<readonly InstallExtensionResult[]>;
	readonly onUninstallExtension: Event<UninstallExtensionOnServerEvent>;
	readonly onDidUninstallExtension: Event<DidUninstallExtensionOnServerEvent>;
	readonly onDidChangeProfile: Event<DidChangeProfileForServerEvent>;
	readonly onDidEnableExtensions: Event<IExtension[]>;

	readonly onProfileAwareDidInstallExtensions: Event<readonly InstallExtensionResult[]>;
	readonly onProfileAwareDidUninstallExtension: Event<DidUninstallExtensionOnServerEvent>;
	readonly onProfileAwareDidUpdateExtensionMetadata: Event<DidUpdateExtensionMetadata>;

	getExtensions(locations: URI[]): Promise<IResourceExtension[]>;
	getInstalledWorkspaceExtensionLocations(): URI[];
	getInstalledWorkspaceExtensions(includeInvalid: boolean): Promise<ILocalExtension[]>;

	canInstall(extension: IGalleryExtension | IResourceExtension): Promise<true | IMarkdownString>;

	getInstallableServers(extension: IGalleryExtension): Promise<IExtensionManagementServer[]>;
	installVSIX(location: URI, manifest: IExtensionManifest, installOptions?: InstallOptions): Promise<ILocalExtension>;
	installFromGallery(gallery: IGalleryExtension, installOptions?: InstallOptions, servers?: IExtensionManagementServer[]): Promise<ILocalExtension>;
	installFromLocation(location: URI): Promise<ILocalExtension>;
	installResourceExtension(extension: IResourceExtension, installOptions: InstallOptions): Promise<ILocalExtension>;

	updateFromGallery(gallery: IGalleryExtension, extension: ILocalExtension, installOptions?: InstallOptions): Promise<ILocalExtension>;
	updateMetadata(local: ILocalExtension, metadata: Partial<Metadata>): Promise<ILocalExtension>;

	requestPublisherTrust(extensions: InstallExtensionInfo[]): Promise<void>;
	isPublisherTrusted(extension: IGalleryExtension): boolean;
	getTrustedPublishers(): IPublisherInfo[];
	trustPublishers(...publishers: IPublisherInfo[]): void;
	untrustPublishers(...publishers: string[]): void;
}

export const enum EnablementState {
	DisabledByTrustRequirement,
	DisabledByExtensionKind,
	DisabledByEnvironment,
	EnabledByEnvironment,
	DisabledByMalicious,
	DisabledByVirtualWorkspace,
	DisabledByInvalidExtension,
	DisabledByAllowlist,
	DisabledByExtensionDependency,
	DisabledByUnification,
	DisabledGlobally,
	DisabledWorkspace,
	EnabledGlobally,
	EnabledWorkspace
}

export const IWorkbenchExtensionEnablementService = createDecorator<IWorkbenchExtensionEnablementService>('extensionEnablementService');

export interface IWorkbenchExtensionEnablementService {
	readonly _serviceBrand: undefined;

	readonly onEnablementChanged: Event<readonly IExtension[]>;

	getEnablementState(extension: IExtension): EnablementState;

	getEnablementStates(extensions: IExtension[], workspaceTypeOverrides?: { trusted?: boolean }): EnablementState[];

	getDependenciesEnablementStates(extension: IExtension): [IExtension, EnablementState][];

	canChangeEnablement(extension: IExtension): boolean;

	canChangeWorkspaceEnablement(extension: IExtension): boolean;

	isEnabled(extension: IExtension): boolean;

	isEnabledEnablementState(enablementState: EnablementState): boolean;

	isDisabledGlobally(extension: IExtension): boolean;

	setEnablement(extensions: IExtension[], state: EnablementState): Promise<boolean[]>;

	updateExtensionsEnablementsWhenWorkspaceTrustChanges(): Promise<void>;
}

export interface IScannedExtension extends IExtension {
	readonly metadata?: Metadata;
}

export type ScanOptions = { readonly skipInvalidExtensions?: boolean };

export const IWebExtensionsScannerService = createDecorator<IWebExtensionsScannerService>('IWebExtensionsScannerService');
export interface IWebExtensionsScannerService {
	readonly _serviceBrand: undefined;

	scanSystemExtensions(): Promise<IExtension[]>;
	scanUserExtensions(profileLocation: URI, options?: ScanOptions): Promise<IScannedExtension[]>;
	scanExtensionsUnderDevelopment(): Promise<IExtension[]>;
	scanExistingExtension(extensionLocation: URI, extensionType: ExtensionType, profileLocation: URI): Promise<IScannedExtension | null>;

	addExtension(location: URI, metadata: Metadata, profileLocation: URI): Promise<IScannedExtension>;
	addExtensionFromGallery(galleryExtension: IGalleryExtension, metadata: Metadata, profileLocation: URI): Promise<IScannedExtension>;
	removeExtension(extension: IScannedExtension, profileLocation: URI): Promise<void>;
	copyExtensions(fromProfileLocation: URI, toProfileLocation: URI, filter: (extension: IScannedExtension) => boolean): Promise<void>;

	updateMetadata(extension: IScannedExtension, metaData: Partial<Metadata>, profileLocation: URI): Promise<IScannedExtension>;

	scanExtensionManifest(extensionLocation: URI): Promise<IExtensionManifest | null>;
}
