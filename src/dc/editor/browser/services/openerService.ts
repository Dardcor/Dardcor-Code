/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { LinkedList } from '../../../base/common/linkedList.js';
import { ResourceMap } from '../../../base/common/map.js';
import { parse } from '../../../base/common/marshalling.js';
import { matchesScheme, matchesSomeScheme, Schemas } from '../../../base/common/network.js';
import { normalizePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeEditorService } from './codeEditorService.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { EditorOpenSource } from '../../../platform/editor/common/editor.js';
import { extractSelection, IExternalOpener, IExternalUriResolver, IOpener, IOpenerService, IResolvedExternalUri, IValidator, OpenOptions, ResolveExternalUriOptions } from '../../../platform/opener/common/opener.js';

const dardcorDocumentationAuthority = 'www.dardcor-code.web.id';

const legacyDocumentationRoutes: Record<string, string> = {
	'/allow-vscode-popup': '/docs/troubleshooting/browser-popups',
	'/vscode-agent-plugins': '/docs/agent-customization/agent-plugins',
	'/vscode-agent-skills': '/docs/agent-customization/agent-skills',
	'/vscode-agent-tunnel-access': '/docs/remote/tunnels',
	'/vscode-chat-hooks': '/docs/agent-customization/hooks',
	'/vscode-claude-auto-mode': '/docs/permissions/approval-modes',
	'/vscode-dardcor-workspace-remote-index': '/docs/workspaces/remote-index',
	'/vscode-eliminating-rootpath': '/docs/extensions/api-migration',
	'/vscode-extension-bisect': '/docs/extensions/troubleshooting/bisect',
	'/vscode-extension-security': '/docs/extensions/security',
	'/vscode-extensions/navigator': '/docs/extensions/api/navigator',
	'/vscode-external-ingest-policy': '/docs/enterprise/data-and-privacy',
	'/vscode-faq-old-macos': '/docs/troubleshooting/macos-compatibility',
	'/vscode-download-git': '/docs/getting-started/git',
	'/vscode-git-repository-in-parent-folders': '/docs/editor/versioncontrol',
	'/vscode-git-unsafe-repository': '/docs/security/git-ownership',
	'/vscode-github-push-protection': '/docs/security/github-push-protection',
	'/vscode-getting-started-video': '/docs/getstarted/tutorials',
	'/vscode-gh-mcp-channel': '/docs/agent-customization/mcp-servers',
	'/vscode-gh-mcp-lockdown': '/docs/agent-customization/mcp-servers',
	'/vscode-gh-mcp-readonly': '/docs/agent-customization/mcp-servers',
	'/vscode-gh-mcp-toolsets': '/docs/agent-customization/mcp-servers',
	'/vscode-ghcp-custom-chat-modes': '/docs/agent-customization/custom-agents',
	'/vscode-ghcp-custom-instructions': '/docs/agent-customization/custom-instructions',
	'/vscode-ghcp-prompt-snippets': '/docs/agent-customization/prompt-files',
	'/vscode-glob-patterns': '/docs/configuration/glob-patterns',
	'/vscode-hot-exit': '/docs/editor/hot-exit',
	'/vscode-insiders': '/updates/insiders',
	'/vscode-install-git': '/docs/getting-started/git',
	'/vscode-nes': '/docs/editor/inline-completions',
	'/vscode-platform-specific-extensions': '/docs/extensions/platform-specific',
	'/vscode-profiles-help': '/docs/user-data/profiles',
	'/vscode-remote': '/docs/remote/overview',
	'/vscode-remote-linux-arm-32-eol': '/docs/remote/linux-arm-support',
	'/vscode-remote/faq/old-linux': '/docs/remote/troubleshooting/linux',
	'/vscode-remote/wsl/install-wsl': '/docs/remote/wsl',
	'/vscode-sandboxing': '/docs/permissions/sandboxing',
	'/vscode-scm': '/docs/editor/versioncontrol',
	'/vscode-setup-git': '/docs/getting-started/git',
	'/vscode-server-doc': '/docs/remote/server',
	'/vscode-settings-sync-help': '/docs/user-data/settings-sync',
	'/vscode-telemetry': '/docs/privacy/telemetry',
	'/vscode-terminal-intellisense': '/docs/terminal/suggestions',
	'/vscode-try-ts-7-learn-more': '/docs/languages/typescript/preview',
	'/vscode-troubleshoot-terminal-launch': '/docs/terminal/troubleshooting',
	'/vscode-tracing-cpu-profile': '/docs/troubleshooting/performance/cpu-profile',
	'/vscode-verify-publisher': '/docs/extensions/publishers',
	'/vscode-web-extensions-guide': '/docs/extensions/web',
	'/vscode-webview-missing-csp': '/docs/extensions/api/webviews',
	'/vscode-webview-use-aswebviewuri': '/docs/extensions/api/webviews',
	'/vscode-when-clause': '/docs/configuration/when-clauses',
	'/vscode-weblocalfilesystemaccess': '/docs/platform/browser-file-access',
	'/vscode-windows-unc': '/docs/platform/windows/unc-paths',
	'/vscode-workspace-trust': '/docs/editor/workspace-trust',
	'/vscode/docs/permissions': '/docs/permissions',
	'/vscode/enterprise/extensions/allowed': '/docs/enterprise/extensions/allowlist',
	'/vscode/jsts/partial-mode': '/docs/languages/javascript/partial-mode',
};


