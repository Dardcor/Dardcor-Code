/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAgentNetworkFilterService } from '../../../../../platform/networkFilter/common/networkFilterService.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { registerWorkbenchContribution2, WorkbenchPhase, type IWorkbenchContribution } from '../../../../common/contributions.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IChatContextService } from '../../../chat/browser/contextContrib/chatContextService.js';
import { IChatService } from '../../../chat/common/chatService/chatService.js';
import { ILanguageModelToolsService, ToolDataSource, ToolSet } from '../../../chat/common/tools/languageModelToolsService.js';
import { IBrowserViewWorkbenchService } from '../../common/browserView.js';
import { getBrowserPagesContext } from './browserToolHelpers.js';
import { ClickBrowserTool, ClickBrowserToolData } from './clickBrowserTool.js';
import { DragElementTool, DragElementToolData } from './dragElementTool.js';
import { HandleDialogBrowserTool, HandleDialogBrowserToolData } from './handleDialogBrowserTool.js';
import { HoverElementTool, HoverElementToolData } from './hoverElementTool.js';
import { ListBrowserPagesTool, ListBrowserPagesToolData } from './listBrowserPagesTool.js';
import { NavigateBrowserTool, NavigateBrowserToolData } from './navigateBrowserTool.js';
import { OpenBrowserTool, OpenBrowserToolData } from './openBrowserTool.js';
import { OpenBrowserToolNonAgentic, OpenBrowserToolNonAgenticData } from './openBrowserToolNonAgentic.js';
import { ReadBrowserTool, ReadBrowserToolData } from './readBrowserTool.js';
import { RunPlaywrightCodeTool, RunPlaywrightCodeToolData } from './runPlaywrightCodeTool.js';
import { ScreenshotBrowserTool, ScreenshotBrowserToolData } from './screenshotBrowserTool.js';
import { TypeBrowserTool, TypeBrowserToolData } from './typeBrowserTool.js';
import { ScrollBrowserTool, ScrollBrowserToolData } from './scrollBrowserTool.js';
import { SelectBrowserTool, SelectBrowserToolData } from './selectBrowserTool.js';
import { CheckBrowserTool, CheckBrowserToolData } from './checkBrowserTool.js';
import { PressKeyBrowserTool, PressKeyBrowserToolData } from './pressKeyBrowserTool.js';
import { WaitBrowserTool, WaitBrowserToolData } from './waitBrowserTool.js';
import { EvalBrowserTool, EvalBrowserToolData } from './evalBrowserTool.js';
import { StorageBrowserTool, StorageBrowserToolData } from './storageBrowserTool.js';
import { ConsoleBrowserTool, ConsoleBrowserToolData } from './consoleBrowserTool.js';
import { HighlightBrowserTool, HighlightBrowserToolData } from './highlightBrowserTool.js';
import { InspectBrowserTool, InspectBrowserToolData } from './inspectBrowserTool.js';
import { TabBrowserTool, TabBrowserToolData } from './tabBrowserTool.js';

class BrowserChatAgentToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'browserView.chatAgentTools';
	private static readonly CONTEXT_ID = 'browserView.trackedPages';

	private readonly _toolsStore = this._register(new DisposableStore());
	private readonly _modelListeners = this._register(new DisposableMap<string, DisposableStore>());
	private readonly _browserToolSet: ToolSet;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IChatContextService private readonly chatContextService: IChatContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IBrowserViewWorkbenchService private readonly browserViewService: IBrowserViewWorkbenchService,
		@IAgentNetworkFilterService private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		@IChatService private readonly chatService: IChatService,
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) {
		super();

		this._browserToolSet = this._register(this.toolsService.createToolSet(
			ToolDataSource.Internal,
			'browser',
			'browser',
			{
				icon: Codicon.globe,
				description: localize('browserToolSet.description', 'Open and interact with integrated browser pages'),
			},
		));

		this._updateToolRegistrations();

		this._register(this.browserViewService.onDidChangeSharingAvailable(() => {
			this._updateToolRegistrations();
		}));

		this._register(this.chatService.onDidDisposeSession(e => {
			for (const resource of e.sessionResources) {
				void this.playwrightService.disposeSession(resource.toString()).catch(() => { });
			}
		}));
	}

	private _updateToolRegistrations(): void {
		this._toolsStore.clear();
		this._modelListeners.clearAndDisposeAll();

		if (!this.browserViewService.isSharingAvailable) {
			this._toolsStore.add(this.toolsService.registerTool(OpenBrowserToolNonAgenticData, this.instantiationService.createInstance(OpenBrowserToolNonAgentic)));
			this._toolsStore.add(this._browserToolSet.addTool(OpenBrowserToolNonAgenticData));
			this.chatContextService.updateWorkspaceContextItems(BrowserChatAgentToolsContribution.CONTEXT_ID, []);
			return;
		}

		this._toolsStore.add(this.toolsService.registerTool(OpenBrowserToolData, this.instantiationService.createInstance(OpenBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(ReadBrowserToolData, this.instantiationService.createInstance(ReadBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(ScreenshotBrowserToolData, this.instantiationService.createInstance(ScreenshotBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(NavigateBrowserToolData, this.instantiationService.createInstance(NavigateBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(ClickBrowserToolData, this.instantiationService.createInstance(ClickBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(DragElementToolData, this.instantiationService.createInstance(DragElementTool)));
		this._toolsStore.add(this.toolsService.registerTool(HoverElementToolData, this.instantiationService.createInstance(HoverElementTool)));
		this._toolsStore.add(this.toolsService.registerTool(TypeBrowserToolData, this.instantiationService.createInstance(TypeBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(RunPlaywrightCodeToolData, this.instantiationService.createInstance(RunPlaywrightCodeTool)));
		this._toolsStore.add(this.toolsService.registerTool(HandleDialogBrowserToolData, this.instantiationService.createInstance(HandleDialogBrowserTool)));

		this._toolsStore.add(this.toolsService.registerTool(ScrollBrowserToolData, this.instantiationService.createInstance(ScrollBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(SelectBrowserToolData, this.instantiationService.createInstance(SelectBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(CheckBrowserToolData, this.instantiationService.createInstance(CheckBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(PressKeyBrowserToolData, this.instantiationService.createInstance(PressKeyBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(WaitBrowserToolData, this.instantiationService.createInstance(WaitBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(EvalBrowserToolData, this.instantiationService.createInstance(EvalBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(StorageBrowserToolData, this.instantiationService.createInstance(StorageBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(ConsoleBrowserToolData, this.instantiationService.createInstance(ConsoleBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(HighlightBrowserToolData, this.instantiationService.createInstance(HighlightBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(InspectBrowserToolData, this.instantiationService.createInstance(InspectBrowserTool)));
		this._toolsStore.add(this.toolsService.registerTool(TabBrowserToolData, this.instantiationService.createInstance(TabBrowserTool)));

		this._toolsStore.add(this.toolsService.registerTool(ListBrowserPagesToolData, this.instantiationService.createInstance(ListBrowserPagesTool)));

		this._toolsStore.add(this._browserToolSet.addTool(OpenBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(ReadBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(ScreenshotBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(NavigateBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(ClickBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(DragElementToolData));
		this._toolsStore.add(this._browserToolSet.addTool(HoverElementToolData));
		this._toolsStore.add(this._browserToolSet.addTool(TypeBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(RunPlaywrightCodeToolData));
		this._toolsStore.add(this._browserToolSet.addTool(HandleDialogBrowserToolData));

		this._toolsStore.add(this._browserToolSet.addTool(ScrollBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(SelectBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(CheckBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(PressKeyBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(WaitBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(EvalBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(StorageBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(ConsoleBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(HighlightBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(InspectBrowserToolData));
		this._toolsStore.add(this._browserToolSet.addTool(TabBrowserToolData));

		this._syncModelListeners();
		this._toolsStore.add(this.browserViewService.onDidChangeBrowserViews(() => {
			this._syncModelListeners();
			this._updateBrowserContext();
		}));
		this._toolsStore.add(this.editorService.onDidActiveEditorChange(() => this._updateBrowserContext()));
		this._toolsStore.add(this.editorService.onDidVisibleEditorsChange(() => this._updateBrowserContext()));
		this._toolsStore.add(this.agentNetworkFilterService.onDidChange(() => this._updateBrowserContext()));

		this._updateBrowserContext();
	}

	private _syncModelListeners(): void {
		const views = this.browserViewService.getContextualBrowserViews();
		for (const id of this._modelListeners.keys()) {
			if (!views.has(id)) {
				this._modelListeners.deleteAndDispose(id);
			}
		}
		for (const [id, input] of views) {
			if (!this._modelListeners.has(id) && input.model) {
				const store = new DisposableStore();
				store.add(input.onDidChangeLabel(() => this._updateBrowserContext()));
				store.add(input.model.onDidChangeSharingState(() => this._updateBrowserContext()));
				this._modelListeners.set(id, store);
			}
		}
	}

	private _updateBrowserContext(): void {
		const value = getBrowserPagesContext(this.editorService, this.browserViewService, this.agentNetworkFilterService, { canPromptUser: true });
		if (!value) {
			this.chatContextService.updateWorkspaceContextItems(BrowserChatAgentToolsContribution.CONTEXT_ID, []);
			return;
		}

		this.chatContextService.updateWorkspaceContextItems(BrowserChatAgentToolsContribution.CONTEXT_ID, [{
			handle: 0,
			label: localize('browserContext.label', "Browser Pages"),
			value: value
		}]);
	}
}

registerWorkbenchContribution2(BrowserChatAgentToolsContribution.ID, BrowserChatAgentToolsContribution, WorkbenchPhase.AfterRestored);
