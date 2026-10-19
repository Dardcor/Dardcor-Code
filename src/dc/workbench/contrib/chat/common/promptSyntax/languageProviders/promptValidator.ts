/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEmptyPattern, parse, splitGlobAware } from '../../../../../../base/common/glob.js';
import { Iterable } from '../../../../../../base/common/iterator.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { localize } from '../../../../../../nls.js';
import { IMarkerData, MarkerSeverity, MarkerTag } from '../../../../../../platform/markers/common/markers.js';
import { ChatMode, IChatMode, IChatModeService } from '../../chatModes.js';
import { ChatModeKind } from '../../constants.js';
import { ILanguageModelChatMetadata, ILanguageModelsService } from '../../languageModels.js';
import { ILanguageModelToolsService, SpecedToolAliases } from '../../tools/languageModelToolsService.js';
import { PromptsType, Target } from '../promptTypes.js';
import { ISequenceValue, IHeaderAttribute, IScalarValue, parseCommaSeparatedList, ParsedPromptFile, PromptHeader, IValue, PromptHeaderAttributes } from '../promptFileParser.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IPromptsService } from '../service/promptsService.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { AGENTS_SOURCE_FOLDER, isSkillFilename, LEGACY_MODE_FILE_EXTENSION, VALID_SKILL_NAME_REGEX } from '../config/promptFileLocations.js';
import { Lazy } from '../../../../../../base/common/lazy.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { HOOKS_BY_TARGET } from '../hookTypes.js';
import {
	GithubPromptHeaderAttributes,
	getTarget,
	isVSCodeOrDefaultTarget,
	getValidAttributeNames,
	isNonRecommendedAttribute,
	claudeAgentAttributes,
	claudeRulesAttributes,
	mapClaudeModels,
	mapClaudeTools,
} from './promptFileAttributes.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

export const MARKERS_OWNER_ID = 'prompts-diagnostics-provider';

export const enum PromptValidatorMarkerCode {
	MissingGithubMcpServer = 'promptValidator.missingGithubMcpServer',
	MissingPlaywrightMcpServer = 'promptValidator.missingPlaywrightMcpServer',
	UnknownExtensionReference = 'promptValidator.unknownExtensionReference',
	UnknownMcpServerReference = 'promptValidator.unknownMcpServerReference',
	UnknownExtensionOrMcpServerReference = 'promptValidator.unknownExtensionOrMcpServerReference'
}

