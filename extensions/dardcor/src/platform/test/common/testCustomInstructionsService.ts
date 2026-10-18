/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceSet } from '../../../util/dardcor/base/common/map';
import { URI } from '../../../util/dardcor/base/common/uri';
import type { Uri } from '../../../dardcorTypes';
import { Config } from '../../configuration/common/configurationService';
import { CodeGenerationInstruction, ICustomInstructions, ICustomInstructionsService, IInstructionIndexFile, ISkillInfo, SkillStorage } from '../../customInstructions/common/customInstructionsService';

export class MockCustomInstructionsService implements ICustomInstructionsService {
	declare readonly _serviceBrand: undefined;

	private skillFiles = new Map<string, SkillStorage>();
	private externalFiles = new Set<string>();
	private externalFolders = new Set<string>();
	private extensionSkillInfos = new Map<string, ISkillInfo & { extensionId: string }>();

	parseInstructionIndexFile(promptFileIndexText: string): IInstructionIndexFile {
		return {
			instructions: new ResourceSet(),
			skills: new ResourceSet(),
			skillFolders: new ResourceSet(),
			agents: new Set<string>()
		};
	}

	setSkillFiles(uris: URI[], storage: SkillStorage = SkillStorage.Workspace): void {
		this.skillFiles.clear();
		uris.forEach(uri => this.skillFiles.set(uri.toString(), storage));
	}

	setExternalFiles(uris: URI[]): void {
		this.externalFiles.clear();
		uris.forEach(uri => this.externalFiles.add(uri.toString()));
	}

	setExternalFolders(uris: URI[]): void {
		this.externalFolders.clear();
		uris.forEach(uri => this.externalFolders.add(uri.toString()));
	}

	setExtensionSkillInfos(infos: { uri: URI; skillName: string; skillFolderUri: URI; extensionId: string }[]): void {
		this.extensionSkillInfos.clear();
		infos.forEach(info => this.extensionSkillInfos.set(info.uri.toString(), { skillName: info.skillName, skillFolderUri: info.skillFolderUri, storage: SkillStorage.Extension, extensionId: info.extensionId }));
	}

	isSkillFile(uri: URI): boolean {
		return this.skillFiles.has(uri.toString());
	}

	isSkillMdFile(uri: URI): boolean {
		return this.isSkillFile(uri) && uri.path.toLowerCase().endsWith('skill.md');
	}

	getSkillDirectory(uri: URI): URI {
		return URI.parse(uri.toString().substring(0, uri.toString().lastIndexOf('/')));
	}

	getSkillName(uri: URI): string {
		const skillDir = this.getSkillDirectory(uri);
		const path = skillDir.path;
		return path.substring(path.lastIndexOf('/') + 1);
	}

	getSkillMdUri(uri: URI): URI {
		if (this.isSkillMdFile(uri)) {
			return uri;
		}
		const skillDir = this.getSkillDirectory(uri);
		return URI.joinPath(skillDir, 'SKILL.md');
	}

	getSkillInfo(uri: URI): ISkillInfo | undefined {
		if (!this.isSkillFile(uri)) {
			return undefined;
		}
		const skillFolderUri = this.getSkillDirectory(uri);
		const skillName = this.getSkillName(uri);
		const storage = this.skillFiles.get(uri.toString()) ?? SkillStorage.Workspace;
		return { skillName, skillFolderUri, storage };
	}

	isExternalInstructionsFile(uri: URI): Promise<boolean> {
		return Promise.resolve(this.externalFiles.has(uri.toString()));
	}

	isExternalInstructionsFolder(uri: URI): boolean {
		return this.externalFolders.has(uri.toString());
	}

	fetchInstructionsFromSetting(_configKey: Config<CodeGenerationInstruction[]>): Promise<ICustomInstructions[]> {
		return Promise.resolve([]);
	}

	fetchInstructionsFromFile(_fileUri: Uri): Promise<ICustomInstructions | undefined> {
		return Promise.resolve(undefined);
	}

	getAgentInstructions(): Promise<URI[]> {
		return Promise.resolve([]);
	}

	refreshExtensionPromptFiles(): Promise<void> {
		return Promise.resolve();
	}

	getExtensionSkillInfo(uri: URI): (ISkillInfo & { extensionId: string }) | undefined {
		return this.extensionSkillInfos.get(uri.toString());
	}
}
