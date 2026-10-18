/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ITunnelProxyInfo } from '../../tunnel/common/tunnelProxy.js';
import { IPermissionCategoryState, ISerializedBrowserPermissionsSnapshot, IBrowserDeviceCandidate, BrowserDeviceType, PermissionCategory } from './browserPermissions.js';
import type { IntegratedBrowserOpenSource } from './browserViewTelemetry.js';

const commandPrefix = 'workbench.action.browser';
export enum BrowserViewCommandId {
	Open = `${commandPrefix}.open`,
	OpenFile = `${commandPrefix}.openFile`,
	NewTab = `${commandPrefix}.newTab`,
	QuickOpen = `${commandPrefix}.quickOpen`,
	OpenOrList = `${commandPrefix}.openOrList`,
	CloseAll = `${commandPrefix}.closeAll`,
	CloseAllInGroup = `${commandPrefix}.closeAllInGroup`,

	GoBack = `${commandPrefix}.goBack`,
	GoForward = `${commandPrefix}.goForward`,
	Reload = `${commandPrefix}.reload`,
	HardReload = `${commandPrefix}.hardReload`,

	FocusUrlInput = `${commandPrefix}.focusUrlInput`,
	OpenExternal = `${commandPrefix}.openExternal`,
	OpenSettings = `${commandPrefix}.openSettings`,

	ToggleFavorite = `${commandPrefix}.toggleFavorite`,

	ShowHistory = `${commandPrefix}.showHistory`,

	ManagePermissions = `${commandPrefix}.managePermissions`,

	AddElementToChat = `${commandPrefix}.addElementToChat`,
	AddElementCommentToChat = `${commandPrefix}.addElementCommentToChat`,
	AddConsoleLogsToChat = `${commandPrefix}.addConsoleLogsToChat`,
	AddScreenshotToChat = `${commandPrefix}.addScreenshotToChat`,
	AddAreaScreenshotToChat = `${commandPrefix}.addAreaScreenshotToChat`,
	AddFullPageScreenshotToChat = `${commandPrefix}.addFullPageScreenshotToChat`,

	ToggleDevTools = `${commandPrefix}.toggleDevTools`,

	ClearGlobalStorage = `${commandPrefix}.clearGlobalStorage`,
	ClearWorkspaceStorage = `${commandPrefix}.clearWorkspaceStorage`,
	ClearEphemeralStorage = `${commandPrefix}.clearEphemeralStorage`,
	ClearAgentStorage = `${commandPrefix}.clearAgentStorage`,

	ShowFind = `${commandPrefix}.showFind`,
	HideFind = `${commandPrefix}.hideFind`,
	FindNext = `${commandPrefix}.findNext`,
	FindPrevious = `${commandPrefix}.findPrevious`,
}

export interface IElementAncestor {
	readonly tagName: string;
	readonly id?: string;
	readonly classNames?: string[];
}

export enum BrowserElementSelectionMode {
	Select = 'select',
	Comment = 'comment'
}

export interface IBrowserElementSelectionOptions {
	readonly highlightFocusedElement?: boolean;
	readonly continuous?: boolean;
	readonly mode?: BrowserElementSelectionMode;
}

export interface IBrowserElementSelectionState {
	readonly active: boolean;
	readonly options: IBrowserElementSelectionOptions;
}

export interface IElementData {
	readonly url?: string;
	readonly elementId?: string;
	readonly comment?: string;
	readonly outerHTML: string;
	readonly computedStyle: string;
	readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly ancestors?: IElementAncestor[];
	readonly attributes?: Record<string, string>;
	readonly computedStyles?: Record<string, string>;
	readonly dimensions?: { readonly top: number; readonly left: number; readonly width: number; readonly height: number };
	readonly innerText?: string;
}

export interface IBrowserElementComment {
	readonly elementId: string;
	readonly body: string;
}

export interface IBrowserElementCommentsUpdate {
	readonly comments?: readonly IBrowserElementComment[];
	readonly pendingCommentIdsToDiscard?: readonly string[];
}

export interface IBrowserViewRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface IBrowserViewPreloadLocalizedStrings {
	readonly addComment: string;
	readonly addCommentPlaceholder: string;
	readonly commentOnSelectedElement: string;
	readonly elementComment: string;
	readonly elementCommentWithBody: string;
	readonly emptyElementComment: string;
	readonly removeComment: string;
	readonly removeElementComment: string;
}

