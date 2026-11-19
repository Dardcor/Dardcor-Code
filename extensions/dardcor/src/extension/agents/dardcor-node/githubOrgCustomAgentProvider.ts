/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import YAML, { Scalar } from 'yaml';
import { AGENT_FILE_EXTENSION, PromptsType } from '../../../platform/customInstructions/common/promptTypes';
import { CustomAgentDetails, CustomAgentListOptions, IOctoKitService } from '../../../platform/github/common/githubService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IGitHubOrgChatResourcesService } from './githubOrgChatResourcesService';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export class GitHubOrgCustomAgentProvider extends Disposable implements vscode.ChatCustomAgentProvider {
	private readonly _onDidChangeCustomAgents = this._register(new vscode.EventEmitter<void>());
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;

	constructor(
		@IOctoKitService private readonly octoKitService: IOctoKitService,
		@ILogService private readonly logService: ILogService,
		@IGitHubOrgChatResourcesService private readonly githubOrgChatResourcesService: IGitHubOrgChatResourcesService,
	) {
		super();

		this._register(this.githubOrgChatResourcesService.startPolling(REFRESH_INTERVAL_MS, this.pollAgents.bind(this)));
	}

	async provideCustomAgents(_context: unknown, token: vscode.CancellationToken): Promise<vscode.ChatResource[]> {
		try {
			const orgId = await this.githubOrgChatResourcesService.getPreferredOrganizationName();
			if (!orgId) {
				this.logService.trace('[GitHubOrgCustomAgentProvider] No organization available for providing agents');
				return [];
			}

			if (token.isCancellationRequested) {
				this.logService.trace('[GitHubOrgCustomAgentProvider] provideCustomAgents was cancelled');
				return [];
			}

			return await this.githubOrgChatResourcesService.listCachedFiles(PromptsType.agent, orgId);
		} catch (error) {
			this.logService.error(`[GitHubOrgCustomAgentProvider] Error reading from cache: ${error}`);
			return [];
		}
	}

	private async pollAgents(orgId: string): Promise<void> {
		try {
			const internalOptions = { includeSources: ['org', 'enterprise'] } satisfies CustomAgentListOptions;

			const repos = await this.octoKitService.getOrganizationRepositories(orgId, {}, 1);
			if (repos.length === 0) {
				this.logService.trace(`[GitHubOrgCustomAgentProvider] No repositories found for org ${orgId}`);
				return;
			}

			const repoName = repos[0];
			const [agents, existingAgents] = await Promise.all([
				this.octoKitService.getCustomAgents(orgId, repoName, internalOptions, {}),
				this.githubOrgChatResourcesService.listCachedFiles(PromptsType.agent, orgId)
			]);

			let hasChanges: boolean = existingAgents.length !== agents.length;
			const newFiles = new Set<string>();
			for (const agent of agents) {
				const agentDetails = await this.octoKitService.getCustomAgentDetails(
					agent.repo_owner,
					agent.repo_name,
					agent.name,
					agent.version,
					{},
				);

				if (agentDetails) {
					const filename = `${agent.name}${AGENT_FILE_EXTENSION}`;
					const content = this.generateAgentMarkdown(agentDetails);
					const result = await this.githubOrgChatResourcesService.writeCacheFile(
						PromptsType.agent,
						orgId,
						filename,
						content,
						{ checkForChanges: !hasChanges }
					);
					hasChanges ||= result;
					newFiles.add(filename);
				}
			}

			if (!hasChanges) {
				this.logService.trace('[GitHubOrgCustomAgentProvider] No changes detected in cache');
				return;
			}

			await this.githubOrgChatResourcesService.clearCache(PromptsType.agent, orgId, newFiles);

			this._onDidChangeCustomAgents.fire();
		} catch (error) {
			this.logService.error(`[GitHubOrgCustomAgentProvider] Error polling for agents: ${error}`);
		}
	}

	private generateAgentMarkdown(agent: CustomAgentDetails): string {
		const frontmatterObj: Record<string, unknown> = {};

		if (agent.display_name) {
			frontmatterObj.name = yamlString(agent.display_name);
		}
		if (agent.description) {
			frontmatterObj.description = yamlString(agent.description);
		}
		if (agent.tools && agent.tools.length > 0 && agent.tools[0] !== '*') {
			frontmatterObj.tools = agent.tools;
		}
		if (agent.argument_hint) {
			frontmatterObj['argument-hint'] = agent.argument_hint;
		}
		if (agent.target) {
			frontmatterObj.target = agent.target;
		}
		if (agent.model) {
			frontmatterObj.model = agent.model;
		}
		if (agent.disable_model_invocation !== undefined) {
			frontmatterObj['disable-model-invocation'] = agent.disable_model_invocation;
		}
		if (agent.user_invocable !== undefined) {
			frontmatterObj['user-invocable'] = agent.user_invocable;
		}

		const frontmatter = YAML.stringify(frontmatterObj, {
			lineWidth: 0,
			doubleQuotedMinMultiLineLength: Infinity,
		}).trim();
		const body = agent.prompt ?? '';

		return `---\n${frontmatter}\n---\n${body}\n`;
	}
}

export function yamlString(value: string): string | Scalar {
	const needsQuoting =
		/[#:\[\]{},\n\r]/.test(value) ||
		value.startsWith('\'') ||
		value.startsWith('"') ||
		value !== value.trim() ||
		value === 'true' ||
		value === 'false' ||
		value === 'null' ||
		value === '~' ||
		looksLikeNumber(value);

	if (needsQuoting) {
		const scalar = new Scalar(value);
		scalar.type = (value.includes('\'') || value.includes('\n') || value.includes('\r'))
			? Scalar.QUOTE_DOUBLE
			: Scalar.QUOTE_SINGLE;
		return scalar;
	}
	return value;
}

export function looksLikeNumber(value: string): boolean {
	if (value === '') {
		return false;
	}
	const num = Number(value);
	return !isNaN(num) && isFinite(num) && /^-?\d*\.?\d+$/.test(value);
}
