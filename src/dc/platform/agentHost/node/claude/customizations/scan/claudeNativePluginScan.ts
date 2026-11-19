/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { ResourceSet } from '../../../../../../base/common/map.js';
import { IFileService } from '../../../../../files/common/files.js';
import { ILogService } from '../../../../../log/common/log.js';
import { detectPluginFormat, parsePlugin, readJsonFile, type IParsedPlugin } from '../../../../../agentPlugins/common/pluginParsers.js';
import { findMostSpecificClaudeWorkspaceRoot, selectEnabledClaudePluginIds } from '../claudeCustomizationPolicy.js';

export interface IResolvedNativePlugin {
	readonly id: string;
	readonly root: URI;
	readonly parsed: IParsedPlugin;
}

const SKILLS_DIR_MARKETPLACE = 'skills-dir';

function claudeSettingsFilesByPrecedence(workingDirectory: URI | undefined, userHome: URI): URI[] {
	const files: URI[] = [URI.joinPath(userHome, '.claude', 'settings.json')];
	if (workingDirectory) {
		files.push(URI.joinPath(workingDirectory, '.claude', 'settings.json'));
		files.push(URI.joinPath(workingDirectory, '.claude', 'settings.local.json'));
	}
	return files;
}

async function readEnabledPlugins(uri: URI, fileService: IFileService): Promise<ReadonlyMap<string, boolean>> {
	const result = new Map<string, boolean>();
	const raw = await readJsonFile(uri, fileService);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return result;
	}
	const enabledPlugins = (raw as Record<string, unknown>)['enabledPlugins'];
	if (!enabledPlugins || typeof enabledPlugins !== 'object' || Array.isArray(enabledPlugins)) {
		return result;
	}
	for (const [id, value] of Object.entries(enabledPlugins as Record<string, unknown>)) {
		result.set(id, value !== false);
	}
	return result;
}

async function resolveEnabledPluginIds(workingDirectory: URI | undefined, userHome: URI, fileService: IFileService): Promise<string[]> {
	const effective = new Map<string, boolean>();
	const seenFiles = new ResourceSet();
	for (const uri of claudeSettingsFilesByPrecedence(workingDirectory, userHome)) {
		if (seenFiles.has(uri)) {
			continue;
		}
		seenFiles.add(uri);
		const raw = await readJsonFile(uri, fileService);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			continue;
		}
		const enabledPlugins = (raw as Record<string, unknown>)['enabledPlugins'];
		if (!enabledPlugins || typeof enabledPlugins !== 'object' || Array.isArray(enabledPlugins)) {
			continue;
		}
		for (const [id, value] of Object.entries(enabledPlugins as Record<string, unknown>)) {
			effective.set(id, value !== false);
		}
	}
	return [...effective].filter(([, enabled]) => enabled).map(([id]) => id);
}

function splitPluginId(id: string): { readonly plugin: string; readonly marketplace: string } | undefined {
	const at = id.lastIndexOf('@');
	if (at <= 0 || at === id.length - 1) {
		return undefined;
	}
	const plugin = id.slice(0, at);
	const marketplace = id.slice(at + 1);
	const isUnsafeSegment = (s: string) => s.includes('/') || s.includes('\\') || s.includes('..');
	if (isUnsafeSegment(plugin) || isUnsafeSegment(marketplace)) {
		return undefined;
	}
	return { plugin, marketplace };
}

async function hasManifest(dir: URI, fileService: IFileService): Promise<boolean> {
	const format = await detectPluginFormat(dir, fileService);
	return fileService.exists(URI.joinPath(dir, format.manifestPath));
}

async function resolveSkillsDirRoot(plugin: string, workingDirectories: readonly URI[], userHome: URI, fileService: IFileService): Promise<URI | undefined> {
	const candidates: URI[] = [];
	for (const workingDirectory of workingDirectories) {
		candidates.push(URI.joinPath(workingDirectory, '.claude', 'skills', plugin));
	}
	candidates.push(URI.joinPath(userHome, '.claude', 'skills', plugin));
	for (const candidate of candidates) {
		if (await hasManifest(candidate, fileService)) {
			return candidate;
		}
	}
	return undefined;
}