export interface IBrowserViewTheme {
	readonly focusBorder?: string;
	readonly buttonBackground?: string;
	readonly buttonForeground?: string;
	readonly widgetBackground?: string;
	readonly widgetForeground?: string;
	readonly widgetBorder?: string;
	readonly widgetShadow?: string;
	readonly contrastBorder?: string;
	readonly descriptionForeground?: string;
	readonly inputPlaceholderForeground?: string;
	readonly toolbarHoverBackground?: string;
	readonly font?: string;
	readonly reducedMotion?: boolean;
}

export interface IBrowserViewWindowConfiguration {
	readonly theme: IBrowserViewTheme;
	readonly keybindings: { [commandId: string]: string };

	readonly aiFeaturesDisabled?: boolean;
	readonly maxHistoryEntries?: number;
	readonly proxyInfo?: ITunnelProxyInfo;
	readonly trustedFileRoots: readonly string[];
	readonly trustAllFiles: boolean;
}

export interface IBrowserViewBounds {
	windowId: number;
	x: number;
	y: number;
	width: number;
	height: number;
	zoomFactor: number;
	cornerRadius: number;
	emulation?: {
		scale: number;
	};
}

export interface IBrowserViewCaptureScreenshotOptions {
	quality?: number;
	format?: 'jpeg' | 'png';
	screenRect?: IBrowserViewRect;
	pageRect?: IBrowserViewRect;
	fullPage?: boolean;
	awaitNextPaint?: boolean;
}

export type IBrowserViewOwner =
	| { readonly type: 'user'; readonly mainWindowId?: number }
	| { readonly type: 'agent'; readonly sessionId: string; readonly mainWindowId?: number };

export interface IBrowserViewAgentAudience {
	readonly type: 'agent';
	readonly sessionId?: string;
}

export type IBrowserViewAudience = IBrowserViewAgentAudience;

export function equalsBrowserViewAudience(first: IBrowserViewAudience, second: IBrowserViewAudience): boolean {
	return first.type === second.type
		&& first.sessionId === second.sessionId;
}

export function matchesBrowserViewAudience(candidate: IBrowserViewAudience, pattern: IBrowserViewAudience): boolean {
	return candidate.type === pattern.type
		&& (pattern.sessionId === undefined || pattern.sessionId === candidate.sessionId);
}

export interface IBrowserViewHost {
	readonly windowId: number;
	readonly sessionId?: string;
}

export interface IBrowserViewInfo {
	readonly id: string;
	readonly host: IBrowserViewHost;
	readonly owner: IBrowserViewOwner;
	readonly associatedResource?: UriComponents;
	readonly state: IBrowserViewState;
}

export interface IBrowserViewEditorOpenOptions {
	readonly preserveFocus?: boolean;
	readonly background?: boolean;
	readonly pinned?: boolean;
	readonly parentViewId?: string;
	readonly auxiliaryWindow?: { x?: number; y?: number; width?: number; height?: number };
}

export interface IBrowserViewCreatedEvent {
	readonly info: IBrowserViewInfo;
	readonly initialUrl?: string;
	readonly editorOpenRequest?: IBrowserViewEditorOpenOptions;
}

export interface IBrowserViewCreationContext {
	readonly host: IBrowserViewHost;
	readonly owner: IBrowserViewOwner;
	readonly session: BrowserViewSessionSelector;
	readonly initialAudiences?: readonly IBrowserViewAudience[];
}

export interface IBrowserViewCreateOptions extends IBrowserViewCreationContext {
	readonly associatedResource?: UriComponents;
	readonly initialUrl?: string;
	readonly openSource?: IntegratedBrowserOpenSource;
}

export function isBrowserViewAssociatedResourceNavigation(associatedResource: URI, target: string): boolean {
	const targetResource = URI.parse(target);
	return extUriBiasedIgnorePathCase.isEqual(
		associatedResource.with({ query: null, fragment: null }),
		targetResource.with({ query: null, fragment: null })
	);
}

export interface IBrowserViewStorageKeys {
	readonly history?: string;
	readonly favicons?: string;
	readonly permissions?: string;
}

export interface IBrowserViewState {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	focused: boolean;
	visible: boolean;
	isDevToolsOpen: boolean;
	lastScreenshot: VSBuffer | undefined;
	lastFavicon: string | undefined;
	lastError: IBrowserViewLoadError | undefined;
	certificateError: IBrowserViewCertificateError | undefined;
	storageScope: BrowserViewStorageScope;
	storageKeys: IBrowserViewStorageKeys;
	permissions: ISerializedBrowserPermissionsSnapshot;
	browserZoomIndex: number;
	elementSelectionState: IBrowserElementSelectionState;
	isRemoteSession: boolean;
	isAreaSelectionActive: boolean;
	device: IBrowserDeviceProfile | undefined;
	audiences: IBrowserViewAudience[];
}