function redirectLegacyDocumentationUri(resource: URI): URI {
	if (!matchesSomeScheme(resource, Schemas.http, Schemas.https)) {
		return resource;
	}

	const authority = resource.authority.toLowerCase();
	if (authority === 'code.visualstudio.com') {

		if (resource.path === '/raw' || resource.path.startsWith('/raw/')) {
			return resource;
		}
		return resource.with({ scheme: 'https', authority: dardcorDocumentationAuthority });
	}

	if (authority !== 'aka.ms') {
		return resource;
	}

	const path = resource.path.toLowerCase().replace(/\/$/, '');
	let destinationPath = legacyDocumentationRoutes[path];
	if (!destinationPath && path === '/vscode') {
		destinationPath = '/docs';
	} else if (!destinationPath && (path === '/vscode/docs' || path.startsWith('/vscode/docs/'))) {
		destinationPath = path.slice('/vscode'.length);
	} else if (!destinationPath && path.startsWith('/vscode/')) {
		destinationPath = `/docs/compatibility/aka-ms/${path.slice('/vscode/'.length)}`;
	} else if (!destinationPath && path.startsWith('/vscode-mcp-install/')) {
		destinationPath = `/docs/agent-customization/mcp-servers/install/${path.slice('/vscode-mcp-install/'.length)}`;
	} else if (!destinationPath && path.startsWith('/vscode-')) {

		destinationPath = `/docs/compatibility/aka-ms/${path.slice('/vscode-'.length)}`;
	}

	return destinationPath
		? resource.with({ scheme: 'https', authority: dardcorDocumentationAuthority, path: destinationPath })
		: resource;
}

class CommandOpener implements IOpener {

	constructor(@ICommandService private readonly _commandService: ICommandService) { }

	async open(target: URI | string, options?: OpenOptions): Promise<boolean> {
		if (!matchesScheme(target, Schemas.command)) {
			return false;
		}

		if (!options?.allowCommands) {
			return true;
		}

		if (typeof target === 'string') {
			target = URI.parse(target);
		}

		if (Array.isArray(options.allowCommands)) {
			if (!options.allowCommands.includes(target.path)) {
				return true;
			}
		}

		let args: unknown[] = [];
		try {
			args = parse(decodeURIComponent(target.query));
		} catch {
			try {
				args = parse(target.query);
			} catch {
			}
		}
		if (!Array.isArray(args)) {
			args = [args];
		}
		await this._commandService.executeCommand(target.path, ...args);
		return true;
	}
}

class EditorOpener implements IOpener {

	constructor(@ICodeEditorService private readonly _editorService: ICodeEditorService) { }

	async open(target: URI | string, options: OpenOptions) {
		if (typeof target === 'string') {
			target = URI.parse(target);
		}

		const { selection, uri } = extractSelection(target);
		target = uri;

		if (target.scheme === Schemas.file) {
			target = normalizePath(target);
		}

		await this._editorService.openCodeEditor(
			{
				resource: target,
				options: {
					selection,
					source: options?.fromUserGesture ? EditorOpenSource.USER : EditorOpenSource.API,
					...options?.editorOptions
				}
			},
			this._editorService.getFocusedCodeEditor(),
			options?.openToSide
		);

		return true;
	}
}

