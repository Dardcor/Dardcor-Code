/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptFileContribution } from '../../agents/dardcor-node/promptFileContrib';
import { BYOKContrib } from '../../byok/dardcor-node/byokContribution';
import { ChatDebugFileLoggerContribution } from '../../chat/dardcor-node/chatDebugFileLoggerService';
import { ChatSessionContextContribution } from '../../chatSessionContext/dardcor-node/chatSessionContextProvider';
import { ChatSessionsContrib } from '../../chatSessions/dardcor-node/chatSessions';
import { SessionStoreTracker } from '../../chronicle/dardcor-node/sessionStoreTracker';
import * as chatBlockLanguageContribution from '../../codeBlocks/dardcor-node/chatBlockLanguageFeatures.contribution';
import { IExtensionContributionFactory, asContributionFactory } from '../../common/contributions';
import { CompletionsUnificationContribution } from '../../completions/dardcor-node/completionsUnificationContribution';
import { ConfigurationMigrationContribution } from '../../configuration/dardcor-node/configurationMigration';
import { ContextKeysContribution } from '../../contextKeys/dardcor-node/contextKeys.contribution';

import { AiMappedEditsContrib } from '../../conversation/dardcor-node/aiMappedEditsContrib';
import { ConversationFeature } from '../../conversation/dardcor-node/conversationFeature';
import { FeedbackCommandContribution } from '../../conversation/dardcor-node/feedbackContribution';
import { LanguageModelAccess } from '../../conversation/dardcor-node/languageModelAccess';
import { LogWorkspaceStateContribution } from '../../conversation/dardcor-node/logWorkspaceState';
import { DiagnosticsContextContribution } from '../../diagnosticsContext/dardcor/diagnosticsContextProvider';
import { LanguageModelProxyContrib } from '../../externalAgents/dardcor-node/lmProxyContrib';
import { WalkthroughCommandContribution } from '../../getting-started/dardcor-node/commands';
import * as newWorkspaceContribution from '../../getting-started/dardcor-node/newWorkspace.contribution';
import { ScmContextProviderContribution } from '../../git/dardcor/scmContextprovider';
import { GitHubMcpContrib } from '../../githubMcp/dardcor-node/githubMcp.contribution';
import { IgnoredFileProviderContribution } from '../../ignore/dardcor-node/ignoreProvider';
import { JointCompletionsProviderContribution } from '../../inlineEdits/dardcor-node/jointInlineCompletionProvider';
import { FixTestFailureContribution } from '../../intents/dardcor-node/fixTestFailureContributions';
import { ExtensionStateCommandContribution } from '../../log/dardcor-node/extensionStateCommand';
import { FetcherTelemetryContribution, LoggingActionsContrib } from '../../log/dardcor-node/loggingActions';
import { RequestLogTree } from '../../log/dardcor-node/requestLogTree';
import { McpSetupCommands } from '../../mcp/dardcor-node/commands';
import { NotebookFollowCommands } from '../../notebook/dardcor-node/followActions';
import { DardcorDebugCommandContribution } from '../../onboardDebug/dardcor-node/dardcorDebugCommandContribution';
import { OnboardTerminalTestsContribution } from '../../onboardDebug/dardcor-node/onboardTerminalTestsContribution';
import { OTelContrib } from '../../otel/dardcor-node/otelContrib';
import { PowerStateLogger } from '../../power/dardcor-node/powerStateLogger';
import { DebugCommandsContribution } from '../../prompt/dardcor-node/debugCommands';
import { RenameSuggestionsContrib } from '../../prompt/dardcor-node/renameSuggestions';
import { PromptFileContextContribution } from '../../promptFileContext/dardcor-node/promptFileContextService';
import { SearchPanelCommands } from '../../search/dardcor-node/commands';
import { SettingsSchemaFeature } from '../../settingsSchema/dardcor-node/settingsSchemaFeature';
import { SurveyCommandContribution } from '../../survey/dardcor-node/surveyCommands';
import { SetupTestsContribution } from '../../testing/dardcor/setupTestContributions';
import { ToolsContribution } from '../../tools/dardcor-node/tools';
import { OTelChatDebugLogProviderContribution } from '../../trajectory/dardcor-node/otelChatDebugLogProvider';
import { InlineCompletionContribution } from '../../typescriptContext/dardcor-node/languageContextService';
import { NesRenameContribution } from '../../typescriptContext/dardcor-node/nesRenameService';
import * as workspaceIndexingContribution from '../../workspaceChunkSearch/dardcor-node/workspaceChunkSearch.contribution';
import { WorkspaceRecorderFeature } from '../../workspaceRecorder/dardcor-node/workspaceRecorderFeature';
import vscodeContributions from '../dardcor/contributions';


export const vscodeNodeContributions: IExtensionContributionFactory[] = [
	...vscodeContributions,
	asContributionFactory(ExtensionStateCommandContribution),
	asContributionFactory(ConversationFeature),
	chatBlockLanguageContribution,
	asContributionFactory(LoggingActionsContrib),
	asContributionFactory(FetcherTelemetryContribution),
	asContributionFactory(PowerStateLogger),
	asContributionFactory(ContextKeysContribution),
	asContributionFactory(DardcorDebugCommandContribution),
	asContributionFactory(DebugCommandsContribution),
	asContributionFactory(LanguageModelAccess),
	asContributionFactory(WalkthroughCommandContribution),
	asContributionFactory(JointCompletionsProviderContribution),
	asContributionFactory(SettingsSchemaFeature),
	asContributionFactory(WorkspaceRecorderFeature),
	asContributionFactory(SurveyCommandContribution),
	asContributionFactory(FeedbackCommandContribution),
	asContributionFactory(InlineCompletionContribution),
	asContributionFactory(NesRenameContribution),
	asContributionFactory(SearchPanelCommands),
	asContributionFactory(NotebookFollowCommands),
	asContributionFactory(PromptFileContextContribution),
	asContributionFactory(ScmContextProviderContribution),
	asContributionFactory(DiagnosticsContextContribution),
	asContributionFactory(ChatSessionContextContribution),
	asContributionFactory(CompletionsUnificationContribution),
	workspaceIndexingContribution,
	asContributionFactory(ChatSessionsContrib),
	asContributionFactory(GitHubMcpContrib),
	asContributionFactory(OTelContrib),
	asContributionFactory(SessionStoreTracker),
	asContributionFactory(BYOKContrib),
];

export const vscodeNodeChatContributions: IExtensionContributionFactory[] = [
	asContributionFactory(ConfigurationMigrationContribution),
	asContributionFactory(RequestLogTree),
	asContributionFactory(OnboardTerminalTestsContribution),
	asContributionFactory(ToolsContribution),
	asContributionFactory(AiMappedEditsContrib),
	asContributionFactory(RenameSuggestionsContrib),
	asContributionFactory(LogWorkspaceStateContribution),
	asContributionFactory(SetupTestsContribution),
	asContributionFactory(FixTestFailureContribution),
	asContributionFactory(IgnoredFileProviderContribution),
	asContributionFactory(McpSetupCommands),
	asContributionFactory(LanguageModelProxyContrib),
	asContributionFactory(PromptFileContribution),
	newWorkspaceContribution,
	asContributionFactory(OTelChatDebugLogProviderContribution),
	asContributionFactory(ChatDebugFileLoggerContribution),
];