async function resolveMarketplaceCacheRoot(plugin: string, marketplace: string, userHome: URI, fileService: IFileService): Promise<URI | undefined> {
	const base = URI.joinPath(userHome, '.claude', 'plugins', 'cache', marketplace, plugin);
	if (await hasManifest(base, fileService)) {
		return base;
	}
	let stat;
	try {
		stat = await fileService.resolve(base);
	} catch {
		return undefined;
	}
	if (!stat.isDirectory || !stat.children) {
		return undefined;
	}
	let best: { readonly uri: URI; readonly mtime: number; readonly name: string } | undefined;
	for (const child of stat.children) {
		if (!child.isDirectory || !(await hasManifest(child.resource, fileService))) {
			continue;
		}
		const mtime = child.mtime ?? 0;
		if (!best || mtime > best.mtime || (mtime === best.mtime && child.name.localeCompare(best.name, undefined, { numeric: true }) > 0)) {
			best = { uri: child.resource, mtime, name: child.name };
		}
	}
	return best?.uri;
}

export async function scanClaudeNativePlugins(
	workingDirectory: URI | undefined,
	userHome: URI,
	fileService: IFileService,
	logService: ILogService,
): Promise<readonly IResolvedNativePlugin[]> {
	const ids = await resolveEnabledPluginIds(workingDirectory, userHome, fileService);
	return resolveNativePlugins(ids, workingDirectory ? [workingDirectory] : [], userHome, fileService, logService);
}

export async function scanClaudeNativePluginsForRoots(
	workingDirectories: readonly URI[],
	userHome: URI,
	fileService: IFileService,
	logService: ILogService,
): Promise<readonly IResolvedNativePlugin[]> {
	const settingsFiles: URI[] = [];
	for (const workingDirectory of workingDirectories) {
		settingsFiles.push(
			URI.joinPath(workingDirectory, '.claude', 'settings.local.json'),
			URI.joinPath(workingDirectory, '.claude', 'settings.json'),
		);
	}
	settingsFiles.push(URI.joinPath(userHome, '.claude', 'settings.json'));
	const ids = selectEnabledClaudePluginIds(await Promise.all(settingsFiles.map(uri => readEnabledPlugins(uri, fileService))));
	return resolveNativePlugins(ids, workingDirectories, userHome, fileService, logService);
}

async function resolveNativePlugins(
	ids: readonly string[],
	workingDirectories: readonly URI[],
	userHome: URI,
	fileService: IFileService,
	logService: ILogService,
): Promise<readonly IResolvedNativePlugin[]> {
	const result: IResolvedNativePlugin[] = [];
	const seenRoots = new ResourceSet();
	for (const id of ids) {
		const parts = splitPluginId(id);
		if (!parts) {
			logService.warn(`[claudeNativePluginScan] skipping malformed plugin id '${id}'`);
			continue;
		}
		const root = parts.marketplace === SKILLS_DIR_MARKETPLACE
			? await resolveSkillsDirRoot(parts.plugin, workingDirectories, userHome, fileService)
			: await resolveMarketplaceCacheRoot(parts.plugin, parts.marketplace, userHome, fileService);
		if (!root) {
			logService.warn(`[claudeNativePluginScan] could not resolve an on-disk root for enabled plugin '${id}'`);
			continue;
		}
		if (seenRoots.has(root)) {
			continue;
		}
		seenRoots.add(root);
		try {
			const workspaceRoot = parts.marketplace === SKILLS_DIR_MARKETPLACE
				? findMostSpecificClaudeWorkspaceRoot(root, workingDirectories)
				: undefined;
			const parsed = await parsePlugin(root, fileService, workspaceRoot ?? workingDirectories[0], userHome, root);
			result.push({ id, root, parsed });
		} catch (err) {
			logService.warn(`[claudeNativePluginScan] failed to parse plugin '${id}' at '${root.toString()}': ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	result.sort((a, b) => a.id.localeCompare(b.id));
	return result;
}
