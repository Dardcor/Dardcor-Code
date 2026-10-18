/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, ServicesAccessor } from '../../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { normalizeLanguageId, SimilarFileInfo } from '../../../../prompt/src/prompt';
import { CancellationToken as ICancellationToken } from '../../../../types/src';
import { ICompletionsFeaturesService } from '../../experiments/featuresService';
import { ICompletionsLogTargetService } from '../../logger';
import { TelemetryWithExp } from '../../telemetry';
import { ICompletionsTextDocumentManagerService } from '../../textDocumentManager';
import { OpenTabFiles } from './openTabFiles';
import { getRelatedFilesAndTraits, relatedFilesLogger, RelatedFileTrait } from './relatedFiles';

export enum NeighboringFileType {
	None = 'none',
	OpenTabs = 'opentabs',
	CursorMostRecent = 'cursormostrecent',
	CursorMostCount = 'cursormostcount',
	WorkspaceSharingSameFolder = 'workspacesharingsamefolder',
	WorkspaceSmallestPathDist = 'workspacesmallestpathdist',
	OpenTabsAndCocommitted = 'opentabsandcocommitted',
	RelatedCSharp = 'related/csharp',
	RelatedCSharpRoslyn = 'related/csharproslyn',
	RelatedCpp = 'related/cpp',
	RelatedTypeScript = 'related/typescript',
	RelatedCppSemanticCodeContext = 'related/cppsemanticcodecontext',
	RelatedOther = 'related/other',
}

export function isRelatedNeighboringFileType(type: NeighboringFileType): boolean {
	switch (type) {
		case NeighboringFileType.RelatedCSharp:
		case NeighboringFileType.RelatedCSharpRoslyn:
		case NeighboringFileType.RelatedCpp:
		case NeighboringFileType.RelatedTypeScript:
		case NeighboringFileType.RelatedCppSemanticCodeContext:
		case NeighboringFileType.RelatedOther:
			return true;
		default:
			return false;
	}
}

export function considerNeighborFile(languageId: string, neighborLanguageId: string): boolean {
	return normalizeLanguageId(languageId) === normalizeLanguageId(neighborLanguageId);
}

export type NeighborsCollection = Map<string, SimilarFileInfo>;

export interface INeighborSource {
	getNeighborFiles(
		uri: string,
		languageId: string,
		maxNumNeighborFiles: number
	): Promise<{ docs: NeighborsCollection; neighborSource: Map<NeighboringFileType, string[]> }>;
}

export class NeighborSource {
	static MAX_NEIGHBOR_AGGREGATE_LENGTH = 200000;
	static MAX_NEIGHBOR_FILES = 20;

	static EXCLUDED_NEIGHBORS = ['node_modules', 'dist', 'site-packages'];

	static defaultEmptyResult() {
		return {
			docs: new Map<string, SimilarFileInfo>(),
			neighborSource: new Map<NeighboringFileType, string[]>(),
			traits: [] as RelatedFileTrait[],
		};
	}

	private static instance: INeighborSource | undefined;

	static reset(): void {
		NeighborSource.instance = undefined;
	}

	static async getNeighborFilesAndTraits(
		accessor: ServicesAccessor,
		uri: string,
		fileType: string,
		telemetryData: TelemetryWithExp,
		cancellationToken?: ICancellationToken,
		data?: unknown,
		forceRelatedFilesComputation?: boolean,
		includeRelatedFiles: boolean = true
	): Promise<{
		docs: NeighborsCollection;
		neighborSource: Map<NeighboringFileType, string[]>;
		traits: RelatedFileTrait[];
	}> {
		const featuresService = accessor.get(ICompletionsFeaturesService);
		const logTarget = accessor.get(ICompletionsLogTargetService);
		const instantiationService = accessor.get(IInstantiationService);
		const docManager = accessor.get(ICompletionsTextDocumentManagerService);
		if (NeighborSource.instance === undefined) {
			NeighborSource.instance = instantiationService.createInstance(OpenTabFiles);
		}

		const result = {
			...(await NeighborSource.instance.getNeighborFiles(uri, fileType, NeighborSource.MAX_NEIGHBOR_FILES)),
			traits: [] as RelatedFileTrait[],
		};

		if (!includeRelatedFiles || featuresService.excludeRelatedFiles(fileType, telemetryData)) { return result; }

		const doc = await docManager.getTextDocument({ uri });
		if (!doc) {
			relatedFilesLogger.debug(logTarget,
				'neighborFiles.getNeighborFilesAndTraits',
				`Failed to get the related files: failed to get the document ${uri}`
			);
			return result;
		}

		const wksFolder = docManager.getWorkspaceFolder(doc);
		if (!wksFolder) {
			relatedFilesLogger.debug(logTarget,
				'neighborFiles.getNeighborFilesAndTraits',
				`Failed to get the related files: ${uri} is not under the workspace folder`
			);
			return result;
		}

		const relatedFiles = await instantiationService.invokeFunction(getRelatedFilesAndTraits,
			doc,
			telemetryData,
			cancellationToken,
			data,
			forceRelatedFilesComputation
		);

		if (relatedFiles.entries.size === 0) {
			relatedFilesLogger.debug(logTarget,
				'neighborFiles.getNeighborFilesAndTraits',
				`0 related files found for ${uri}`
			);
			result.traits.push(...relatedFiles.traits);
			return result;
		}

		relatedFiles.entries.forEach((uriToContentMap, type) => {
			const addedDocs: SimilarFileInfo[] = [];
			uriToContentMap.forEach((source, uri) => {
				const relativePath = NeighborSource.getRelativePath(uri, wksFolder.uri);
				if (!relativePath) { return; }
				if (result.docs.has(uri)) { return; }
				const relatedFileDocInfo: SimilarFileInfo = { relativePath, uri, source, isFromRelatedFile: isRelatedNeighboringFileType(type) };
				addedDocs.unshift(relatedFileDocInfo);
				result.docs.set(uri, relatedFileDocInfo);
			});

			if (addedDocs.length > 0) {
				result.neighborSource.set(
					type,
					addedDocs.map(doc => doc.uri.toString())
				);
			}
		});
		result.traits.push(...relatedFiles.traits);

		return result;
	}

	static basename(uri: string): string {
		return decodeURIComponent(uri.replace(/[#?].*$/, '').replace(/^.*[/:]/, ''));
	}

	static getRelativePath(fileUri: string, baseUri: string): string | undefined {
		const parentURI = baseUri
			.toString()
			.replace(/[#?].*/, '')
			.replace(/\/?$/, '/');
		if (fileUri.toString().startsWith(parentURI)) {
			return fileUri.toString().slice(parentURI.length);
		}
		return NeighborSource.basename(fileUri);
	}
}

export function isIncludeNeighborFilesActive(accessor: ServicesAccessor, languageId: string, telemetryData: TelemetryWithExp): boolean {
	const featuresService = accessor.get(ICompletionsFeaturesService);
	return featuresService.includeNeighboringFiles(languageId, telemetryData);
}
