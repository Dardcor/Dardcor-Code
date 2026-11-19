/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation } from '../../../../../base/common/async.js';
import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { hasKey } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAgentNetworkFilterService } from '../../../../../platform/networkFilter/common/networkFilterService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IChatQuestion, IChatQuestionAnswers, IChatService, IChatSingleSelectAnswer } from '../../../chat/common/chatService/chatService.js';
import { ChatConfiguration, ChatPermissionLevel } from '../../../chat/common/constants.js';
import { ChatQuestionCarouselData } from '../../../chat/common/model/chatProgressTypes/chatQuestionCarouselData.js';
import { IChatRequestModel } from '../../../chat/common/model/chatModel.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { BrowserViewSharingState, IBrowserViewWorkbenchService } from '../../common/browserView.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { createBrowserPageLink, findExistingPagesByHost, getExistingPagesResult, getSessionId, remoteUrlRewriteNotice, rewriteRemoteLocalhostUrl } from './browserToolHelpers.js';
import { IRemoteExplorerService } from '../../../../services/remote/common/remoteExplorerService.js';
import { detectDardcorLanguage } from '../../../chat/common/participants/dardcorAgentRunPolicy.js';

export const OpenPageToolId = 'open_browser_page';

export const OpenBrowserToolData: IToolData = {
	id: OpenPageToolId,
	toolReferenceName: BrowserChatToolReferenceName.OpenBrowserPage,
	displayName: localize('openBrowserTool.displayName', 'Open Browser Page'),
	userDescription: localize('openBrowserTool.userDescription', 'Open a URL in the integrated browser'),
	modelDescription: `Open a new browser page in the integrated browser at the given URL.
May prompt the user to share a page if there is a similar one already open, unless "forceNew" is true.
Returns a page ID that must be used with other browser tools to interact with the page, as well as an accessibility snapshot of the page.

Important: Prefer to reuse existing pages whenever possible and only call this tool if you do not already have access to a tab you can reuse.`,
	icon: Codicon.openInProduct,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'The URL to open in the browser. Must be an absolute URI with a scheme such as file:, http:, or https:. For local files, use the canonical absolute form, for example file:///path/to/file.'
			},
			forceNew: {
				type: 'boolean',
				description: 'Whether to force opening a new page even if a page with the same host already exists. Default is false.'
			}
		},
		$comment: 'If you omit "url", the user will be prompted to share an existing page instead. Use this if there are unshared pages that the user may be interested in sharing with you.'
	},
};

export interface IOpenBrowserToolParams {
	url?: string;
	forceNew?: boolean;
}

const DECLINE_OPTION_ID = '__decline__';