export class OpenerService implements IOpenerService {

	declare readonly _serviceBrand: undefined;

	private readonly _openers = new LinkedList<IOpener>();
	private readonly _validators = new LinkedList<IValidator>();
	private readonly _resolvers = new LinkedList<IExternalUriResolver>();
	private readonly _resolvedUriTargets = new ResourceMap<URI>(uri => uri.with({ path: null, fragment: null, query: null }).toString());

	private _defaultExternalOpener: IExternalOpener;
	private readonly _externalOpeners = new LinkedList<IExternalOpener>();

	constructor(
		@ICodeEditorService editorService: ICodeEditorService,
		@ICommandService commandService: ICommandService
	) {
		this._defaultExternalOpener = {
			openExternal: async href => {
				if (matchesSomeScheme(href, Schemas.http, Schemas.https)) {
					dom.windowOpenNoOpener(href);
				} else {
					mainWindow.location.href = href;
				}
				return true;
			}
		};

		this._openers.push({
			open: async (target: URI | string, options?: OpenOptions) => {
				if (options?.openExternal || matchesSomeScheme(target, Schemas.mailto, Schemas.http, Schemas.https, Schemas.vsls)) {
					await this._doOpenExternal(target, options);
					return true;
				}
				return false;
			}
		});
		this._openers.push(new CommandOpener(commandService));
		this._openers.push(new EditorOpener(editorService));
	}

	registerOpener(opener: IOpener): IDisposable {
		const remove = this._openers.unshift(opener);
		return { dispose: remove };
	}

	registerValidator(validator: IValidator): IDisposable {
		const remove = this._validators.push(validator);
		return { dispose: remove };
	}

	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable {
		const remove = this._resolvers.push(resolver);
		return { dispose: remove };
	}

	setDefaultExternalOpener(externalOpener: IExternalOpener): void {
		this._defaultExternalOpener = externalOpener;
	}

	registerExternalOpener(opener: IExternalOpener): IDisposable {
		const remove = this._externalOpeners.push(opener);
		return { dispose: remove };
	}

	async open(target: URI | string, options?: OpenOptions): Promise<boolean> {
		const parsedTarget = typeof target === 'string' ? URI.parse(target) : target;
		const targetURI = redirectLegacyDocumentationUri(parsedTarget);
		if (targetURI !== parsedTarget) {
			target = targetURI;
		}

		if (targetURI.scheme === Schemas.internal) {
			return false;
		}

		if (!options?.skipValidation) {
			const validationTarget = this._resolvedUriTargets.get(targetURI) ?? target;
			for (const validator of this._validators) {
				if (!(await validator.shouldOpen(validationTarget, options))) {
					return false;
				}
			}
		}

		for (const opener of this._openers) {
			const handled = await opener.open(target, options);
			if (handled) {
				return true;
			}
		}

		return false;
	}

	async resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri> {
		for (const resolver of this._resolvers) {
			try {
				const result = await resolver.resolveExternalUri(resource, options);
				if (result) {
					if (!this._resolvedUriTargets.has(result.resolved)) {
						this._resolvedUriTargets.set(result.resolved, resource);
					}
					return result;
				}
			} catch {
			}
		}

		throw new Error('Could not resolve external URI: ' + resource.toString());
	}

	private async _doOpenExternal(resource: URI | string, options: OpenOptions | undefined): Promise<boolean> {

		const uri = typeof resource === 'string' ? URI.parse(resource) : resource;
		let externalUri: URI;

		try {
			externalUri = (await this.resolveExternalUri(uri, options)).resolved;
		} catch {
			externalUri = uri;
		}

		let href: string;
		if (typeof resource === 'string' && uri.toString() === externalUri.toString()) {
			href = resource;
		} else {
			href = encodeURI(externalUri.toString(true));
		}

		if (options?.allowContributedOpeners) {
			const preferredOpenerId = typeof options?.allowContributedOpeners === 'string' ? options?.allowContributedOpeners : undefined;
			for (const opener of this._externalOpeners) {
				const didOpen = await opener.openExternal(href, {
					sourceUri: uri,
					preferredOpenerId,
				}, CancellationToken.None);
				if (didOpen) {
					return true;
				}
			}
		}

		return this._defaultExternalOpener.openExternal(href, { sourceUri: uri }, CancellationToken.None);
	}

	dispose() {
		this._validators.clear();
	}
}