export interface IBrowserViewNavigationEvent {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	certificateError: IBrowserViewCertificateError | undefined;
}

export interface IBrowserViewLoadingEvent {
	loading: boolean;
	error?: IBrowserViewLoadError;
}

export interface IBrowserViewLoadError {
	url: string;
	errorCode: number;
	errorDescription: string;
	certificateError?: IBrowserViewCertificateError;
}

export interface IBrowserViewCertificateError {
	host: string;
	fingerprint: string;
	error: string;
	url: string;
	hasTrustedException: boolean;
	issuerName: string;
	subjectName: string;
	validStart: number;
	validExpiry: number;
}

export interface IBrowserViewFocusEvent {
	focused: boolean;
}

export interface IBrowserViewVisibilityEvent {
	visible: boolean;
}

export interface IBrowserViewDevToolsStateEvent {
	isDevToolsOpen: boolean;
}

export interface IBrowserViewKeyDownEvent {
	key: string;
	keyCode: number;
	code: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	repeat: boolean;
}

export interface IBrowserViewTitleChangeEvent {
	title: string;
}

export interface IBrowserViewFaviconChangeEvent {
	favicon: string | undefined;
}

export interface IBrowserViewPermissionRequestEvent {
	origin: string;
	category: PermissionCategory;
	device?: IBrowserViewDeviceRequest;
}

export interface IBrowserViewDeviceRequest {
	requestId: string;
	deviceType: BrowserDeviceType;
	devices: IBrowserDeviceCandidate[];
}

export interface IBrowserViewFindInPageOptions {
	recompute?: boolean;
	forward?: boolean;
	matchCase?: boolean;
}

export interface IBrowserViewFindInPageResult {
	activeMatchOrdinal: number;
	matches: number;
	selectionArea?: IBrowserViewRect;
	finalUpdate: boolean;
}

export enum BrowserViewStorageScope {
	Global = 'global',
	Workspace = 'workspace',
	Ephemeral = 'ephemeral',
	Agent = 'agent'
}

export type IBrowserViewSessionOptions =
	| { readonly scope: BrowserViewStorageScope.Global }
	| { readonly scope: BrowserViewStorageScope.Workspace }
	| { readonly scope: BrowserViewStorageScope.Ephemeral }
	| {
		readonly scope: BrowserViewStorageScope.Agent;
		readonly affinity?: string;
	};

export type IBrowserSessionOptions = IBrowserViewSessionOptions;

export function isInMemoryStorageScope(scope: BrowserViewStorageScope): boolean {
	return scope === BrowserViewStorageScope.Ephemeral || scope === BrowserViewStorageScope.Agent;
}

export function isBrowserViewStorageScopeShareableWithAgent(scope: BrowserViewStorageScope, networkFilteringEnabled: boolean): boolean {
	return !networkFilteringEnabled || scope === BrowserViewStorageScope.Agent;
}

export type BrowserViewSessionSelector = string | IBrowserViewSessionOptions;

export function getAgentBrowserViewCreationDefaults(sessionId: string, storageAffinity?: string) {
	return {
		owner: { type: 'agent', sessionId } as const,
		initialAudiences: [{ type: 'agent' }] as const,
		session: storageAffinity === undefined
			? { scope: BrowserViewStorageScope.Agent } as const
			: { scope: BrowserViewStorageScope.Agent, affinity: storageAffinity } as const
	};
}

export const ipcBrowserViewChannelName = 'browserView';

export const browserZoomFactors = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export const browserZoomDefaultIndex = browserZoomFactors.indexOf(1);
export function browserZoomLabel(zoomFactor: number): string {
	return localize('browserZoomPercent', "{0}%", Math.round(zoomFactor * 100));
}
export function browserZoomAccessibilityLabel(zoomFactor: number): string {
	return localize('browserZoomAccessibilityLabel', "Page Zoom: {0}%", Math.round(zoomFactor * 100));
}

export interface IBrowserDeviceProfile {
	readonly width?: number;
	readonly height?: number;
	readonly mobile?: boolean;
	readonly userAgent?: string;
	readonly deviceScaleFactor?: number;
}

export const browserViewIsolatedWorldId = 999;

export interface IBrowserViewService {
	onDidCreateBrowserView: Event<IBrowserViewCreatedEvent>;

