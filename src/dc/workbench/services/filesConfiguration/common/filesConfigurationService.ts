import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { RawContextKey, IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFilesConfiguration, AutoSaveConfiguration, HotExitConfiguration, FILES_READONLY_INCLUDE_CONFIG, FILES_READONLY_EXCLUDE_CONFIG, IFileStatWithMetadata, IFileService, IBaseFileStat, hasReadonlyCapability, IFilesConfigurationNode } from '../../../../platform/files/common/files.js';
import { equals } from '../../../../base/common/objects.js';
import { URI } from '../../../../base/common/uri.js';
import { isWeb } from '../../../../base/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ResourceGlobMatcher } from '../../../common/resources.js';
import { GlobalIdleValue } from '../../../../base/common/async.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { LRUCache, ResourceMap } from '../../../../base/common/map.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorResourceAccessor, SaveReason, SideBySideEditor } from '../../../common/editor.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IStringDictionary } from '../../../../base/common/collections.js';
export const AutoSaveAfterShortDelayContext = new RawContextKey<boolean>('autoSaveAfterShortDelayContext', false, true);
export interface IAutoSaveConfiguration {
    autoSave?: 'afterDelay' | 'onFocusChange' | 'onWindowChange';
    autoSaveDelay?: number;
    autoSaveWorkspaceFilesOnly?: boolean;
    autoSaveWhenNoErrors?: boolean;
}
interface ICachedAutoSaveConfiguration extends IAutoSaveConfiguration {
    isOutOfWorkspace?: boolean;
    isShortAutoSaveDelay?: boolean;
}
export const enum AutoSaveMode {
    OFF,
    AFTER_SHORT_DELAY,
    AFTER_LONG_DELAY,
    ON_FOCUS_CHANGE,
    ON_WINDOW_CHANGE
}
export const enum AutoSaveDisabledReason {
    SETTINGS = 1,
    OUT_OF_WORKSPACE,
    ERRORS,
    DISABLED
}
export type IAutoSaveMode = IEnabledAutoSaveMode | IDisabledAutoSaveMode;
export interface IEnabledAutoSaveMode {
    readonly mode: AutoSaveMode.AFTER_SHORT_DELAY | AutoSaveMode.AFTER_LONG_DELAY | AutoSaveMode.ON_FOCUS_CHANGE | AutoSaveMode.ON_WINDOW_CHANGE;
}
export interface IDisabledAutoSaveMode {
    readonly mode: AutoSaveMode.OFF;
    readonly reason: AutoSaveDisabledReason;
}
export const IFilesConfigurationService = createDecorator<IFilesConfigurationService>('filesConfigurationService');
export interface IFilesConfigurationService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeAutoSaveConfiguration: Event<void>;
    readonly onDidChangeAutoSaveDisabled: Event<URI>;
    getAutoSaveConfiguration(resourceOrEditor: EditorInput | URI | undefined): IAutoSaveConfiguration;
    hasShortAutoSaveDelay(resourceOrEditor: EditorInput | URI | undefined): boolean;
    getAutoSaveMode(resourceOrEditor: EditorInput | URI | undefined, saveReason?: SaveReason): IAutoSaveMode;
    toggleAutoSave(): Promise<void>;
    enableAutoSaveAfterShortDelay(resourceOrEditor: EditorInput | URI): IDisposable;
    disableAutoSave(resourceOrEditor: EditorInput | URI): IDisposable;
    readonly onDidChangeReadonly: Event<void>;
    isReadonly(resource: URI, stat?: IBaseFileStat): boolean | IMarkdownString;
    updateReadonly(resource: URI, readonly: true | IMarkdownString | false | 'toggle' | 'reset'): Promise<void>;
    updateReadonly(resource: URI[], readonly: true | IMarkdownString | false | 'reset'): Promise<void>;
    readonly onDidChangeFilesAssociation: Event<void>;
    readonly isHotExitEnabled: boolean;
    readonly hotExitConfiguration: string | undefined;
    preventSaveConflicts(resource: URI, language?: string): boolean;
}
export class FilesConfigurationService extends Disposable implements IFilesConfigurationService {
    declare readonly _serviceBrand: undefined;
    private static readonly DEFAULT_AUTO_SAVE_MODE = isWeb ? AutoSaveConfiguration.AFTER_DELAY : AutoSaveConfiguration.OFF;
    private static readonly DEFAULT_AUTO_SAVE_DELAY = 1000;
    private static readonly READONLY_MESSAGES = {
        providerReadonly: { value: localize('providerReadonly', "Editor is read-only because the file system of the file is read-only."), isTrusted: true },
        sessionReadonly: { value: localize({ key: 'sessionReadonly', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because the file was set read-only in this session. [Click here](command:{0}) to set writeable.", 'workbench.action.files.setActiveEditorWriteableInSession'), isTrusted: true },
        configuredReadonly: { value: localize({ key: 'configuredReadonly', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because the file was set read-only via settings. [Click here](command:{0}) to configure or [toggle for this session](command:{1}).", `workbench.action.openSettings?${encodeURIComponent('["files.readonly"]')}`, 'workbench.action.files.toggleActiveEditorReadonlyInSession'), isTrusted: true },
        fileLocked: { value: localize({ key: 'fileLocked', comment: ['Please do not translate the word "command", it is part of our internal syntax which must not change', '{Locked="](command:{0})"}'] }, "Editor is read-only because of file permissions. [Click here](command:{0}) to set writeable anyway.", 'workbench.action.files.setActiveEditorWriteableInSession'), isTrusted: true },
        fileReadonly: { value: localize('fileReadonly', "Editor is read-only because the file is read-only."), isTrusted: true }
    };
    private readonly _onDidChangeAutoSaveConfiguration = this._register(new Emitter<void>());
    readonly onDidChangeAutoSaveConfiguration = this._onDidChangeAutoSaveConfiguration.event;
    private readonly _onDidChangeAutoSaveDisabled = this._register(new Emitter<URI>());
    readonly onDidChangeAutoSaveDisabled = this._onDidChangeAutoSaveDisabled.event;
    private readonly _onDidChangeFilesAssociation = this._register(new Emitter<void>());
    readonly onDidChangeFilesAssociation = this._onDidChangeFilesAssociation.event;
    private readonly _onDidChangeReadonly = this._register(new Emitter<void>({ leakWarningThreshold: 500, leakWarningName: 'FilesConfigurationService._onDidChangeReadonly' }));
    readonly onDidChangeReadonly = this._onDidChangeReadonly.event;
    private currentGlobalAutoSaveConfiguration: IAutoSaveConfiguration;
    private currentFilesAssociationConfiguration: IStringDictionary<string> | undefined;
    private currentHotExitConfiguration: string;
    private readonly autoSaveConfigurationCache = new LRUCache<URI, ICachedAutoSaveConfiguration>(1000);
    private readonly autoSaveAfterShortDelayOverrides = new ResourceMap<number>();
    private readonly autoSaveDisabledOverrides = new ResourceMap<number>();
    private readonly autoSaveAfterShortDelayContext: IContextKey<boolean>;
    private readonly readonlyIncludeMatcher = this._register(new GlobalIdleValue(() => this.createReadonlyMatcher(FILES_READONLY_INCLUDE_CONFIG)));
    private readonly readonlyExcludeMatcher = this._register(new GlobalIdleValue(() => this.createReadonlyMatcher(FILES_READONLY_EXCLUDE_CONFIG)));
    private configuredReadonlyFromPermissions: boolean | undefined;
    private readonly sessionReadonlyOverrides = new ResourceMap<boolean | IMarkdownString>(resource => this.uriIdentityService.extUri.getComparisonKey(resource));
    constructor(
    @IContextKeyService
    contextKeyService: IContextKeyService, 
    @IConfigurationService
    private readonly configurationService: IConfigurationService, 
    @IWorkspaceContextService
    private readonly contextService: IWorkspaceContextService, 
    @IEnvironmentService
    private readonly environmentService: IEnvironmentService, 
    @IUriIdentityService
    private readonly uriIdentityService: IUriIdentityService, 
    @IFileService
    private readonly fileService: IFileService, 
    @IMarkerService
    private readonly markerService: IMarkerService, 
    @ITextResourceConfigurationService
    private readonly textResourceConfigurationService: ITextResourceConfigurationService) {
        super();
        this.autoSaveAfterShortDelayContext = AutoSaveAfterShortDelayContext.bindTo(contextKeyService);
        const configuration = configurationService.getValue<IFilesConfiguration>();
        this.currentGlobalAutoSaveConfiguration = this.computeAutoSaveConfiguration(undefined, configuration.files);
        this.currentFilesAssociationConfiguration = configuration?.files?.associations;
        this.currentHotExitConfiguration = configuration?.files?.hotExit || HotExitConfiguration.ON_EXIT;
        this.onFilesConfigurationChange(configuration, false);
        this.registerListeners();
    }
    private createReadonlyMatcher(config: string) {
        const matcher = this._register(new ResourceGlobMatcher(resource => this.configurationService.getValue(config, { resource }), event => event.affectsConfiguration(config), this.contextService, this.configurationService));
        this._register(matcher.onExpressionChange(() => this._onDidChangeReadonly.fire()));
        return matcher;
    }
    isReadonly(resource: URI, stat?: IBaseFileStat): boolean | IMarkdownString {
        const provider = this.fileService.getProvider(resource.scheme);
        if (provider && hasReadonlyCapability(provider)) {
            return provider.readOnlyMessage ?? FilesConfigurationService.READONLY_MESSAGES.providerReadonly;
        }
        const sessionReadonlyOverride = this.sessionReadonlyOverrides.get(resource);
        if (typeof sessionReadonlyOverride === 'boolean') {
            return sessionReadonlyOverride === true ? FilesConfigurationService.READONLY_MESSAGES.sessionReadonly : false;
        }
        if (sessionReadonlyOverride !== undefined) {
            return sessionReadonlyOverride;
        }
        if (this.uriIdentityService.extUri.isEqualOrParent(resource, this.environmentService.userRoamingDataHome) ||
            this.uriIdentityService.extUri.isEqual(resource, this.contextService.getWorkspace().configuration ?? undefined)) {
            return false;
        }
        if (this.readonlyIncludeMatcher.value.matches(resource)) {
            return !this.readonlyExcludeMatcher.value.matches(resource) ? FilesConfigurationService.READONLY_MESSAGES.configuredReadonly : false;
        }
        if (this.configuredReadonlyFromPermissions && stat?.locked) {
            return FilesConfigurationService.READONLY_MESSAGES.fileLocked;
        }
        if (stat?.readonly) {
            return FilesConfigurationService.READONLY_MESSAGES.fileReadonly;
        }
        return false;
    }
    async updateReadonly(resource: URI | URI[], readonly: true | IMarkdownString | false | 'toggle' | 'reset'): Promise<void> {
        if (Array.isArray(resource)) {
            for (const r of resource) {
                this.applyReadonly(r, readonly as true | IMarkdownString | false | 'reset');
            }
            if (resource.length > 0) {
                this._onDidChangeReadonly.fire();
            }
            return;
        }
        if (readonly === 'toggle') {
            let stat: IFileStatWithMetadata | undefined = undefined;
            try {
                stat = await this.fileService.resolve(resource, { resolveMetadata: true });
            }
            catch (error) {
            }
            readonly = !this.isReadonly(resource, stat);
        }
        this.applyReadonly(resource, readonly);
        this._onDidChangeReadonly.fire();
    }
    private applyReadonly(resource: URI, readonly: true | IMarkdownString | false | 'reset'): void {
        if (readonly === 'reset') {
            this.sessionReadonlyOverrides.delete(resource);
        }
        else {
            this.sessionReadonlyOverrides.set(resource, readonly);
        }
    }
    private registerListeners(): void {
        this._register(this.configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('files')) {
                this.onFilesConfigurationChange(this.configurationService.getValue<IFilesConfiguration>(), true);
            }
        }));
    }
    protected onFilesConfigurationChange(configuration: IFilesConfiguration, fromEvent: boolean): void {
        this.currentGlobalAutoSaveConfiguration = this.computeAutoSaveConfiguration(undefined, configuration.files);
        this.autoSaveConfigurationCache.clear();
        this.autoSaveAfterShortDelayContext.set(this.getAutoSaveMode(undefined).mode === AutoSaveMode.AFTER_SHORT_DELAY);
        if (fromEvent) {
            this._onDidChangeAutoSaveConfiguration.fire();
        }
        const filesAssociation = configuration?.files?.associations;
        if (!equals(this.currentFilesAssociationConfiguration, filesAssociation)) {
            this.currentFilesAssociationConfiguration = filesAssociation;
            if (fromEvent) {
                this._onDidChangeFilesAssociation.fire();
            }
        }
        const hotExitMode = configuration?.files?.hotExit;
        if (hotExitMode === HotExitConfiguration.OFF || hotExitMode === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
            this.currentHotExitConfiguration = hotExitMode;
        }
        else {
            this.currentHotExitConfiguration = HotExitConfiguration.ON_EXIT;
        }
        const readonlyFromPermissions = Boolean(configuration?.files?.readonlyFromPermissions);
        if (readonlyFromPermissions !== Boolean(this.configuredReadonlyFromPermissions)) {
            this.configuredReadonlyFromPermissions = readonlyFromPermissions;
            if (fromEvent) {
                this._onDidChangeReadonly.fire();
            }
        }
    }
    getAutoSaveConfiguration(resourceOrEditor: EditorInput | URI | undefined): ICachedAutoSaveConfiguration {
        const resource = this.toResource(resourceOrEditor);
        if (resource) {
            let resourceAutoSaveConfiguration = this.autoSaveConfigurationCache.get(resource);
            if (!resourceAutoSaveConfiguration) {
                resourceAutoSaveConfiguration = this.computeAutoSaveConfiguration(resource, this.textResourceConfigurationService.getValue<IFilesConfigurationNode>(resource, 'files'));
                this.autoSaveConfigurationCache.set(resource, resourceAutoSaveConfiguration);
            }
            return resourceAutoSaveConfiguration;
        }
        return this.currentGlobalAutoSaveConfiguration;
    }
    private computeAutoSaveConfiguration(resource: URI | undefined, filesConfiguration: IFilesConfigurationNode | undefined): ICachedAutoSaveConfiguration {
        let autoSave: 'afterDelay' | 'onFocusChange' | 'onWindowChange' | undefined;
        let autoSaveDelay: number | undefined;
        let autoSaveWorkspaceFilesOnly: boolean | undefined;
        let autoSaveWhenNoErrors: boolean | undefined;
        let isOutOfWorkspace: boolean | undefined;
        let isShortAutoSaveDelay: boolean | undefined;
        switch (filesConfiguration?.autoSave ?? FilesConfigurationService.DEFAULT_AUTO_SAVE_MODE) {
            case AutoSaveConfiguration.AFTER_DELAY: {
                autoSave = 'afterDelay';
                autoSaveDelay = typeof filesConfiguration?.autoSaveDelay === 'number' && filesConfiguration.autoSaveDelay >= 0 ? filesConfiguration.autoSaveDelay : FilesConfigurationService.DEFAULT_AUTO_SAVE_DELAY;
                isShortAutoSaveDelay = autoSaveDelay <= FilesConfigurationService.DEFAULT_AUTO_SAVE_DELAY;
                break;
            }
            case AutoSaveConfiguration.ON_FOCUS_CHANGE:
                autoSave = 'onFocusChange';
                break;
            case AutoSaveConfiguration.ON_WINDOW_CHANGE:
                autoSave = 'onWindowChange';
                break;
        }
        if (filesConfiguration?.autoSaveWorkspaceFilesOnly === true) {
            autoSaveWorkspaceFilesOnly = true;
            if (resource && !this.contextService.isInsideWorkspace(resource)) {
                isOutOfWorkspace = true;
                isShortAutoSaveDelay = undefined;
            }
        }
        if (filesConfiguration?.autoSaveWhenNoErrors === true) {
            autoSaveWhenNoErrors = true;
            isShortAutoSaveDelay = undefined;
        }
        return {
            autoSave,
            autoSaveDelay,
            autoSaveWorkspaceFilesOnly,
            autoSaveWhenNoErrors,
            isOutOfWorkspace,
            isShortAutoSaveDelay
        };
    }
    private toResource(resourceOrEditor: EditorInput | URI | undefined): URI | undefined {
        if (resourceOrEditor instanceof EditorInput) {
            return EditorResourceAccessor.getOriginalUri(resourceOrEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
        }
        return resourceOrEditor;
    }
    hasShortAutoSaveDelay(resourceOrEditor: EditorInput | URI | undefined): boolean {
        const resource = this.toResource(resourceOrEditor);
        if (resource && this.autoSaveAfterShortDelayOverrides.has(resource)) {
            return true;
        }
        if (this.getAutoSaveConfiguration(resource).isShortAutoSaveDelay) {
            return !resource || !this.autoSaveDisabledOverrides.has(resource);
        }
        return false;
    }
    getAutoSaveMode(resourceOrEditor: EditorInput | URI | undefined, saveReason?: SaveReason): IAutoSaveMode {
        const resource = this.toResource(resourceOrEditor);
        if (resource && this.autoSaveAfterShortDelayOverrides.has(resource)) {
            return { mode: AutoSaveMode.AFTER_SHORT_DELAY };
        }
        if (resource && this.autoSaveDisabledOverrides.has(resource)) {
            return { mode: AutoSaveMode.OFF, reason: AutoSaveDisabledReason.DISABLED };
        }
        const autoSaveConfiguration = this.getAutoSaveConfiguration(resource);
        if (typeof autoSaveConfiguration.autoSave === 'undefined') {
            return { mode: AutoSaveMode.OFF, reason: AutoSaveDisabledReason.SETTINGS };
        }
        if (typeof saveReason === 'number') {
            if ((autoSaveConfiguration.autoSave === 'afterDelay' && saveReason !== SaveReason.AUTO) ||
                (autoSaveConfiguration.autoSave === 'onFocusChange' && saveReason !== SaveReason.FOCUS_CHANGE && saveReason !== SaveReason.WINDOW_CHANGE) ||
                (autoSaveConfiguration.autoSave === 'onWindowChange' && saveReason !== SaveReason.WINDOW_CHANGE)) {
                return { mode: AutoSaveMode.OFF, reason: AutoSaveDisabledReason.SETTINGS };
            }
        }
        if (resource) {
            if (autoSaveConfiguration.autoSaveWorkspaceFilesOnly && autoSaveConfiguration.isOutOfWorkspace) {
                return { mode: AutoSaveMode.OFF, reason: AutoSaveDisabledReason.OUT_OF_WORKSPACE };
            }
            if (autoSaveConfiguration.autoSaveWhenNoErrors && this.markerService.read({ resource, take: 1, severities: MarkerSeverity.Error }).length > 0) {
                return { mode: AutoSaveMode.OFF, reason: AutoSaveDisabledReason.ERRORS };
            }
        }
        switch (autoSaveConfiguration.autoSave) {
            case 'afterDelay':
                if (typeof autoSaveConfiguration.autoSaveDelay === 'number' && autoSaveConfiguration.autoSaveDelay <= FilesConfigurationService.DEFAULT_AUTO_SAVE_DELAY) {
                    return { mode: autoSaveConfiguration.autoSaveWhenNoErrors ? AutoSaveMode.AFTER_LONG_DELAY : AutoSaveMode.AFTER_SHORT_DELAY };
                }
                return { mode: AutoSaveMode.AFTER_LONG_DELAY };
            case 'onFocusChange':
                return { mode: AutoSaveMode.ON_FOCUS_CHANGE };
            case 'onWindowChange':
                return { mode: AutoSaveMode.ON_WINDOW_CHANGE };
        }
    }
    async toggleAutoSave(): Promise<void> {
        const currentSetting = this.configurationService.getValue('files.autoSave');
        let newAutoSaveValue: string;
        if ([AutoSaveConfiguration.AFTER_DELAY, AutoSaveConfiguration.ON_FOCUS_CHANGE, AutoSaveConfiguration.ON_WINDOW_CHANGE].some(setting => setting === currentSetting)) {
            newAutoSaveValue = AutoSaveConfiguration.OFF;
        }
        else {
            newAutoSaveValue = AutoSaveConfiguration.AFTER_DELAY;
        }
        return this.configurationService.updateValue('files.autoSave', newAutoSaveValue);
    }
    enableAutoSaveAfterShortDelay(resourceOrEditor: EditorInput | URI): IDisposable {
        const resource = this.toResource(resourceOrEditor);
        if (!resource) {
            return Disposable.None;
        }
        const counter = this.autoSaveAfterShortDelayOverrides.get(resource) ?? 0;
        this.autoSaveAfterShortDelayOverrides.set(resource, counter + 1);
        return toDisposable(() => {
            const counter = this.autoSaveAfterShortDelayOverrides.get(resource) ?? 0;
            if (counter <= 1) {
                this.autoSaveAfterShortDelayOverrides.delete(resource);
            }
            else {
                this.autoSaveAfterShortDelayOverrides.set(resource, counter - 1);
            }
        });
    }
    disableAutoSave(resourceOrEditor: EditorInput | URI): IDisposable {
        const resource = this.toResource(resourceOrEditor);
        if (!resource) {
            return Disposable.None;
        }
        const counter = this.autoSaveDisabledOverrides.get(resource) ?? 0;
        this.autoSaveDisabledOverrides.set(resource, counter + 1);
        if (counter === 0) {
            this._onDidChangeAutoSaveDisabled.fire(resource);
        }
        return toDisposable(() => {
            const counter = this.autoSaveDisabledOverrides.get(resource) ?? 0;
            if (counter <= 1) {
                this.autoSaveDisabledOverrides.delete(resource);
                this._onDidChangeAutoSaveDisabled.fire(resource);
            }
            else {
                this.autoSaveDisabledOverrides.set(resource, counter - 1);
            }
        });
    }
    get isHotExitEnabled(): boolean {
        if (this.contextService.getWorkspace().transient) {
            return false;
        }
        return this.currentHotExitConfiguration !== HotExitConfiguration.OFF;
    }
    get hotExitConfiguration(): string {
        return this.currentHotExitConfiguration;
    }
    preventSaveConflicts(resource: URI, language?: string): boolean {
        return this.configurationService.getValue('files.saveConflictResolution', { resource, overrideIdentifier: language }) !== 'overwriteFileOnDisk';
    }
}
registerSingleton(IFilesConfigurationService, FilesConfigurationService, InstantiationType.Eager);