export class PromptValidator {
	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILanguageModelToolsService private readonly languageModelToolsService: ILanguageModelToolsService,
		@IChatModeService private readonly chatModeService: IChatModeService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IPromptsService private readonly promptsService: IPromptsService,
		@ILogService private readonly logger: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) { }

	public async validate(promptAST: ParsedPromptFile, promptType: PromptsType, report: (markers: IMarkerData) => void): Promise<void> {
		promptAST.header?.errors.forEach(error => report(toMarker(error.message, error.range, MarkerSeverity.Error)));
		const target = getTarget(promptType, promptAST.header ?? promptAST.uri);
		await this.validateHeader(promptAST, promptType, target, report);
		await this.validateBody(promptAST, target, report);
		await this.validateFileName(promptAST, promptType, report);
		await this.validateSkillAttributes(promptAST, promptType, report);
	}

	private async validateFileName(promptAST: ParsedPromptFile, promptType: PromptsType, report: (markers: IMarkerData) => void): Promise<void> {
		if (promptType === PromptsType.agent && promptAST.uri.path.endsWith(LEGACY_MODE_FILE_EXTENSION)) {
			const location = this.promptsService.getAgentFileURIFromModeFile(promptAST.uri);
			if (location && await this.fileService.canCreateFile(location)) {
				report(toMarker(localize('promptValidator.chatModesRenamedToAgents', "Chat modes have been renamed to agents. Please move this file to {0}", location.toString()), new Range(1, 1, 1, 4), MarkerSeverity.Warning));
			} else {
				report(toMarker(localize('promptValidator.chatModesRenamedToAgentsNoMove', "Chat modes have been renamed to agents. Please move the file to {0}", AGENTS_SOURCE_FOLDER), new Range(1, 1, 1, 4), MarkerSeverity.Warning));
			}
		}
	}

	private async validateSkillAttributes(promptAST: ParsedPromptFile, promptType: PromptsType, report: (markers: IMarkerData) => void): Promise<void> {
		if (promptType !== PromptsType.skill || !promptAST.header) {
			return;
		}

		const nameAttribute = promptAST.header.getAttribute(PromptHeaderAttributes.name);
		if (!nameAttribute) {
			report(toMarker(
				localize('promptValidator.skillNameMissing', "Skill should provide a name."),
				new Range(1, 1, 1, 4),
				MarkerSeverity.Warning
			));
		} else if (nameAttribute.value.type === 'scalar') {
			const skillName = nameAttribute.value.value.trim();
			if (skillName.length > 0) {
				if (!VALID_SKILL_NAME_REGEX.test(skillName)) {
					report(toMarker(
						localize('promptValidator.skillNameInvalidChars', "Skill name may only contain lowercase letters, numbers, and hyphens."),
						nameAttribute.value.range,
						MarkerSeverity.Error
					));
				}

				const pathParts = promptAST.uri.path.split('/');
				const skillIndex = pathParts.findIndex(part => isSkillFilename(part));
				if (skillIndex > 0) {
					const folderName = pathParts[skillIndex - 1];
					if (folderName && skillName !== folderName) {
						report(toMarker(
							localize('promptValidator.skillNameFolderMismatch', "The skill name '{0}' should match the folder name '{1}'.", skillName, folderName),
							nameAttribute.value.range,
							MarkerSeverity.Warning
						));
					}
				}
			}
		}

		const descriptionAttribute = promptAST.header.getAttribute(PromptHeaderAttributes.description);
		if (!descriptionAttribute) {
			report(toMarker(
				localize('promptValidator.skillDescriptionMissing', "Skill should provide a description."),
				new Range(1, 1, 1, 4),
				MarkerSeverity.Warning
			));

			if (promptAST.header.userInvocable === false) {
				const userInvocableAttr = promptAST.header.getAttribute(PromptHeaderAttributes.userInvocable);
				if (userInvocableAttr) {
					report(toMarker(
						localize('promptValidator.skillUserInvocableRequiresDescription', "A description is required when user-invocable is false, because the model needs a description to decide when to load the skill."),
						userInvocableAttr.value.range,
						MarkerSeverity.Error
					));
				}
			}

			if (promptAST.header.disableModelInvocation === false) {
				const disableModelInvocationAttr = promptAST.header.getAttribute(PromptHeaderAttributes.disableModelInvocation);
				if (disableModelInvocationAttr) {
					report(toMarker(
						localize('promptValidator.skillModelInvocationRequiresDescription', "A description is required when model invocation is enabled, because the model needs a description to decide when to load the skill."),
						disableModelInvocationAttr.value.range,
						MarkerSeverity.Error
					));
				}
			}
		}

		const contextAttribute = promptAST.header?.getAttribute(PromptHeaderAttributes.context);
		if (contextAttribute && contextAttribute.value.type === 'scalar' && contextAttribute.value.value.trim() === 'fork') {
			const skillToolEnabled = this.configurationService.getValue<boolean>('github.copilot.chat.skillTool.enabled');
			if (!skillToolEnabled) {
				report(toMarker(
					localize('promptValidator.contextForkNotSupported', "The 'context: fork' attribute requires the skill tool to be enabled (github.copilot.chat.skillTool.enabled)."),
					contextAttribute.value.range,
					MarkerSeverity.Warning
				));
			}
		}
	}

	private async validateBody(promptAST: ParsedPromptFile, target: Target, report: (markers: IMarkerData) => void): Promise<void> {
		const body = promptAST.body;
		if (!body) {
			return;
		}

		const fileReferenceChecks: Promise<void>[] = [];
		for (const ref of body.fileReferences) {
			const resolved = body.resolveFilePath(ref.content);
			if (!resolved) {
				report(toMarker(localize('promptValidator.invalidFileReference', "Invalid file reference '{0}'.", ref.content), ref.range, MarkerSeverity.Warning));
				continue;
			}
			if (promptAST.uri.scheme === resolved.scheme) {
				fileReferenceChecks.push((async () => {
					try {
						const exists = await this.fileService.exists(resolved);
						if (!exists) {
							const loc = this.labelService.getUriLabel(resolved);
							report(toMarker(localize('promptValidator.fileNotFound', "File '{0}' not found at '{1}'.", ref.content, loc), ref.range, MarkerSeverity.Warning));
						}
					} catch (e) {
						this.logger.warn(`Error checking existence of file reference '${ref.content}' resolved to '${resolved.toString()}' in prompt file '${promptAST.uri.toString()}': ${e.message}`);
					}
				})());
			}
		}

		if (body.variableReferences.length && isVSCodeOrDefaultTarget(target)) {
			const headerTools = promptAST.header?.tools;
			const headerToolsMap = headerTools ? this.languageModelToolsService.toToolAndToolSetEnablementMap(headerTools, undefined) : undefined;

			const available = new Set<string>(this.languageModelToolsService.getFullReferenceNames());
			const deprecatedNames = this.languageModelToolsService.getDeprecatedFullReferenceNames();
			for (const variable of body.variableReferences) {
				if (!available.has(variable.name)) {
					if (deprecatedNames.has(variable.name)) {
						const currentNames = deprecatedNames.get(variable.name);
						if (currentNames && currentNames.size > 0) {
							if (currentNames.size === 1) {
								const newName = Array.from(currentNames)[0];
								report(toMarker(localize('promptValidator.deprecatedVariableReference', "Tool or toolset '{0}' has been renamed, use '{1}' instead.", variable.name, newName), variable.range, MarkerSeverity.Info));
							} else {
								const newNames = Array.from(currentNames).sort((a, b) => a.localeCompare(b)).join(', ');
								report(toMarker(localize('promptValidator.deprecatedVariableReferenceMultipleNames', "Tool or toolset '{0}' has been renamed, use the following tools instead: {1}", variable.name, newNames), variable.range, MarkerSeverity.Info));
							}
						}
					} else {
						const missingGithubServerMarker = this.getMissingGithubMcpServerMarker(variable.name, variable.range);
						if (missingGithubServerMarker) {
							report(missingGithubServerMarker);
						} else {
							const missingPlaywrightServerMarker = this.getMissingPlaywrightMcpServerMarker(variable.name, variable.range);
							if (missingPlaywrightServerMarker) {
								report(missingPlaywrightServerMarker);
							} else {
								report(this.getUnknownToolMarker(variable.name, variable.range, true));
							}
						}
					}
				} else if (headerToolsMap) {
					const tool = this.languageModelToolsService.getToolByFullReferenceName(variable.name);
					if (tool && headerToolsMap.get(tool) === false) {
						report(toMarker(localize('promptValidator.disabledTool', "Tool or toolset '{0}' also needs to be enabled in the header.", variable.name), variable.range, MarkerSeverity.Warning));
					}
				}
			}
		}

		await Promise.all(fileReferenceChecks);
	}

	private async validateHeader(promptAST: ParsedPromptFile, promptType: PromptsType, target: Target, report: (markers: IMarkerData) => void): Promise<void> {
		const header = promptAST.header;
		if (!header) {
			return;
		}
		const attributes = header.attributes;
		this.checkForInvalidArguments(attributes, promptType, target, report);

		this.validateName(attributes, report);
		this.validateDescription(attributes, report);
		this.validateArgumentHint(attributes, report);
		switch (promptType) {
			case PromptsType.prompt: {
				const agent = await this.validateAgent(attributes, report);
				this.validateTools(attributes, agent?.kind ?? ChatModeKind.Agent, target, report);
				this.validateModel(attributes, agent?.kind ?? ChatModeKind.Agent, report);
				break;
			}
			case PromptsType.instructions:
				if (target === Target.Claude) {
					this.validatePaths(attributes, report);
				} else {
					this.validateApplyTo(attributes, report);
				}
				this.validateExcludeAgent(attributes, report);
				break;

			case PromptsType.agent: {
				this.validateTarget(attributes, report);
				this.validateInfer(attributes, report);
				this.validateUserInvocable(attributes, report);
				this.validateDisableModelInvocation(attributes, report);
				this.validateTools(attributes, ChatModeKind.Agent, target, report);
				this.validateHooks(attributes, target, report);
				if (isVSCodeOrDefaultTarget(target)) {
					this.validateModel(attributes, ChatModeKind.Agent, report);
					this.validateHandoffs(attributes, report);
					await this.validateAgentsAttribute(attributes, header, report);
					this.validateGithubPermissions(attributes, report);
				} else if (target === Target.Claude) {
					this.validateClaudeAttributes(attributes, report);
				} else if (target === Target.GitHubCopilot) {
					this.validateGithubPermissions(attributes, report);
				}
				break;
			}

			case PromptsType.skill:
				this.validateUserInvocable(attributes, report);
				this.validateDisableModelInvocation(attributes, report);
				break;
		}
	}

	private checkForInvalidArguments(attributes: IHeaderAttribute[], promptType: PromptsType, target: Target, report: (markers: IMarkerData) => void): void {
		const validAttributeNames = getValidAttributeNames(promptType, true, target);
		const validGithubCopilotAttributeNames = new Lazy(() => new Set(getValidAttributeNames(promptType, false, Target.GitHubCopilot)));
		for (const attribute of attributes) {
			if (!validAttributeNames.includes(attribute.key)) {
				const supportedNames = new Lazy(() => {
					const names = getValidAttributeNames(promptType, false, target);
					return names.sort().join(', ');
				});
				switch (promptType) {
					case PromptsType.prompt:
						report(toMarker(localize('promptValidator.unknownAttribute.prompt', "Attribute '{0}' is not supported in prompt files. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
						break;
					case PromptsType.agent:
						if (target === Target.GitHubCopilot) {
							report(toMarker(localize('promptValidator.unknownAttribute.github-agent', "Attribute '{0}' is not supported in custom Dardcor agent files. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
						} else if (target === Target.Claude) {
						} else {
							if (validGithubCopilotAttributeNames.value.has(attribute.key)) {
								report(toMarker(localize('promptValidator.ignoredAttribute.vscode-agent', "Attribute '{0}' is ignored when running locally in VS Code.", attribute.key), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
							} else {
								report(toMarker(localize('promptValidator.unknownAttribute.vscode-agent', "Attribute '{0}' is not supported in VS Code agent files. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
							}
						}
						break;
					case PromptsType.instructions:
						if (target === Target.Claude) {
							report(toMarker(localize('promptValidator.unknownAttribute.rules', "Attribute '{0}' is not supported in rules files by VS Code agents. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
						} else {
							report(toMarker(localize('promptValidator.unknownAttribute.instructions', "Attribute '{0}' is not supported in instructions files. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
						}
						break;
					case PromptsType.skill:
						report(toMarker(localize('promptValidator.unknownAttribute.skill', "Attribute '{0}' is not supported by VS Code agents. Supported: {1}.", attribute.key, supportedNames.value), attribute.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
						break;
				}
			}
		}
	}



	private validateName(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): void {
		const nameAttribute = attributes.find(attr => attr.key === PromptHeaderAttributes.name);
		if (!nameAttribute) {
			return;
		}
		if (nameAttribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.nameMustBeString', "The 'name' attribute must be a string."), nameAttribute.range, MarkerSeverity.Error));
			return;
		}
		if (nameAttribute.value.value.trim().length === 0) {
			report(toMarker(localize('promptValidator.nameShouldNotBeEmpty', "The 'name' attribute must not be empty."), nameAttribute.value.range, MarkerSeverity.Error));
			return;
		}
	}

	private validateDescription(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): void {
		const descriptionAttribute = attributes.find(attr => attr.key === PromptHeaderAttributes.description);
		if (!descriptionAttribute) {
			return;
		}
		if (descriptionAttribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.descriptionMustBeString', "The 'description' attribute must be a string."), descriptionAttribute.range, MarkerSeverity.Error));
			return;
		}
		if (descriptionAttribute.value.value.trim().length === 0) {
			report(toMarker(localize('promptValidator.descriptionShouldNotBeEmpty', "The 'description' attribute should not be empty."), descriptionAttribute.value.range, MarkerSeverity.Error));
			return;
		}
	}

	private validateArgumentHint(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): void {
		const argumentHintAttribute = attributes.find(attr => attr.key === PromptHeaderAttributes.argumentHint);
		if (!argumentHintAttribute) {
			return;
		}
		if (argumentHintAttribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.argumentHintMustBeString', "The 'argument-hint' attribute must be a string."), argumentHintAttribute.range, MarkerSeverity.Error));
			return;
		}
		if (argumentHintAttribute.value.value.trim().length === 0) {
			report(toMarker(localize('promptValidator.argumentHintShouldNotBeEmpty', "The 'argument-hint' attribute should not be empty."), argumentHintAttribute.value.range, MarkerSeverity.Warning));
			return;
		}
	}

	private validateModel(attributes: IHeaderAttribute[], agentKind: ChatModeKind, report: (markers: IMarkerData) => void): void {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.model);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'scalar' && attribute.value.type !== 'sequence') {
			report(toMarker(localize('promptValidator.modelMustBeStringOrArray', "The 'model' attribute must be a string or an array of strings."), attribute.value.range, MarkerSeverity.Error));
			return;
		}

		const modelNames: [string, Range][] = [];
		if (attribute.value.type === 'scalar') {
			const modelName = attribute.value.value.trim();
			if (modelName.length === 0) {
				report(toMarker(localize('promptValidator.modelMustBeNonEmpty', "The 'model' attribute must be a non-empty string."), attribute.value.range, MarkerSeverity.Error));
				return;
			}
			modelNames.push([modelName, attribute.value.range]);
		} else if (attribute.value.type === 'sequence') {
			if (attribute.value.items.length === 0) {
				report(toMarker(localize('promptValidator.modelArrayMustNotBeEmpty', "The 'model' array must not be empty."), attribute.value.range, MarkerSeverity.Error));
				return;
			}
			for (const item of attribute.value.items) {
				if (item.type !== 'scalar') {
					report(toMarker(localize('promptValidator.modelArrayMustContainStrings', "The 'model' array must contain only strings."), item.range, MarkerSeverity.Error));
					return;
				}
				const modelName = item.value.trim();
				if (modelName.length === 0) {
					report(toMarker(localize('promptValidator.modelArrayItemMustBeNonEmpty', "Model names in the array must be non-empty strings."), item.range, MarkerSeverity.Error));
					return;
				}
				modelNames.push([modelName, item.range]);
			}
		}

		const languageModels = this.languageModelsService.getLanguageModelIds();
		if (languageModels.length === 0) {
			return;
		}

		for (const [modelName, range] of modelNames) {
			const modelMetadata = this.findModelByName(modelName);
			if (!modelMetadata) {
				report(toMarker(localize('promptValidator.modelNotFound', "Unknown model '{0}' will be ignored.", modelName), range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
			} else if (agentKind === ChatModeKind.Agent && !ILanguageModelChatMetadata.suitableForAgentMode(modelMetadata)) {
				report(toMarker(localize('promptValidator.modelNotSuited', "Model '{0}' is not suited for agent mode.", modelName), range, MarkerSeverity.Warning));
			}
		}
	}

	private validateClaudeAttributes(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): void {
		for (const claudeAttributeName in claudeAgentAttributes) {
			const claudeAttribute = claudeAgentAttributes[claudeAttributeName];
			const enumValues = claudeAttribute.enums;
			if (enumValues) {
				const attribute = attributes.find(attr => attr.key === claudeAttributeName);
				if (!attribute) {
					continue;
				}
				if (attribute.value.type !== 'scalar') {
					report(toMarker(localize('promptValidator.claude.attributeMustBeString', "The '{0}' attribute must be a string.", claudeAttributeName), attribute.value.range, MarkerSeverity.Error));
					continue;
				} else {
					const modelName = attribute.value.value.trim();
					if (enumValues.every(model => model.name !== modelName)) {
						const validValues = enumValues.map(model => model.name).join(', ');
						report(toMarker(localize('promptValidator.claude.attributeNotFound', "Unknown value '{0}', valid: {1}.", modelName, validValues), attribute.value.range, MarkerSeverity.Warning));
					}
				}
			}
		}
	}

	private findModelByName(modelName: string): ILanguageModelChatMetadata | undefined {
		const metadataAndId = this.languageModelsService.lookupLanguageModelByQualifiedName(modelName);
		if (metadataAndId && metadataAndId.metadata.isUserSelectable !== false) {
			return metadataAndId.metadata;
		}
		return undefined;
	}

	private async validateAgent(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): Promise<IChatMode | undefined> {
		const agentAttribute = attributes.find(attr => attr.key === PromptHeaderAttributes.agent);
		const modeAttribute = attributes.find(attr => attr.key === PromptHeaderAttributes.mode);
		if (modeAttribute) {
			if (agentAttribute) {
				report(toMarker(localize('promptValidator.modeDeprecated', "The 'mode' attribute has been deprecated. The 'agent' attribute is used instead."), modeAttribute.range, MarkerSeverity.Warning, [MarkerTag.Deprecated]));
			} else {
				report(toMarker(localize('promptValidator.modeDeprecated.useAgent', "The 'mode' attribute has been deprecated. Please rename it to 'agent'."), modeAttribute.range, MarkerSeverity.Warning, [MarkerTag.Deprecated]));
			}
		}

		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.agent) ?? modeAttribute;
		if (!attribute) {
			return undefined;
		}
		if (attribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.attributeMustBeString', "The '{0}' attribute must be a string.", attribute.key), attribute.value.range, MarkerSeverity.Error));
			return undefined;
		}
		const agentValue = attribute.value.value;
		if (agentValue.trim().length === 0) {
			report(toMarker(localize('promptValidator.attributeMustBeNonEmpty', "The '{0}' attribute must be a non-empty string.", attribute.key), attribute.value.range, MarkerSeverity.Error));
			return undefined;
		}
		return await this.validateAgentValue(attribute.value, report);
	}

	private async validateAgentValue(value: IScalarValue, report: (markers: IMarkerData) => void): Promise<IChatMode | undefined> {
		const agents = await this.chatModeService.getLocalModes();
		const availableAgents = [];

		for (const agent of Iterable.concat(agents.builtin, agents.custom)) {
			if (agent.name.get() === value.value) {
				return agent;
			}
			availableAgents.push(agent.name.get());
		}

		const errorMessage = localize('promptValidator.agentNotFound', "Unknown agent '{0}'. Available agents: {1}.", value.value, availableAgents.join(', '));
		report(toMarker(errorMessage, value.range, MarkerSeverity.Warning));
		return undefined;
	}

	private validateTools(attributes: IHeaderAttribute[], agentKind: ChatModeKind, target: Target, report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.tools);
		if (!attribute) {
			return;
		}
		if (agentKind !== ChatModeKind.Agent) {
			report(toMarker(localize('promptValidator.toolsOnlyInAgent', "The 'tools' attribute is only supported when using agents. Attribute will be ignored."), attribute.range, MarkerSeverity.Warning));
		}
		let value = attribute.value;
		if (value.type === 'scalar') {
			value = parseCommaSeparatedList(value);
		}
		if (value.type !== 'sequence') {
			report(toMarker(localize('promptValidator.toolsMustBeArrayOrMap', "The 'tools' attribute must be an array or a comma separated string."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		if (target === Target.GitHubCopilot || target === Target.Claude) {
		} else {
			this.validateVSCodeTools(value, report);
		}
	}

	private validateVSCodeTools(valueItem: ISequenceValue, report: (markers: IMarkerData) => void) {
		if (valueItem.items.length > 0) {
			const available = new Set<string>(this.languageModelToolsService.getFullReferenceNames());
			const deprecatedNames = this.languageModelToolsService.getDeprecatedFullReferenceNames();
			for (const item of valueItem.items) {
				if (item.type !== 'scalar') {
					report(toMarker(localize('promptValidator.eachToolMustBeString', "Each tool name in the 'tools' attribute must be a string."), item.range, MarkerSeverity.Error));
				} else if (item.value) {
					if (!available.has(item.value)) {
						const currentNames = deprecatedNames.get(item.value);
						if (currentNames) {
							if (currentNames?.size === 1) {
								const newName = Array.from(currentNames)[0];
								report(toMarker(localize('promptValidator.toolDeprecated', "Tool or toolset '{0}' has been renamed, use '{1}' instead.", item.value, newName), item.range, MarkerSeverity.Info, [MarkerTag.Deprecated]));
							} else {
								const newNames = Array.from(currentNames).sort((a, b) => a.localeCompare(b)).join(', ');
								report(toMarker(localize('promptValidator.toolDeprecatedMultipleNames', "Tool or toolset '{0}' has been renamed, use the following tools instead: {1}", item.value, newNames), item.range, MarkerSeverity.Info, [MarkerTag.Deprecated]));
							}
						} else {
							const missingGithubServerMarker = this.getMissingGithubMcpServerMarker(item.value, item.range);
							if (missingGithubServerMarker) {
								report(missingGithubServerMarker);
							} else {
								const missingPlaywrightServerMarker = this.getMissingPlaywrightMcpServerMarker(item.value, item.range);
								if (missingPlaywrightServerMarker) {
									report(missingPlaywrightServerMarker);
								} else {
									report(this.getUnknownToolMarker(item.value, item.range, false));
								}
							}
						}
					}
				}
			}
		}
	}

	private getUnknownToolMarker(toolReferenceName: string, range: Range, isVariableReference: boolean): IMarkerData {
		const splitBySlash = toolReferenceName.split('/');
		const slashCount = splitBySlash.length - 1;
		const hasExtensionLikeName = splitBySlash[0].includes('.');
		if (slashCount >= 2) {
			return toMarker(
				localize(
					'promptValidator.unknownMcpServerReference',
					"Unknown tool '{0}'. It is likely to be a missing MCP server, please ensure it is installed and enabled.",
					toolReferenceName
				),
				range,
				MarkerSeverity.Hint,
				[MarkerTag.Unnecessary],
				PromptValidatorMarkerCode.UnknownMcpServerReference
			);
		}
		if (hasExtensionLikeName) {
			return toMarker(
				localize(
					'promptValidator.unknownExtensionReference',
					"Unknown extension tool '{0}'. It is likely to be a missing extension, please ensure it is installed and enabled.",
					toolReferenceName
				),
				range,
				MarkerSeverity.Hint,
				[MarkerTag.Unnecessary],
				PromptValidatorMarkerCode.UnknownExtensionReference
			);
		}
		if (isVariableReference) {
			return toMarker(
				localize(
					'promptValidator.unknownVariableReference',
					"Unknown tool or toolset '{0}'.",
					toolReferenceName
				),
				range,
				MarkerSeverity.Hint,
				[MarkerTag.Unnecessary],
				PromptValidatorMarkerCode.UnknownExtensionOrMcpServerReference
			);
		} else {
			return toMarker(
				localize(
					'promptValidator.unknownToolReference',
					"Unknown tool '{0}' will be ignored.",
					toolReferenceName
				),
				range,
				MarkerSeverity.Hint,
				[MarkerTag.Unnecessary],
				PromptValidatorMarkerCode.UnknownExtensionOrMcpServerReference
			);
		}
	}

	private getMissingGithubMcpServerMarker(toolReferenceName: string, range: Range): IMarkerData | undefined {
		if (toolReferenceName !== 'github/*') {
			return undefined;
		}
		return toMarker(
			localize(
				'promptValidator.missingGithubMcpServer',
				"Tool alias '{0}' requires the GitHub MCP server. Enable the built-in server with setting 'github.copilot.chat.githubMcpServer.enabled' or install extension 'io.github.github/github-mcp-server' from Extensions (`@mcp github`).",
				toolReferenceName
			),
			range,
			MarkerSeverity.Hint,
			[MarkerTag.Unnecessary],
			PromptValidatorMarkerCode.MissingGithubMcpServer
		);
	}

	private getMissingPlaywrightMcpServerMarker(toolReferenceName: string, range: Range): IMarkerData | undefined {
		if (toolReferenceName !== 'playwright/*') {
			return undefined;
		}
		return toMarker(
			localize(
				'promptValidator.missingPlaywrightMcpServer',
				"Tool alias '{0}' requires the Playwright MCP server. Install it from Extensions (`@mcp playwright`).",
				toolReferenceName
			),
			range,
			MarkerSeverity.Hint,
			[MarkerTag.Unnecessary],
			PromptValidatorMarkerCode.MissingPlaywrightMcpServer
		);
	}

	private validateApplyTo(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.applyTo);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.applyToMustBeString', "The 'applyTo' attribute must be a string."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		const pattern = attribute.value.value;
		try {
			const patterns = splitGlobAware(pattern, ',');
			if (patterns.length === 0) {
				report(toMarker(localize('promptValidator.applyToMustBeValidGlob', "The 'applyTo' attribute must be a valid glob pattern."), attribute.value.range, MarkerSeverity.Error));
				return;
			}
			for (const pattern of patterns) {
				const globPattern = parse(pattern);
				if (isEmptyPattern(globPattern)) {
					report(toMarker(localize('promptValidator.applyToMustBeValidGlob', "The 'applyTo' attribute must be a valid glob pattern."), attribute.value.range, MarkerSeverity.Error));
					return;
				}
			}
		} catch (_error) {
			report(toMarker(localize('promptValidator.applyToMustBeValidGlob', "The 'applyTo' attribute must be a valid glob pattern."), attribute.value.range, MarkerSeverity.Error));
		}
	}

	private validatePaths(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.paths);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'sequence') {
			report(toMarker(localize('promptValidator.pathsMustBeArray', "The 'paths' attribute must be an array of glob patterns."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		for (const item of attribute.value.items) {
			if (item.type !== 'scalar') {
				report(toMarker(localize('promptValidator.eachPathMustBeString', "Each entry in the 'paths' attribute must be a string."), item.range, MarkerSeverity.Error));
				continue;
			}
			const pattern = item.value.trim();
			if (pattern.length === 0) {
				report(toMarker(localize('promptValidator.pathMustBeNonEmpty', "Path entries must be non-empty glob patterns."), item.range, MarkerSeverity.Error));
				continue;
			}
			try {
				const globPattern = parse(pattern);
				if (isEmptyPattern(globPattern)) {
					report(toMarker(localize('promptValidator.pathMustBeValidGlob', "'{0}' is not a valid glob pattern.", pattern), item.range, MarkerSeverity.Error));
				}
			} catch (_error) {
				report(toMarker(localize('promptValidator.pathMustBeValidGlob', "'{0}' is not a valid glob pattern.", pattern), item.range, MarkerSeverity.Error));
			}
		}
	}

	private validateExcludeAgent(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.excludeAgent);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'sequence' && attribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.excludeAgentMustBeArray', "The 'excludeAgent' attribute must be an string or array."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
	}

	private validateHooks(attributes: IHeaderAttribute[], target: Target, report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.hooks);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'map') {
			report(toMarker(localize('promptValidator.hooksMustBeMap', "The 'hooks' attribute must be a map of hook event types to command arrays."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		const validHookNames = new Set(Object.keys(HOOKS_BY_TARGET[target] ?? HOOKS_BY_TARGET[Target.Undefined]));
		for (const prop of attribute.value.properties) {
			if (!validHookNames.has(prop.key.value)) {
				report(toMarker(localize('promptValidator.unknownHookType', "Unknown hook event type '{0}'. Supported: {1}.", prop.key.value, Array.from(validHookNames).join(', ')), prop.key.range, MarkerSeverity.Warning));
			}
			if (prop.value.type !== 'sequence') {
				report(toMarker(localize('promptValidator.hookValueMustBeArray', "Hook event '{0}' must have an array of command objects as its value.", prop.key.value), prop.value.range, MarkerSeverity.Error));
				continue;
			}
			for (const item of prop.value.items) {
				this.validateHookCommand(item, target, report);
			}
		}
	}

	private validateHookCommand(item: IValue, target: Target, report: (markers: IMarkerData) => void): void {
		if (item.type !== 'map') {
			report(toMarker(localize('promptValidator.hookCommandMustBeObject', "Each hook command must be an object."), item.range, MarkerSeverity.Error));
			return;
		}

		const hooksProperty = item.properties.find(p => p.key.value === 'hooks');
		if (hooksProperty) {
			for (const prop of item.properties) {
				if (prop.key.value !== 'hooks' && prop.key.value !== 'matcher') {
					report(toMarker(localize('promptValidator.unknownMatcherProperty', "Unknown property '{0}' in hook matcher.", prop.key.value), prop.key.range, MarkerSeverity.Warning));
				}
			}
			if (hooksProperty.value.type !== 'sequence') {
				report(toMarker(localize('promptValidator.nestedHooksMustBeArray', "The 'hooks' property in a matcher must be an array of command objects."), hooksProperty.value.range, MarkerSeverity.Error));
				return;
			}
			for (const nestedItem of hooksProperty.value.items) {
				this.validateHookCommand(nestedItem, target, report);
			}
			return;
		}

		const isCopilotCli = target === Target.GitHubCopilot;

		const validCommandFields = isCopilotCli
			? new Set(['bash', 'powershell'])
			: new Set(['command', 'windows', 'linux', 'osx', 'bash', 'powershell']);

		const validProperties = isCopilotCli
			? new Set(['type', 'bash', 'powershell', 'cwd', 'env', 'timeoutSec'])
			: new Set(['type', 'command', 'windows', 'linux', 'osx', 'bash', 'powershell', 'cwd', 'env', 'timeout']);

		let hasType = false;
		let hasCommandField = false;

		for (const prop of item.properties) {
			const key = prop.key.value;

			if (!validProperties.has(key)) {
				report(toMarker(localize('promptValidator.unknownHookProperty', "Unknown property '{0}' in hook command.", key), prop.key.range, MarkerSeverity.Warning));
			}

			if (key === 'type') {
				hasType = true;
				if (prop.value.type !== 'scalar' || prop.value.value !== 'command') {
					report(toMarker(localize('promptValidator.hookTypeMustBeCommand', "The 'type' property in a hook command must be 'command'."), prop.value.range, MarkerSeverity.Error));
				}
			} else if (validCommandFields.has(key)) {
				hasCommandField = true;
				if (prop.value.type !== 'scalar' || prop.value.value.trim().length === 0) {
					report(toMarker(localize('promptValidator.hookCommandFieldMustBeNonEmptyString', "The '{0}' property in a hook command must be a non-empty string.", key), prop.value.range, MarkerSeverity.Error));
				}
			} else if (key === 'cwd') {
				if (prop.value.type !== 'scalar') {
					report(toMarker(localize('promptValidator.hookCwdMustBeString', "The 'cwd' property in a hook command must be a string."), prop.value.range, MarkerSeverity.Error));
				}
			} else if (key === 'env') {
				if (prop.value.type !== 'map') {
					report(toMarker(localize('promptValidator.hookEnvMustBeMap', "The 'env' property in a hook command must be a map of string values."), prop.value.range, MarkerSeverity.Error));
				} else {
					for (const envProp of prop.value.properties) {
						if (envProp.value.type !== 'scalar') {
							report(toMarker(localize('promptValidator.hookEnvValueMustBeString', "Environment variable '{0}' must have a string value.", envProp.key.value), envProp.value.range, MarkerSeverity.Error));
						}
					}
				}
			} else if (key === 'timeout' || key === 'timeoutSec') {
				if (prop.value.type !== 'scalar' || isNaN(Number(prop.value.value))) {
					report(toMarker(localize('promptValidator.hookTimeoutMustBeNumber', "The '{0}' property in a hook command must be a number.", key), prop.value.range, MarkerSeverity.Error));
				}
			}
		}

		if (!hasType) {
			report(toMarker(localize('promptValidator.hookMissingType', "Hook command is missing required property 'type'."), item.range, MarkerSeverity.Error));
		}
		if (!hasCommandField) {
			if (isCopilotCli) {
				report(toMarker(localize('promptValidator.hookMissingCopilotCommand', "Hook command must specify at least one of 'bash' or 'powershell'."), item.range, MarkerSeverity.Error));
			} else {
				report(toMarker(localize('promptValidator.hookMissingCommand', "Hook command must specify at least one of 'command', 'windows', 'linux', or 'osx'."), item.range, MarkerSeverity.Error));
			}
		}
	}

	private validateHandoffs(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.handOffs);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'sequence') {
			report(toMarker(localize('promptValidator.handoffsMustBeArray', "The 'handoffs' attribute must be an array."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		const seenLabels = new Map<string, Range>();
		for (const item of attribute.value.items) {
			if (item.type !== 'map') {
				report(toMarker(localize('promptValidator.eachHandoffMustBeObject', "Each handoff in the 'handoffs' attribute must be an object with 'label', 'agent', 'prompt' and optional 'send'."), item.range, MarkerSeverity.Error));
				continue;
			}
			const required = new Set(['label', 'agent', 'prompt']);
			for (const prop of item.properties) {
				switch (prop.key.value) {
					case 'label':
						if (prop.value.type !== 'scalar' || prop.value.value.trim().length === 0) {
							report(toMarker(localize('promptValidator.handoffLabelMustBeNonEmptyString', "The 'label' property in a handoff must be a non-empty string."), prop.value.range, MarkerSeverity.Error));
						} else if (!/[a-zA-Z0-9]/.test(prop.value.value)) {
							report(toMarker(localize('promptValidator.handoffLabelMustContainAlphanumeric', "The 'label' property in a handoff must contain at least one alphanumeric character."), prop.value.range, MarkerSeverity.Error));
						}
						break;
					case 'agent':
						if (prop.value.type !== 'scalar' || prop.value.value.trim().length === 0) {
							report(toMarker(localize('promptValidator.handoffAgentMustBeNonEmptyString', "The 'agent' property in a handoff must be a non-empty string."), prop.value.range, MarkerSeverity.Error));
						} else {
							this.validateAgentValue(prop.value, report);
						}
						break;
					case 'prompt':
						if (prop.value.type !== 'scalar') {
							report(toMarker(localize('promptValidator.handoffPromptMustBeString', "The 'prompt' property in a handoff must be a string."), prop.value.range, MarkerSeverity.Error));
						}
						break;
					case 'send':
						if (!isTrueOrFalse(prop.value)) {
							report(toMarker(localize('promptValidator.handoffSendMustBeBoolean', "The 'send' property in a handoff must be a boolean."), prop.value.range, MarkerSeverity.Error));
						}
						break;
					case 'showContinueOn':
						if (!isTrueOrFalse(prop.value)) {
							report(toMarker(localize('promptValidator.handoffShowContinueOnMustBeBoolean', "The 'showContinueOn' property in a handoff must be a boolean."), prop.value.range, MarkerSeverity.Error));
						}
						break;
					case 'model':
						if (prop.value.type !== 'scalar') {
							report(toMarker(localize('promptValidator.handoffModelMustBeString', "The 'model' property in a handoff must be a string."), prop.value.range, MarkerSeverity.Error));
						}
						break;
					default:
						report(toMarker(localize('promptValidator.unknownHandoffProperty', "Unknown property '{0}' in handoff object. Supported properties are 'label', 'agent', 'prompt' and optional 'send', 'showContinueOn', 'model'.", prop.key.value), prop.value.range, MarkerSeverity.Warning));
				}
				required.delete(prop.key.value);
			}
			if (required.size > 0) {
				report(toMarker(localize('promptValidator.missingHandoffProperties', "Missing required properties {0} in handoff object.", Array.from(required).map(s => `'${s}'`).join(', ')), item.range, MarkerSeverity.Error));
			}

			const labelProp = item.properties.find(p => p.key.value === 'label');
			if (labelProp?.value.type === 'scalar') {
				const normalizedLabel = labelProp.value.value.toLowerCase();
				if (normalizedLabel && seenLabels.has(normalizedLabel)) {
					report(toMarker(localize('promptValidator.duplicateHandoffLabel', "Duplicate handoff label '{0}'. Each handoff must have a unique label.", labelProp.value.value), labelProp.value.range, MarkerSeverity.Error));
				} else if (normalizedLabel) {
					seenLabels.set(normalizedLabel, labelProp.value.range);
				}
			}
		}
	}

	private validateInfer(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.infer);
		if (!attribute) {
			return;
		}
		report(toMarker(localize('promptValidator.inferDeprecated', "The 'infer' attribute is deprecated in favour of 'user-invocable' and 'disable-model-invocation'."), attribute.value.range, MarkerSeverity.Error));
	}

	private validateTarget(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.target);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'scalar') {
			report(toMarker(localize('promptValidator.targetMustBeString', "The 'target' attribute must be a string."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		const targetValue = attribute.value.value.trim();
		if (targetValue.length === 0) {
			report(toMarker(localize('promptValidator.targetMustBeNonEmpty', "The 'target' attribute must be a non-empty string."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		const validTargets = ['github-copilot', 'vscode'];
		if (!validTargets.includes(targetValue)) {
			report(toMarker(localize('promptValidator.targetInvalidValue', "The 'target' attribute must be one of: {0}.", validTargets.join(', ')), attribute.value.range, MarkerSeverity.Error));
		}
	}

	private validateUserInvocable(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.userInvocable);
		if (!attribute) {
			return;
		}
		if (!isTrueOrFalse(attribute.value)) {
			report(toMarker(localize('promptValidator.userInvocableMustBeBoolean', "The 'user-invocable' attribute must be 'true' or 'false'."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
	}

	private validateDisableModelInvocation(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): undefined {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.disableModelInvocation);
		if (!attribute) {
			return;
		}
		if (!isTrueOrFalse(attribute.value)) {
			report(toMarker(localize('promptValidator.disableModelInvocationMustBeBoolean', "The 'disable-model-invocation' attribute must be 'true' or 'false'."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
	}

	private async validateAgentsAttribute(attributes: IHeaderAttribute[], header: PromptHeader, report: (markers: IMarkerData) => void): Promise<undefined> {
		const attribute = attributes.find(attr => attr.key === PromptHeaderAttributes.agents);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'sequence') {
			report(toMarker(localize('promptValidator.agentsMustBeArray', "The 'agents' attribute must be an array."), attribute.value.range, MarkerSeverity.Error));
			return;
		}

		const agents = (await this.promptsService.getCustomAgents(CancellationToken.None)).filter(a => a.enabled);
		const availableAgentNames = new Set<string>(agents.map(agent => agent.name));
		availableAgentNames.add(ChatMode.Agent.name.get());

		const agentNames: string[] = [];
		for (const item of attribute.value.items) {
			if (item.type !== 'scalar') {
				report(toMarker(localize('promptValidator.eachAgentMustBeString', "Each agent name in the 'agents' attribute must be a string."), item.range, MarkerSeverity.Error));
			} else if (item.value) {
				agentNames.push(item.value);
				if (item.value !== '*' && !availableAgentNames.has(item.value)) {
					report(toMarker(localize('promptValidator.agentInAgentsNotFound', "Unknown agent '{0}' will be ignored. Available agents: {1}.", item.value, Array.from(availableAgentNames).join(', ')), item.range, MarkerSeverity.Hint, [MarkerTag.Unnecessary]));
				}
			}
		}

		if (agentNames.length > 0) {
			const tools = header.tools;
			if (tools && !tools.includes(SpecedToolAliases.agent)) {
				report(toMarker(localize('promptValidator.agentsRequiresAgentTool', "When 'agents' and 'tools' are specified, the 'agent' tool must be included in the 'tools' attribute."), attribute.value.range, MarkerSeverity.Warning));
			}
		}
	}

	private validateGithubPermissions(attributes: IHeaderAttribute[], report: (markers: IMarkerData) => void): void {
		const attribute = attributes.find(attr => attr.key === GithubPromptHeaderAttributes.github);
		if (!attribute) {
			return;
		}
		if (attribute.value.type !== 'map') {
			report(toMarker(localize('promptValidator.githubMustBeMap', "The 'github' attribute must be an object."), attribute.value.range, MarkerSeverity.Error));
			return;
		}
		for (const prop of attribute.value.properties) {
			if (prop.key.value !== 'permissions') {
				report(toMarker(localize('promptValidator.unknownGithubProperty', "Unknown property '{0}' in 'github' object. Supported: 'permissions'.", prop.key.value), prop.key.range, MarkerSeverity.Warning));
				continue;
			}
			if (prop.value.type !== 'map') {
				report(toMarker(localize('promptValidator.permissionsMustBeMap', "The 'permissions' property must be an object."), prop.value.range, MarkerSeverity.Error));
				continue;
			}
			for (const permProp of prop.value.properties) {
				const scope = permProp.key.value;
				const scopeInfo = githubPermissionScopes[scope];
				if (!scopeInfo) {
					const validScopes = Object.keys(githubPermissionScopes).sort().join(', ');
					report(toMarker(localize('promptValidator.unknownPermissionScope', "Unknown permission scope '{0}'. Valid scopes: {1}.", scope, validScopes), permProp.key.range, MarkerSeverity.Warning));
					continue;
				}
				if (permProp.value.type !== 'scalar') {
					report(toMarker(localize('promptValidator.permissionValueMustBeString', "The permission value for '{0}' must be a string.", scope), permProp.value.range, MarkerSeverity.Error));
					continue;
				}
				const value = permProp.value.value;
				if (!scopeInfo.allowedValues.includes(value)) {
					report(toMarker(localize('promptValidator.invalidPermissionValue', "Invalid permission value '{0}' for scope '{1}'. Allowed values: {2}.", value, scope, scopeInfo.allowedValues.join(', ')), permProp.value.range, MarkerSeverity.Error));
				}
			}
		}
	}
}

export const githubPermissionScopes: Record<string, { allowedValues: string[]; description: string }> = {
	'actions': { allowedValues: ['read', 'write', 'none'], description: localize('githubPermission.actions', "Access to GitHub Actions workflows and runs") },
	'checks': { allowedValues: ['read', 'none'], description: localize('githubPermission.checks', "Access to check runs and statuses") },
	'contents': { allowedValues: ['read', 'write', 'none'], description: localize('githubPermission.contents', "Access to repository contents (files, commits, branches)") },
	'discussions': { allowedValues: ['read', 'write', 'none'], description: localize('githubPermission.discussions', "Access to discussions") },
	'issues': { allowedValues: ['read', 'write', 'none'], description: localize('githubPermission.issues', "Access to issues (read, create, update, comment)") },
	'metadata': { allowedValues: ['read'], description: localize('githubPermission.metadata', "Repository metadata (always read-only)") },
	'pull-requests': { allowedValues: ['read', 'write', 'none'], description: localize('githubPermission.pullRequests', "Access to pull requests (read, create, update, review)") },
	'security-events': { allowedValues: ['read', 'none'], description: localize('githubPermission.securityEvents', "Access to security-related events") },
	'workflows': { allowedValues: ['write', 'none'], description: localize('githubPermission.workflows', "Access to modify workflow files") },
};

function isTrueOrFalse(value: IValue): boolean {
	if (value.type === 'scalar') {
		return (value.value === 'true' || value.value === 'false') && value.format === 'none';
	}
	return false;
}


export {
	getTarget,
	isVSCodeOrDefaultTarget,
	getValidAttributeNames,
	isNonRecommendedAttribute,
	claudeAgentAttributes,
	claudeRulesAttributes,
	mapClaudeModels,
	mapClaudeTools,
};


function toMarker(message: string, range: Range, severity = MarkerSeverity.Error, tags?: MarkerTag[], code?: string): IMarkerData {
	return { severity, message, ...(tags ? { tags } : {}), ...(code ? { code } : {}), ...range };
}
