/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../../../base/common/assert.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { ResourceSet } from '../../../../../base/common/map.js';
import { extname } from '../../../../../base/common/path.js';
import { normalizePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWebContentExtractorService, WebContentExtractResult } from '../../../../../platform/webContentExtractor/common/webContentExtractor.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { detectEncodingFromBuffer } from '../../../../services/textfile/common/encoding.js';
import { ITrustedDomainService } from '../../../url/browser/trustedDomainService.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { ChatImageMimeType } from '../../common/languageModels.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolInvocationPreparationContext, IToolResult, IToolResultDataPart, IToolResultTextPart, ToolDataSource, ToolProgress } from '../../common/tools/languageModelToolsService.js';
import { InternalFetchWebPageToolId } from '../../common/tools/builtinTools/tools.js';
import { IAgentNetworkFilterService } from '../../../../../platform/networkFilter/common/networkFilterService.js';
import { WorkingDirectory } from '../../common/workingDirectory.js';

export const FetchWebPageToolData: IToolData = {
	id: InternalFetchWebPageToolId,
	displayName: 'Fetch Web Page',
	canBeReferencedInPrompt: false,
	modelDescription: 'Fetches the main content from a web page. This tool is useful for summarizing or analyzing the content of a webpage.',
	source: ToolDataSource.Internal,
	canRequestPostApproval: true,
	canRequestPreApproval: true,
	inputSchema: {
		type: 'object',
		properties: {
			urls: {
				type: 'array',
				items: {
					type: 'string',
				},
				description: localize('fetchWebPage.urlsDescription', 'An array of URLs to fetch content from.')
			}
		},
		required: ['urls']
	}
};

export interface IFetchWebPageToolParams {
	urls?: string[];
}

type ResultType = string | { type: 'tooldata'; value: IToolResultDataPart } | { type: 'extracted'; value: WebContentExtractResult } | undefined;

export class FetchWebPageTool implements IToolImpl {

	constructor(
		@IWebContentExtractorService private readonly _readerModeService: IWebContentExtractorService,
		@IFileService private readonly _fileService: IFileService,
		@ITrustedDomainService private readonly _trustedDomainService: ITrustedDomainService,
		@IChatService private readonly _chatService: IChatService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IAgentNetworkFilterService private readonly _agentNetworkFilterService: IAgentNetworkFilterService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const urls = (invocation.parameters as IFetchWebPageToolParams).urls || [];
		const { webUris, fileUris, invalidUris, blockedUris } = this._parseUris(urls);
		const allValidUris = [...webUris.values(), ...fileUris.values()];

		if (!allValidUris.length && invalidUris.size === 0 && blockedUris.size === 0) {
			return {
				content: [{ kind: 'text', value: localize('fetchWebPage.noValidUrls', 'No valid URLs provided.') }]
			};
		}

		let webContents: WebContentExtractResult[] = [];
		if (webUris.size > 0) {
			const trustedDomains = this._trustedDomainService.trustedDomains;
			webContents = await this._readerModeService.extract([...webUris.values()], { trustedDomains });
		}

		const fileContents: (string | { type: 'tooldata'; value: IToolResultDataPart } | undefined)[] = [];
		const successfulFileUris: URI[] = [];
		for (const uri of fileUris.values()) {
			try {
				const fileContent = await this._fileService.readFile(uri, undefined, token);

				const imageMimeType = this._getSupportedImageMimeType(uri);
				if (imageMimeType) {
					fileContents.push({
						type: 'tooldata',
						value: {
							kind: 'data',
							value: {
								mimeType: imageMimeType,
								data: fileContent.value
							}
						}
					});
				} else {
					const detected = detectEncodingFromBuffer({ buffer: fileContent.value, bytesRead: fileContent.value.byteLength });

					if (detected.seemsBinary) {
						fileContents.push(localize('fetchWebPage.binaryNotSupported', 'Binary files are not supported at the moment.'));
					} else {
						fileContents.push(fileContent.value.toString());
					}
				}

				successfulFileUris.push(uri);
			} catch (error) {
				fileContents.push(undefined);
			}
		}

		const results: ResultType[] = [];
		let webIndex = 0;
		let fileIndex = 0;
		for (const url of urls) {
			if (blockedUris.has(url)) {
				results.push(this._agentNetworkFilterService.formatError(URI.parse(url)));
			} else if (invalidUris.has(url)) {
				results.push(undefined);
			} else if (webUris.has(url)) {
				results.push({ type: 'extracted', value: webContents[webIndex] });
				webIndex++;
			} else if (fileUris.has(url)) {
				results.push(fileContents[fileIndex]);
				fileIndex++;
			} else {
				results.push(undefined);
			}
		}

		let confirmResults: undefined | boolean;
		if (webContents.every(e => e.status === 'error' || e.status === 'redirect')) {
			confirmResults = false;
		}


		const actuallyValidUris = [...webUris.values(), ...successfulFileUris];

		return {
			content: this._getPromptPartsForResults(urls, results),
			toolResultDetails: actuallyValidUris,
			confirmResults,
		};
	}