export class OpenBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
		@IEditorService private readonly editorService: IEditorService,
		@IBrowserViewWorkbenchService private readonly browserViewService: IBrowserViewWorkbenchService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@IAgentNetworkFilterService private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = context.parameters as IOpenBrowserToolParams;
		const request = this._getRequest(context.chatSessionResource, context.chatRequestId);
		const lang = detectDardcorLanguage(request?.message?.text);

		if (!params.url) {
			let promptInvocation = localize('browser.open.prompt.invocation', "Prompting user to share a browser tab");
			let promptPast = localize('browser.open.prompt.past', "Prompted user to share a browser tab");
			if (lang === 'id') {
				promptInvocation = 'Meminta pengguna untuk membagikan tab browser';
				promptPast = 'Meminta pengguna untuk membagikan tab browser';
			} else if (lang === 'ja') {
				promptInvocation = 'ブラウザタブの共有をユーザーに要求しています';
				promptPast = 'ブラウザタブの共有をユーザーに要求しました';
			} else if (lang === 'zh') {
				promptInvocation = '正在请求用户共享浏览器标签页';
				promptPast = '已请求用户共享浏览器标签页';
			} else if (lang === 'es') {
				promptInvocation = 'Solicitando al usuario compartir pestaña del navegador';
				promptPast = 'Se solicitó compartir pestaña del navegador';
			} else if (lang === 'fr') {
				promptInvocation = 'Demande à l\'utilisateur de partager un onglet de navigateur';
				promptPast = 'A demandé de partager un onglet de navigateur';
			} else if (lang === 'de') {
				promptInvocation = 'Benutzer wird zum Freigeben eines Browser-Tabs aufgefordert';
				promptPast = 'Benutzer zum Freigeben eines Browser-Tabs aufgefordert';
			}
			return {
				invocationMessage: promptInvocation,
				pastTenseMessage: promptPast,
			};
		}

		const parsed = URL.parse(params.url);
		if (!parsed) {
			throw new Error('You must provide a complete, valid URL.');
		}

		params.url = parsed.href;

		const uri = URI.parse(params.url);
		if (!this.agentNetworkFilterService.isUriAllowed(uri)) {
			throw new Error(this.agentNetworkFilterService.formatError(uri));
		}

		let invocationMessage = localize('browser.open.invocation', "Opening browser page at {0}", parsed.href);
		let pastTenseMessage = localize('browser.open.past', "Opened browser page at {0}", parsed.href);
		let confirmTitle = localize('browser.open.confirmTitle', 'Open Browser Page?');
		let confirmMessage = localize('browser.open.confirmMessage', 'This will open {0} in the integrated browser. The agent will be able to read and interact with its contents.', parsed.href);

		if (lang === 'id') {
			invocationMessage = `Membuka halaman browser di ${parsed.href}`;
			pastTenseMessage = `Membuka halaman browser di ${parsed.href}`;
			confirmTitle = 'Buka Halaman Browser?';
			confirmMessage = `Ini akan membuka ${parsed.href} di integrated browser. Agen akan dapat membaca dan berinteraksi dengan kontennya.`;
		} else if (lang === 'ja') {
			invocationMessage = `${parsed.href} でブラウザページを開いています`;
			pastTenseMessage = `${parsed.href} でブラウザページを開きました`;
			confirmTitle = 'ブラウザページを開きますか？';
			confirmMessage = `統合ブラウザで ${parsed.href} を開きます。エージェントはそのコンテンツを読み取って操作できるようになります。`;
		} else if (lang === 'zh') {
			invocationMessage = `正在打开浏览器页面 ${parsed.href}`;
			pastTenseMessage = `已打开浏览器页面 ${parsed.href}`;
			confirmTitle = '打开浏览器页面？';
			confirmMessage = `将在内置浏览器中打开 ${parsed.href}。智能体将能够读取其内容并进行交互。`;
		} else if (lang === 'es') {
			invocationMessage = `Abriendo página del navegador en ${parsed.href}`;
			pastTenseMessage = `Página del navegador abierta en ${parsed.href}`;
			confirmTitle = '¿Abrir página del navegador?';
			confirmMessage = `Esto abrirá ${parsed.href} en el navegador integrado. El agente podrá leer e interactuar con su contenido.`;
		} else if (lang === 'fr') {
			invocationMessage = `Ouverture de la page de navigateur à ${parsed.href}`;
			pastTenseMessage = `Page de navigateur ouverte à ${parsed.href}`;
			confirmTitle = 'Ouvrir la page de navigateur ?';
			confirmMessage = `Cela ouvrira ${parsed.href} dans le navigateur intégré. L\'agent pourra lire et interagir dengan son contenu.`;
		} else if (lang === 'de') {
			invocationMessage = `Browser-Seite wird unter ${parsed.href} geöffnet`;
			pastTenseMessage = `Browser-Seite unter ${parsed.href} geöffnet`;
			confirmTitle = 'Browser-Seite öffnen?';
			confirmMessage = `Dadurch wird ${parsed.href} im integrierten Browser geöffnet. Der Agent kann dessen Inhalte lesen und damit interagieren.`;
		}

		return {
			invocationMessage,
			pastTenseMessage,
			confirmationMessages: {
				title: confirmTitle,
				message: confirmMessage,
				allowAutoConfirm: true,
			},
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IOpenBrowserToolParams;
		const sessionId = getSessionId(invocation);
		const activeSessionId = invocation.context?.sessionResource.toString();

		if (!params.url) {
			const allPages = [...this.browserViewService.getContextualBrowserViews({ activeSessionId }).values()];
			if (allPages.length === 0) {
				return { content: [{ kind: 'text', value: 'No browser pages are currently open.' }] };
			}

			const shareResult = await this._promptForUnsharedPages(invocation, allPages, params, token);
			if (shareResult) {
				return shareResult;
			} else {
				return { content: [{ kind: 'text', value: 'The user opted not to share an existing page.' }] };
			}
		}

		const rewrite = rewriteRemoteLocalhostUrl(params.url, this.browserViewService, this.remoteExplorerService);
		const rewriteNotice = rewrite.rewritten ? remoteUrlRewriteNotice(params.url, rewrite.url) : undefined;
		params.url = rewrite.url;

		const withNotice = (result: IToolResult): IToolResult =>
			rewriteNotice ? { ...result, content: [rewriteNotice, ...result.content] } : result;

		if (!params.forceNew) {
			const shared = findExistingPagesByHost(this.browserViewService, params.url, { includeBlank: true, sharingState: BrowserViewSharingState.Shared, activeSessionId });
			const alreadyShared = await getExistingPagesResult(this.editorService, shared, { agentNetworkFilterService: this.agentNetworkFilterService });
			if (alreadyShared) {
				return withNotice(alreadyShared);
			}

			const unshared = findExistingPagesByHost(this.browserViewService, params.url, { includeBlank: false, sharingState: BrowserViewSharingState.Available, activeSessionId });
			if (unshared.length > 0) {
				const shareResult = await this._promptForUnsharedPages(invocation, unshared, params, token);
				if (shareResult) {
					return withNotice(shareResult);
				}
			}
		}

		return withNotice(await this._openNewPage(sessionId, params.url));
	}

	private async _promptForUnsharedPages(invocation: IToolInvocation, candidateEditors: BrowserEditorInput[], params: IOpenBrowserToolParams, token: CancellationToken): Promise<IToolResult | undefined> {

		const chatSessionResource = invocation.context?.sessionResource;
		const chatRequestId = invocation.chatRequestId;
		const request = this._getRequest(chatSessionResource, chatRequestId);

		if (!request) {
			return undefined;
		}

		if (request.modeInfo?.permissionLevel === ChatPermissionLevel.Autopilot || this.configService.getValue<boolean>(ChatConfiguration.AutoReply)) {
			return undefined;
		}

		const carousel = this._buildShareCarousel(candidateEditors, params.url, invocation.chatStreamToolCallId ?? invocation.callId, request.message.text);
		this.chatService.appendProgress(request, carousel);

		const externalAnswerListener = this.chatService.onDidReceiveQuestionCarouselAnswer(event => {
			if (event.resolveId !== carousel.resolveId || carousel.isUsed) {
				return;
			}
			carousel.dismiss(event.answers);
		});

		let answerResult: { answers: IChatQuestionAnswers | undefined } | undefined;
		try {
			answerResult = await raceCancellation(carousel.completion.p, token);
		} catch (error) {
			if (error instanceof CancellationError) {
				carousel.dismiss(undefined);
			}
			throw error;
		} finally {
			externalAnswerListener.dispose();
		}

		if (!answerResult || token.isCancellationRequested) {
			carousel.dismiss(undefined);
			throw new CancellationError();
		}

		const selectedOptionId = this._extractSelectedOption(answerResult.answers);

		if (!selectedOptionId || selectedOptionId === DECLINE_OPTION_ID) {
			return undefined;
		}

		const editor = candidateEditors.find(e => e.id === selectedOptionId);
		if (!editor) {
			this.logService.warn(`[OpenBrowserTool] Selected option '${selectedOptionId}' not found.`);
			return undefined;
		}

		return this._shareExistingPage(getSessionId(invocation), editor);
	}

	private _buildShareCarousel(editors: BrowserEditorInput[], url: string | undefined, resolveId: string, userPromptText?: string): ChatQuestionCarouselData {
		const lang = detectDardcorLanguage(userPromptText);
		let shareTitle = localize('browser.open.shareQuestion.title', "Share Browser Tab");
		let shareMsg = localize('browser.open.shareQuestion.message', "Share an existing browser tab?");
		let formatShareOption = (editorTitle: string, truncatedUrl: string) => localize(
			{ key: 'browser.open.shareExistingOption', comment: ['{Locked=" - "}', '{0} is the editor title', '{1} is the truncated URL'] },
			'Yes, share "{0}" - {1}',
			editorTitle,
			truncatedUrl,
		);
		let formatNewPageOption = (targetUrl: string) => localize('browser.open.newPageOption', "No, open a new page at {0}", targetUrl);
		let noPagesOption = localize({ key: 'browser.open.noPagesOption', comment: ['{Locked=" - "}'] }, "No - Do not share any tabs with the agent");

		if (lang === 'id') {
			shareTitle = 'Bagikan Tab Browser';
			shareMsg = 'Bagikan tab browser yang sedang terbuka?';
			formatShareOption = (editorTitle, truncatedUrl) => `Ya, bagikan "${editorTitle}" - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `Tidak, buka halaman baru di ${targetUrl}`;
			noPagesOption = 'Tidak - Jangan bagikan tab browser dengan agent';
		} else if (lang === 'ja') {
			shareTitle = 'ブラウザタブの共有';
			shareMsg = '開いているブラウザタブを共有しますか？';
			formatShareOption = (editorTitle, truncatedUrl) => `はい、"${editorTitle}" を共有 - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `いいえ、${targetUrl} で新しいページを開く`;
			noPagesOption = 'いいえ - タブを共有しない';
		} else if (lang === 'zh') {
			shareTitle = '共享浏览器标签页';
			shareMsg = '是否共享现有浏览器标签页？';
			formatShareOption = (editorTitle, truncatedUrl) => `是，共享 "${editorTitle}" - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `否，在 ${targetUrl} 打开新页面`;
			noPagesOption = '否 - 不与 Agent 共享任何标签页';
		} else if (lang === 'es') {
			shareTitle = 'Compartir pestaña del navegador';
			shareMsg = '¿Compartir una pestaña abierta del navegador?';
			formatShareOption = (editorTitle, truncatedUrl) => `Sí, compartir "${editorTitle}" - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `No, abrir una nueva página en ${targetUrl}`;
			noPagesOption = 'No - No compartir ninguna pestaña';
		} else if (lang === 'fr') {
			shareTitle = 'Partager un onglet de navigateur';
			shareMsg = 'Partager un onglet de navigateur existant ?';
			formatShareOption = (editorTitle, truncatedUrl) => `Oui, partager "${editorTitle}" - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `Non, ouvrir une nouvelle page sur ${targetUrl}`;
			noPagesOption = 'Non - Ne partager aucun onglet';
		} else if (lang === 'de') {
			shareTitle = 'Browser-Tab freigeben';
			shareMsg = 'Vorhandenen Browser-Tab freigeben?';
			formatShareOption = (editorTitle, truncatedUrl) => `Ja, "${editorTitle}" freigeben - ${truncatedUrl}`;
			formatNewPageOption = (targetUrl) => `Nein, neue Seite unter ${targetUrl} öffnen`;
			noPagesOption = 'Nein - Keine Tabs freigeben';
		}

		const options: IChatQuestion['options'] = [];

		for (const editor of editors) {
			const editorTitle = (editor.title || editor.getName()).replaceAll(' - ', '\u00A0-\u00A0');
			const editorUrl = editor.url || 'about:blank';
			const truncatedUrl = editorUrl.length > 40 ? editorUrl.substring(0, 40) + '\u2026' : editorUrl;
			options.push({
				id: editor.id,
				label: formatShareOption(editorTitle, truncatedUrl),
				value: editor.id,
			});
		}

		options.push({
			id: DECLINE_OPTION_ID,
			label: url ? formatNewPageOption(url) : noPagesOption,
			value: DECLINE_OPTION_ID,
		});

		const question: IChatQuestion = {
			id: `${resolveId}:0`,
			type: 'singleSelect',
			title: shareTitle,
			message: shareMsg,
			options,
			defaultValue: DECLINE_OPTION_ID,
			allowFreeformInput: false,
		};

		return new ChatQuestionCarouselData([question], true, resolveId);
	}

	private _extractSelectedOption(answers: IChatQuestionAnswers | undefined): string | undefined {
		if (!answers) {
			return undefined;
		}

		for (const answer of Object.values(answers)) {
			if (typeof answer === 'string') {
				return answer;
			}
			if (typeof answer === 'object' && answer !== null && hasKey(answer, { selectedValue: true })) {
				return (answer as IChatSingleSelectAnswer).selectedValue;
			}
		}

		return undefined;
	}

	private async _openNewPage(sessionId: string, url: string): Promise<IToolResult> {
		const { pageId, summary } = await this.playwrightService.openPage(sessionId, url);
		return this._pageResult(pageId, summary, localize('browser.open.result', "Opened {0}", createBrowserPageLink(pageId)));
	}

	private async _shareExistingPage(sessionId: string, editor: BrowserEditorInput): Promise<IToolResult> {
		const model = await editor.resolve();
		if (model.sharingState !== BrowserViewSharingState.Shared) {
			if (!(await model.setSharedWithAgent(true))) {
				return { content: [{ kind: 'text', value: 'The user declined to share the page.' }] };
			}
		}

		const summary = await this.playwrightService.getSummary(sessionId, editor.id);
		return this._pageResult(editor.id, summary, localize('browser.open.sharedResult', "User shared {0}", createBrowserPageLink(editor.id)));
	}

	private _pageResult(pageId: string, summary: string, resultMessage: string): IToolResult {
		return {
			content: [
				{ kind: 'text', value: `Page ID: ${pageId}\n\nSummary:\n` },
				{ kind: 'text', value: summary },
			],
			toolResultMessage: new MarkdownString(resultMessage),
		};
	}

	private _getRequest(chatSessionResource: URI | undefined, chatRequestId: string | undefined): IChatRequestModel | undefined {
		if (!chatSessionResource) {
			return undefined;
		}

		const model = this.chatService.getSession(chatSessionResource);
		if (!model) {
			return undefined;
		}

		if (chatRequestId) {
			const request = model.getRequests().find(r => r.id === chatRequestId);
			if (request) {
				return request;
			}
		}

		return model.getRequests().at(-1);
	}
}