	onDynamicDidNavigate(id: string): Event<IBrowserViewNavigationEvent>;
	onDynamicDidChangeLoadingState(id: string): Event<IBrowserViewLoadingEvent>;
	onDynamicDidChangeFocus(id: string): Event<IBrowserViewFocusEvent>;
	onDynamicDidChangeVisibility(id: string): Event<IBrowserViewVisibilityEvent>;
	onDynamicDidChangeDevToolsState(id: string): Event<IBrowserViewDevToolsStateEvent>;
	onDynamicDidKeyCommand(id: string): Event<IBrowserViewKeyDownEvent>;
	onDynamicDidChangeTitle(id: string): Event<IBrowserViewTitleChangeEvent>;
	onDynamicDidChangeFavicon(id: string): Event<IBrowserViewFaviconChangeEvent>;
	onDynamicDidChangeOwner(id: string): Event<IBrowserViewOwner>;
	onDynamicDidFindInPage(id: string): Event<IBrowserViewFindInPageResult>;
	onDynamicDidClose(id: string): Event<void>;
	onDynamicDidSelectElement(id: string): Event<IElementData>;
	onDynamicDidRemoveElementComment(id: string): Event<string>;
	onDynamicDidChangeElementSelectionState(id: string): Event<IBrowserElementSelectionState>;
	onDynamicDidPickArea(id: string): Event<IBrowserViewRect | undefined>;
	onDynamicDidChangeAreaSelectionActive(id: string): Event<boolean>;
	onDynamicDidChangeDeviceEmulation(id: string): Event<IBrowserDeviceProfile | undefined>;
	onDynamicDidChangeRemoteStatus(id: string): Event<boolean>;
	onDynamicDidChangeAudiences(id: string): Event<IBrowserViewAudience[]>;
	onDynamicDidRequestPermission(id: string): Event<IBrowserViewPermissionRequestEvent>;
	onDynamicDidChangePermissions(id: string): Event<ISerializedBrowserPermissionsSnapshot>;

	getBrowserViews(windowId?: number): Promise<IBrowserViewInfo[]>;

	getOrCreateBrowserView(id: string, options: IBrowserViewCreateOptions): Promise<IBrowserViewInfo>;

	destroyBrowserView(id: string): Promise<void>;

	setOwner(id: string, owner: IBrowserViewOwner): Promise<void>;

	getState(id: string): Promise<IBrowserViewState>;

	setAudience(id: string, audience: IBrowserViewAudience, enabled: boolean): Promise<void>;

	layout(id: string, bounds: IBrowserViewBounds): Promise<void>;

	setVisible(id: string, visible: boolean): Promise<void>;

	loadURL(id: string, url: string): Promise<void>;

	getURL(id: string): Promise<string>;

	goBack(id: string): Promise<void>;

	goForward(id: string): Promise<void>;

	reload(id: string, hard?: boolean): Promise<void>;

	toggleDevTools(id: string): Promise<void>;

	canGoBack(id: string): Promise<boolean>;

	canGoForward(id: string): Promise<boolean>;

	captureScreenshot(id: string, options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer>;

	focus(id: string, force?: boolean): Promise<void>;

	findInPage(id: string, text: string, options?: IBrowserViewFindInPageOptions): Promise<void>;

	stopFindInPage(id: string, keepSelection?: boolean): Promise<void>;

	getSelectedText(id: string): Promise<string>;

	/**
	 * Clear all storage data for the global browser session
	 */
	clearGlobalStorage(): Promise<void>;

	clearWorkspaceStorage(workspaceId: string): Promise<void>;

	clearStorage(id: string): Promise<void>;

	setBrowserZoomIndex(id: string, zoomIndex: number): Promise<void>;

	setDeviceEmulation(id: string, device: IBrowserDeviceProfile | undefined): Promise<void>;

	trustCertificate(id: string, host: string, fingerprint: string): Promise<void>;

	untrustCertificate(id: string, host: string, fingerprint: string): Promise<void>;

	deleteBrowserHistory(id: string, entryIds?: readonly number[]): Promise<void>;

	setPermissions(id: string, origin: string, grants: readonly IPermissionCategoryState[]): Promise<void>;

	selectDevice(id: string, requestId: string, deviceId: string | null): Promise<void>;

	getConsoleLogs(id: string): Promise<string>;

	toggleElementSelection(id: string, enabled?: boolean, options?: IBrowserElementSelectionOptions): Promise<void>;

	setElementComments(id: string, update: IBrowserElementCommentsUpdate): Promise<void>;

	toggleAreaSelection(id: string, enabled?: boolean): Promise<void>;

	updateWindowConfiguration(windowId: number, config: IBrowserViewWindowConfiguration): Promise<void>;
}