	async prepareToolInvocation(context: IToolInvocationPreparationContext, token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const { webUris, fileUris, invalidUris, blockedUris } = this._parseUris(context.parameters.urls);

		const validFileUris: URI[] = [];
		const additionalInvalidUrls: string[] = [];
		for (const [originalUrl, uri] of fileUris.entries()) {
			try {
				await this._fileService.stat(uri);
				validFileUris.push(uri);
			} catch (error) {
				additionalInvalidUrls.push(originalUrl);
			}
		}

		const invalid = [...Array.from(invalidUris), ...additionalInvalidUrls, ...Array.from(blockedUris)];
		const allFetchedUris = new ResourceSet([...webUris.values(), ...validFileUris]);
		const workingDir = new WorkingDirectory(this._workspaceContextService, context.workingDirectory);
		const fileUrisOutsideWorkspace = validFileUris.filter(uri => !workingDir.getFolder(uri));
		const urlsNeedingConfirmation = new ResourceSet([...webUris.values(), ...fileUrisOutsideWorkspace]);

		const pastTenseMessage = invalid.length
			? invalid.length > 1
				? new MarkdownString(
					localize(
						'fetchWebPage.pastTenseMessage.plural',
						'Fetched {0} resources, but the following were invalid URLs:\n\n{1}\n\n', allFetchedUris.size, invalid.map(url => `- ${url}`).join('\n')
					))
				: new MarkdownString(
					localize(
						'fetchWebPage.pastTenseMessage.singular',
						'Fetched resource, but the following was an invalid URL:\n\n{0}\n\n', invalid[0]
					))
			: new MarkdownString();

		const invocationMessage = new MarkdownString();
		if (allFetchedUris.size > 1) {
			pastTenseMessage.appendMarkdown(localize('fetchWebPage.pastTenseMessageResult.plural', 'Fetched {0} resources', allFetchedUris.size));
			invocationMessage.appendMarkdown(localize('fetchWebPage.invocationMessage.plural', 'Fetching {0} resources', allFetchedUris.size));
		} else if (allFetchedUris.size === 1) {
			const url = Iterable.first(allFetchedUris)!.toString(true);
			if (url.length > 400 || validFileUris.length === 1) {
				pastTenseMessage.appendMarkdown(localize({
					key: 'fetchWebPage.pastTenseMessageResult.singularAsLink',
					comment: [
						'{Locked="]({0})"}',
					]
				}, 'Fetched [resource]({0})', url));
				invocationMessage.appendMarkdown(localize({
					key: 'fetchWebPage.invocationMessage.singularAsLink',
					comment: [
						'{Locked="]({0})"}',
					]
				}, 'Fetching [resource]({0})', url));
			} else {
				pastTenseMessage.appendMarkdown(localize('fetchWebPage.pastTenseMessageResult.singular', 'Fetched {0}', url));
				invocationMessage.appendMarkdown(localize('fetchWebPage.invocationMessage.singular', 'Fetching {0}', url));
			}
		}

		let confirmationNotNeededReason: string | undefined;
		if (context.chatSessionResource) {
			const model = this._chatService.getSession(context.chatSessionResource);
			const userMessages = model?.getRequests().map(r => r.message.text) ?? [];
			const referencedResources = collectReferencedResources(userMessages);
			let urlsMentionedInPrompt = false;
			for (const uri of urlsNeedingConfirmation) {
				if (referencedResources.has(uri)) {
					urlsNeedingConfirmation.delete(uri);
					urlsMentionedInPrompt = true;
				}
			}
			if (urlsMentionedInPrompt && urlsNeedingConfirmation.size === 0) {
				confirmationNotNeededReason = localize('fetchWebPage.urlMentionedInPrompt', 'Auto approved because URL was in prompt');
			}
		}

		const result: IPreparedToolInvocation = { invocationMessage, pastTenseMessage };
		const allDomainsTrusted = Iterable.every(urlsNeedingConfirmation, u => this._trustedDomainService.isValid(u));
		let confirmationTitle: string | undefined;
		let confirmationMessage: string | MarkdownString | undefined;

		if (urlsNeedingConfirmation.size && !allDomainsTrusted) {
			if (urlsNeedingConfirmation.size === 1) {
				confirmationTitle = localize('fetchWebPage.confirmationTitle.singular', 'Fetch web page?');
				confirmationMessage = new MarkdownString(
					Iterable.first(urlsNeedingConfirmation)!.toString(true),
					{ supportThemeIcons: true }
				);
			} else {
				confirmationTitle = localize('fetchWebPage.confirmationTitle.plural', 'Fetch web pages?');
				confirmationMessage = new MarkdownString(
					[...urlsNeedingConfirmation].map(uri => `- ${uri.toString(true)}`).join('\n'),
					{ supportThemeIcons: true }
				);
			}
		}
		result.confirmationMessages = {
			title: confirmationTitle,
			message: confirmationMessage,
			confirmResults: urlsNeedingConfirmation.size > 0,
			allowAutoConfirm: true,
			disclaimer: new MarkdownString('$(info) ' + localize('fetchWebPage.confirmationMessage.plural', 'Web content may contain malicious code or attempt prompt injection attacks.'), { supportThemeIcons: true }),
			confirmationNotNeededReason
		};
		return result;
	}

