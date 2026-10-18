/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';

export interface IClaudeMcpServerContributor {
	getMcpServers(): Promise<Record<string, McpServerConfig>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IClaudeMcpServerContributorCtor = new (...args: any[]) => IClaudeMcpServerContributor;

const contributorRegistry: IClaudeMcpServerContributorCtor[] = [];

export function registerClaudeMcpServerContributor(ctor: IClaudeMcpServerContributorCtor): void {
	contributorRegistry.push(ctor);
}

export function getClaudeMcpServerContributorRegistry(): readonly IClaudeMcpServerContributorCtor[] {
	return contributorRegistry;
}

export async function buildMcpServersFromRegistry(
	instantiationService: IInstantiationService
): Promise<Record<string, McpServerConfig> | undefined> {
	if (contributorRegistry.length === 0) {
		return undefined;
	}

	const result: Record<string, McpServerConfig> = {};

	for (const ctor of contributorRegistry) {
		const contributor = instantiationService.createInstance(ctor);
		const servers = await contributor.getMcpServers();
		Object.assign(result, servers);
	}

	return Object.keys(result).length > 0 ? result : undefined;
}
