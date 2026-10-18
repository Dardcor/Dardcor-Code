/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AGENT_HOST_AUTOMATION_CATALOG_MIGRATED_META_KEY, AGENT_HOST_LEGACY_AUTOMATION_IMPORT_META_KEY, AGENT_HOST_LEGACY_AUTOMATION_IMPORT_PENDING_META_KEY } from '../automationMigration.js';

interface IHasAutomationMeta {
	readonly _meta?: Record<string, unknown>;
}

export function isAgentHostAutomationCatalogMigrated(source: IHasAutomationMeta): boolean {
	return readAutomationMetaSlot(source, AGENT_HOST_AUTOMATION_CATALOG_MIGRATED_META_KEY) === true;
}

export function isAgentHostLegacyAutomationImport(source: IHasAutomationMeta | undefined): boolean {
	return source !== undefined && readAutomationMetaSlot(source, AGENT_HOST_LEGACY_AUTOMATION_IMPORT_META_KEY) === true;
}

export function isAgentHostLegacyAutomationImportPending(source: IHasAutomationMeta | undefined): boolean {
	return source !== undefined && readAutomationMetaSlot(source, AGENT_HOST_LEGACY_AUTOMATION_IMPORT_PENDING_META_KEY) === true;
}

function readAutomationMetaSlot(source: IHasAutomationMeta, key: string): unknown {
	return source._meta?.[key];
}