	private _parseUris(urls?: string[]): { webUris: Map<string, URI>; fileUris: Map<string, URI>; invalidUris: Set<string>; blockedUris: Set<string> } {
		const webUris = new Map<string, URI>();
		const fileUris = new Map<string, URI>();
		const invalidUris = new Set<string>();
		const blockedUris = new Set<string>();

		urls?.forEach(url => {
			try {
				const uriObj = URI.parse(url);
				if (uriObj.scheme === 'http' || uriObj.scheme === 'https') {
					if (!this._agentNetworkFilterService.isUriAllowed(uriObj)) {
						blockedUris.add(url);
					} else {
						webUris.set(url, uriObj);
					}
				} else {
					fileUris.set(url, normalizePath(uriObj));
				}
			} catch (e) {
				invalidUris.add(url);
			}
		});

		return { webUris, fileUris, invalidUris, blockedUris };
	}

	private _getPromptPartsForResults(urls: string[], results: ResultType[]): (IToolResultTextPart | IToolResultDataPart)[] {
		return results.map((value, i) => {
			const title = results.length > 1 ? localize('fetchWebPage.fetchedFrom', 'Fetched from {0}', urls[i]) : undefined;
			if (!value) {
				return {
					kind: 'text',
					title,
					value: localize('fetchWebPage.invalidUrl', 'Invalid URL')
				};
			} else if (typeof value === 'string') {
				return {
					kind: 'text',
					title,
					value: value
				};
			} else if (value.type === 'tooldata') {
				return { ...value.value, title };
			} else if (value.type === 'extracted') {
				switch (value.value.status) {
					case 'ok':
						return { kind: 'text', title, value: value.value.result };
					case 'redirect':
						return { kind: 'text', title, value: `The webpage has redirected to "${value.value.toURI.toString(true)}". Use the ${InternalFetchWebPageToolId} again to get its contents.` };
					case 'error':
						return { kind: 'text', title, value: `An error occurred retrieving the fetch result: ${value.value.error}` };
					default:
						assertNever(value.value);
				}
			} else {
				throw new Error('unreachable');
			}
		});
	}

	private _getSupportedImageMimeType(uri: URI): ChatImageMimeType | undefined {
		const ext = extname(uri.path).toLowerCase();
		switch (ext) {
			case '.png':
				return ChatImageMimeType.PNG;
			case '.jpg':
			case '.jpeg':
				return ChatImageMimeType.JPEG;
			case '.gif':
				return ChatImageMimeType.GIF;
			case '.webp':
				return ChatImageMimeType.WEBP;
			case '.bmp':
				return ChatImageMimeType.BMP;
			default:
				return undefined;
		}
	}
}

const _schemePrefix = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function collectReferencedResources(messages: readonly string[]): ResourceSet {
	const resources = new ResourceSet();
	for (const message of messages) {
		for (const rawToken of message.split(/\s+/)) {
			const token = rawToken.replace(/^[<("'`[{]+/, '').replace(/[>)"'`\]},.;]+$/, '');
			if (!_schemePrefix.test(token)) {
				continue;
			}
			try {
				resources.add(URI.parse(token, true));
			} catch {
			}
		}
	}
	return resources;
}

