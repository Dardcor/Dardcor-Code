/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { renderFormattedText } from '../../../../../base/browser/formattedTextRenderer.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { IActionViewItemOptions } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { alert, status } from '../../../../../base/browser/ui/aria/aria.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IManagedHover } from '../../../../../base/browser/ui/hover/hover.js';
import { CachedListVirtualDelegate, IListElementRenderDetails } from '../../../../../base/browser/ui/list/list.js';
import { IStickyScrollNodeSourceRange } from '../../../../../base/browser/ui/tree/abstractTree.js';
import { ITreeNode, ITreeRenderer } from '../../../../../base/browser/ui/tree/tree.js';
import { IAction } from '../../../../../base/common/actions.js';
import { coalesce, distinct } from '../../../../../base/common/arrays.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { canceledName } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { MarkdownString, escapeMarkdownSyntaxTokens } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, MutableDisposable, dispose, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { rewriteMarkdownLinks } from '../../../../../base/common/markdownLinks.js';
import { ScrollEvent } from '../../../../../base/common/scrollable.js';
import { FileAccess, Schemas } from '../../../../../base/common/network.js';
import { clamp, formatTokenCount } from '../../../../../base/common/numbers.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { MenuEntryActionViewItem, createActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { MenuWorkbenchToolBar } from '../../../../../platform/actions/browser/toolbar.js';
import { MenuId, MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IMarkdownRenderer } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { parseRemoteAgentHostSessionTypeAuthority } from '../../../../../platform/agentHost/common/agentHostSessionType.js';
import { parseAgentMergePrompt } from '../../../../../platform/agentHost/common/agentMergePrompt.js';
import { isCreateChatTool, isCreateSessionTool, isSendMessageTool } from '../../../../../platform/agentHost/common/openSessionLink.js';
import { IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { CodiconActionViewItem } from '../../../notebook/browser/view/cellParts/cellActionView.js';
import { annotateSpecialMarkdownContent, extractSubAgentInvocationIdFromText, hasCodeblockUriTag, hasEditCodeblockUriTag } from '../../common/widget/annotations.js';
import { checkModeOption } from '../../common/chat.js';
import { IChatAgentMetadata } from '../../common/participants/chatAgents.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IChatProgressResponseContent, IChatTextEditGroup } from '../../common/model/chatModel.js';
import { chatSubcommandLeader } from '../../common/requestParser/chatParserTypes.js';
import { ChatAgentVoteDirection, ChatErrorLevel, ChatRequestQueueKind, IChatConfirmation, IChatContentReference, IChatDisabledClaudeHooksPart, IChatElicitationRequest, IChatElicitationRequestSerialized, IChatExtensionsContent, IChatExternalEdit, IChatFollowup, IChatHookPart, IChatMarkdownContent, IChatMcpServersStarting, IChatMcpServersStartingSerialized, IChatMultiDiffData, IChatMultiDiffDataSerialized, IChatPlanReview, IChatPlanReviewResult, IChatPullRequestContent, IChatQuestionAnswerValue, IChatQuestionAnswers, IChatQuestionCarousel, IChatService, IChatTask, IChatTaskSerialized, IChatThinkingPart, IChatToolInvocation, IChatToolInvocationSerialized, IChatTreeData, IChatUndoStop, IChatUsageModelTotal, isChatFollowup } from '../../common/chatService/chatService.js';
import { ChatPlanReviewData } from '../../common/model/chatProgressTypes/chatPlanReviewData.js';
import { ChatQuestionCarouselData } from '../../common/model/chatProgressTypes/chatQuestionCarouselData.js';
import { localChatSessionType, SessionType } from '../../common/chatSessionsService.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { getExplicitFileOrImageAttachmentSummary, IChatRequestVariableEntry, isExplicitFileOrImageVariableEntry, isPasteVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import { getStickyScrollTargetItem, IChatChangesSummaryPart, IChatCodeCitations, IChatErrorDetailsPart, IChatReferences, IChatRendererContent, IChatRequestViewModel, IChatResponseViewModel, IChatViewModel, IChatWorkingProgress, isRequestVM, isResponseVM, IChatPendingDividerViewModel, isPendingDividerVM, IChatTurnPillsPart } from '../../common/model/chatViewModel.js';
import { getNWords } from '../../common/model/chatWordCounter.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, CollapsedToolsDisplayMode, ThinkingDisplayMode } from '../../common/constants.js';
import { formatChatRequestTimestamp, formatChatResponseDetails, formatChatResponseElapsedTime } from '../../common/chatProgressFormatting.js';
import { ClickAnimation } from '../../../../../base/browser/ui/animations/animations.js';
import { ForkConversationActionId } from '../actions/chatForkActions.js';
import { MarkHelpfulActionId } from '../actions/chatTitleActions.js';
import { focusChatModelFeedbackSurveyAction } from '../actions/chatModelFeedbackSurveyActions.js';
import { ChatTreeItem, IChatCodeBlockInfo, IChatFileTreeInfo, IChatListItemRendererOptions, IChatWidgetService } from '../chat.js';
import { getCompactCodicon } from '../chatIcons.js';
import { ChatModelFeedbackSurveyWidget } from '../feedbackSurvey/chatModelFeedbackSurveyWidget.js';
import { RestoreCheckpointActionId, StartOverActionId } from '../chatEditing/chatEditingActions.js';
import { ChatForkActionViewItem } from './chatForkActionViewItem.js';
import { ChatRestoreCheckpointActionViewItem } from './chatRestoreCheckpointActionViewItem.js';
import { ChatAgentHover, getChatAgentHoverOptions } from './chatAgentHover.js';
import { ChatContentMarkdownRenderer } from './chatContentMarkdownRenderer.js';
import { ChatAgentCommandContentPart } from './chatContentParts/chatAgentCommandContentPart.js';
import { ChatAgentMergeContentPart } from './chatContentParts/chatAgentMergeContentPart.js';
import { ChatAnonymousRateLimitedPart } from './chatContentParts/chatAnonymousRateLimitedPart.js';
import { ChatAttachmentsContentPart } from './chatContentParts/chatAttachmentsContentPart.js';
import { ChatAutoModeResolutionContentPart } from './chatContentParts/chatAutoModeResolutionContentPart.js';
import { ChatCheckpointFileChangesSummaryContentPart } from './chatContentParts/chatChangesSummaryPart.js';
import { ChatTurnPillsContentPart } from './chatContentParts/chatTurnPillsPart.js';
import { ChatCodeCitationContentPart } from './chatContentParts/chatCodeCitationContentPart.js';
import { ChatCollapsibleContentPart } from './chatContentParts/chatCollapsibleContentPart.js';
import { ChatCommandButtonContentPart } from './chatContentParts/chatCommandContentPart.js';
import { ChatConfirmationContentPart } from './chatContentParts/chatConfirmationContentPart.js';
import { DiffEditorPool, EditorPool } from './chatContentParts/chatContentCodePools.js';
import { IChatContentPart, IChatContentPartRenderContext, InlineTextModelCollection } from './chatContentParts/chatContentParts.js';
import { ChatElicitationContentPart } from './chatContentParts/chatElicitationContentPart.js';
import { ChatErrorConfirmationContentPart } from './chatContentParts/chatErrorConfirmationPart.js';
import { ChatErrorContentPart } from './chatContentParts/chatErrorContentPart.js';
import { ChatPlanReviewPart } from './chatContentParts/chatPlanReviewPart.js';
import { ChatQuestionCarouselPart } from './chatContentParts/chatQuestionCarouselPart.js';
import { ChatExtensionsContentPart } from './chatContentParts/chatExtensionsContentPart.js';
import { ChatMarkdownContentPart, codeblockHasClosingBackticks } from './chatContentParts/chatMarkdownContentPart.js';
import { ChatMcpServersInteractionContentPart } from './chatContentParts/chatMcpServersInteractionContentPart.js';
import { ChatMcpAuthenticationContentPart } from './chatContentParts/chatMcpAuthenticationContentPart.js';
import { ChatMcpServersStartingContentPart } from './chatContentParts/chatMcpServersStartingContentPart.js';
import { ChatDisabledClaudeHooksContentPart } from './chatContentParts/chatDisabledClaudeHooksContentPart.js';
import { ChatMultiDiffContentPart } from './chatContentParts/chatMultiDiffContentPart.js';
import { ChatProgressContentPart, ChatWorkingProgressContentPart } from './chatContentParts/chatProgressContentPart.js';
import { ChatPullRequestContentPart } from './chatContentParts/chatPullRequestContentPart.js';
import { ChatQuotaExceededPart } from './chatContentParts/chatQuotaExceededPart.js';
import { ChatCollapsibleListContentPart, ChatUsedReferencesListContentPart, CollapsibleListPool } from './chatContentParts/chatReferencesContentPart.js';
import { ChatRequestOriginPart } from './chatContentParts/chatRequestOriginPart.js';
import { ChatTaskContentPart } from './chatContentParts/chatTaskContentPart.js';
import { ChatSystemNotificationContentPart } from './chatContentParts/chatSystemNotificationContentPart.js';
import { ChatTextEditContentPart } from './chatContentParts/chatTextEditContentPart.js';
import { ChatThinkingContentPart, getEffectiveThinkingDisplayMode } from './chatContentParts/chatThinkingContentPart.js';
import { ChatSubagentContentPart } from './chatContentParts/chatSubagentContentPart.js';
import { ChatTreeContentPart, TreePool } from './chatContentParts/chatTreeContentPart.js';
import { ChatWorkspaceEditContentPart } from './chatContentParts/chatWorkspaceEditContentPart.js';
import { ChatExternalEditContentPart } from './chatContentParts/chatExternalEditContentPart.js';
import { ChatToolInvocationPart } from './chatContentParts/toolInvocationParts/chatToolInvocationPart.js';
import { ChatMarkdownDecorationsRenderer } from './chatContentParts/chatMarkdownDecorationsRenderer.js';
import { ChatEditorOptions } from './chatOptions.js';
import { ChatCodeBlockContentProvider, CodeBlockPart } from './chatContentParts/codeBlockPart.js';
import { autorun, observableValue } from '../../../../../base/common/observable.js';
import { basename, isEqual } from '../../../../../base/common/resources.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ChatHookContentPart } from './chatContentParts/chatHookContentPart.js';
import { ChatPendingDragController } from './chatPendingDragAndDrop.js';
import { HookType } from '../../common/promptSyntax/hookTypes.js';
import { AccessibilityWorkbenchSettingId } from '../../../accessibility/browser/accessibilityConfiguration.js';
import { isAskQuestionsToolInvocation, isMcpToolInvocation } from './chatContentParts/toolInvocationParts/chatToolPartUtilities.js';

const $ = dom.$;

const DARDCOR_USERNAME = 'Dardcor';
const WORKING_CAUGHT_UP_DEBOUNCE_MS = 750;
const DEFAULT_CHAT_ITEM_HORIZONTAL_PADDING = 40;

export interface IChatListItemTemplate {
	currentElement?: ChatTreeItem;
	renderedParts?: IChatContentPart[];
	movedOutToolParts?: DisposableMap<string, IDisposable>;
	renderedPartsMounted?: boolean;
	renderedContent?: ReadonlyArray<IChatRendererContent>;
	completedResponseDisclosure?: HTMLDetailsElement;
	completedResponseCollapseStartIndex?: number;
	completedResponseCollapseEndIndex?: number;
	completedResponseDisclosureOpen?: boolean;
	wasResponseComplete?: boolean;
	readonly completedResponseDisclosureDisposables: DisposableStore;
	readonly responseTokenStatsHover: MutableDisposable<IManagedHover>;

	dragHandle?: HTMLElement;

	readonly rowContainer: HTMLElement;
	allocatedHeight?: number;
	readonly titleToolbar?: MenuWorkbenchToolBar;
	readonly header?: HTMLElement;
	readonly footerToolbar: MenuWorkbenchToolBar;
	readonly footerToolbarContainer: HTMLElement;
	readonly footerDetailsContainer: HTMLElement;
	readonly avatarContainer: HTMLElement;
	readonly username: HTMLElement;
	readonly detail: HTMLElement;
	readonly value: HTMLElement;
	stickyScrollSource?: HTMLElement;
	readonly requestTimestampContainer: HTMLElement;
	readonly requestActionsContainer: HTMLElement;
	readonly contextKeyService: IContextKeyService;
	readonly instantiationService: IInstantiationService;
	readonly templateDisposables: IDisposable;
	readonly elementDisposables: DisposableStore;
	readonly agentHover: ChatAgentHover;
	readonly requestHover: HTMLElement;
	readonly disabledOverlay: HTMLElement;
	readonly checkpointToolbar: MenuWorkbenchToolBar;
	readonly checkpointRestoreToolbar: MenuWorkbenchToolBar;
	readonly checkpointContainer: HTMLElement;
	readonly checkpointRestoreContainer: HTMLElement;
	readonly feedbackSurveyWidget: ChatModelFeedbackSurveyWidget;
}

function escapeMarkdownLinkLabel(label: string): string {
	return label.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

export function buildPlanReviewProgressContent(review: IChatPlanReview, message: string): MarkdownString {
	const renderedAsUsed = !!review.isUsed;
	const data = renderedAsUsed && !review.data?.rejected ? review.data : undefined;
	const overall = data?.feedbackOverall?.trim();
	const inlineMd = data?.feedbackInlineMarkdown?.trim();
	const feedbackMarkdown = [overall, inlineMd].filter(value => !!value).join('\n\n')
		|| data?.feedback?.trim();

	const content = new MarkdownString(undefined, { supportThemeIcons: true, isTrusted: true });
	content.appendText(message);
	if (feedbackMarkdown) {
		content.appendMarkdown('\n\n');
		content.appendMarkdown(feedbackMarkdown);
	}

	if (renderedAsUsed) {
		const planUri = review.planUri ? URI.revive(review.planUri) : undefined;
		if (planUri) {
			const planFileName = basename(planUri);
			const label = planFileName
				? localize('chat.planReview.openFullPlanFile', "Open plan ({0})", planFileName)
				: localize('chat.planReview.openFullPlan', "Open plan");
			const commandUri = URI.from({
				scheme: 'command',
				path: 'markdown.showPreview',
				query: JSON.stringify([planUri])
			});
			content.appendMarkdown(` &mdash; [${escapeMarkdownLinkLabel(label)}](${commandUri.toString()})`);
		} else {
			const reviewContent = review.content.trim();
			if (reviewContent) {
				content.appendMarkdown('\n\n');
				content.appendMarkdown(reviewContent);
			}
		}
	}
	return content;
}

interface IItemHeightChangeParams {
	element: ChatTreeItem;
	height: number;
}

export function shouldScheduleInitialHeightChange(normalizedHeight: number, allocatedHeight: number | undefined): boolean {
	return typeof allocatedHeight !== 'number' || normalizedHeight > allocatedHeight;
}

export function getFinalResponseStartIndex(content: ReadonlyArray<IChatRendererContent>): number | undefined {
	let index = content.length - 1;
	while (index >= 0) {
		const part = content[index];
		if (part.kind === 'markdownContent' && part.content.value.length) {
			break;
		}
		index--;
	}

	if (index < 0) {
		return undefined;
	}

	while (index > 0 && content[index - 1].kind === 'markdownContent') {
		index--;
	}
	return index;
}

function isResponseOutcomeTool(part: IChatRendererContent): boolean {
	return (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized')
		&& (part.toolSpecificData?.kind === 'sessionCreated' || part.toolSpecificData?.kind === 'generatedImage');
}

function getSessionCreatedOutcomeLink(part: IChatRendererContent): string | undefined {
	return (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && part.toolSpecificData?.kind === 'sessionCreated'
		? part.toolSpecificData.openLink
		: undefined;
}

function getFinalResponseLinkTargets(content: ReadonlyArray<IChatRendererContent>): ReadonlySet<string> {
	const targets = new Set<string>();
	const finalResponseStartIndex = getFinalResponseStartIndex(content);
	if (finalResponseStartIndex === undefined) {
		return targets;
	}

	for (let index = finalResponseStartIndex; index < content.length; index++) {
		const part = content[index];
		if (part.kind !== 'markdownContent') {
			break;
		}
		rewriteMarkdownLinks(part.content.value, {
			rewriteLink: token => {
				if (token.type === 'link') {
					targets.add(token.href);
				}
				return undefined;
			}
		});
	}
	return targets;
}

export function getFinalResponseStartIndexAfterMovingResponseOutcomeTools(content: ReadonlyArray<IChatRendererContent>): number | undefined {
	const finalResponseStartIndex = getFinalResponseStartIndex(content);
	if (finalResponseStartIndex === undefined) {
		return undefined;
	}

	let movedToolCount = 0;
	for (let index = 0; index < finalResponseStartIndex; index++) {
		if (isResponseOutcomeTool(content[index])) {
			movedToolCount++;
		}
	}
	return finalResponseStartIndex - movedToolCount;
}

export function isFinalResponseRendered(content: ReadonlyArray<IChatRendererContent>, finalResponseStartIndex: number | undefined): boolean {
	return finalResponseStartIndex !== undefined && content[finalResponseStartIndex]?.kind === 'markdownContent';
}

export function moveResponseOutcomeToolsAfterFinalResponse(content: ReadonlyArray<IChatRendererContent>): IChatRendererContent[] {
	const outcomeTools = content.filter(isResponseOutcomeTool);
	if (outcomeTools.length === 0) {
		return [...content];
	}
	const responseLinkTargets = outcomeTools.some(part => getSessionCreatedOutcomeLink(part) !== undefined)
		? getFinalResponseLinkTargets(content)
		: undefined;
	const seenSessionLinks = new Set<string>();
	const uniqueOutcomeTools = outcomeTools.filter(part => {
		const openLink = getSessionCreatedOutcomeLink(part);
		if (openLink === undefined) {
			return true;
		}
		if (responseLinkTargets?.has(openLink) || seenSessionLinks.has(openLink)) {
			return false;
		}
		seenSessionLinks.add(openLink);
		return true;
	});

	const finalResponseStartIndex = getFinalResponseStartIndexAfterMovingResponseOutcomeTools(content);
	if (finalResponseStartIndex === undefined) {
		return [...content];
	}

	const reordered = content.filter(part => !isResponseOutcomeTool(part));
	let insertionIndex = finalResponseStartIndex;
	while (reordered[insertionIndex]?.kind === 'markdownContent') {
		insertionIndex++;
	}
	reordered.splice(insertionIndex, 0, ...uniqueOutcomeTools);
	return reordered;
}

export function formatCompletedResponseDisclosureLabel(stepCount: number, elapsedMs: number | undefined): string {
	const elapsed = formatChatResponseElapsedTime(elapsedMs);
	if (stepCount === 1) {
		return elapsed
			? localize('chat.responseCompletedOneStepIn', "Completed 1 step in {0}", elapsed)
			: localize('chat.responseCompletedOneStep', "Completed 1 step");
	}
	return elapsed
		? localize('chat.responseCompletedStepsIn', "Completed {0} steps in {1}", stepCount, elapsed)
		: localize('chat.responseCompletedSteps', "Completed {0} steps", stepCount);
}

export function getVisibleCompletedResponseItemCount(nodes: ReadonlyArray<Node>): number {
	let visibleItemCount = 0;
	for (const node of nodes) {
		if (dom.isHTMLElement(node) && (node.hidden || node.style.display === 'none')) {
			continue;
		}
		visibleItemCount++;
	}
	return visibleItemCount;
}

export function formatResponseTokenStats(modelTotals: readonly IChatUsageModelTotal[] | undefined, completedAt?: number): { readonly markdown: MarkdownString; readonly markdownNotSupportedFallback: string; readonly footerAriaLabel: string } | undefined {
	if (!modelTotals?.length) {
		return undefined;
	}

	const title = localize('chat.responseTokenStats.title', "Response details");
	const markdown = new MarkdownString();
	markdown.appendMarkdown(`**${escapeMarkdownSyntaxTokens(title)}**\n\n`);

	const formatInputTokens = (count: number | string) => localize('chat.responseTokenStats.input', "Input tokens: {0}", count);
	const formatOutputTokens = (count: number | string) => localize('chat.responseTokenStats.output', "Output tokens: {0}", count);
	const formatCachedInputTokens = (count: number | string) => localize('chat.responseTokenStats.cachedInput', "Cached input tokens: {0}", count);
	const tokenDetailsAriaParts: string[] = [];
	const completion = formatChatRequestTimestamp(completedAt);
	let completed: string | undefined;
	if (completion) {
		completed = localize('chat.responseTokenStats.completed', "Completed: {0}", completion.fullText);
		markdown.appendMarkdown(`${escapeMarkdownSyntaxTokens(completed)}\n\n`);
	}

	for (const total of modelTotals) {
		const model = localize('chat.responseTokenStats.model', "Model: {0}", total.model);
		const input = formatInputTokens(formatTokenCount(total.inputTokens));
		markdown.appendMarkdown(`${escapeMarkdownSyntaxTokens(model)}\n\n`);
		markdown.appendMarkdown(`- ${escapeMarkdownSyntaxTokens(input)}\n`);

		const exactInput = formatInputTokens(total.inputTokens);
		tokenDetailsAriaParts.push(model, exactInput);
		if (total.cachedTokens > 0) {
			const cachedInput = formatCachedInputTokens(formatTokenCount(total.cachedTokens));
			const exactCachedInput = formatCachedInputTokens(total.cachedTokens);
			markdown.appendMarkdown(`- ${escapeMarkdownSyntaxTokens(cachedInput)}\n`);
			tokenDetailsAriaParts.push(exactCachedInput);
		}
		const output = formatOutputTokens(formatTokenCount(total.outputTokens));
		const exactOutput = formatOutputTokens(total.outputTokens);
		markdown.appendMarkdown(`- ${escapeMarkdownSyntaxTokens(output)}\n`);
		tokenDetailsAriaParts.push(exactOutput);
		markdown.appendMarkdown('\n');
	}

	const footerAriaLabel = [title, ...tokenDetailsAriaParts].join('. ');
	const markdownNotSupportedFallback = [title, completed, ...tokenDetailsAriaParts].filter(value => value !== undefined).join('. ');
	return { markdown, markdownNotSupportedFallback, footerAriaLabel };
}

export function shouldCollapseCompletedResponsePart(part: IChatRendererContent): boolean {
	return (part.kind !== 'toolInvocation' && part.kind !== 'toolInvocationSerialized') || !toolInvocationHasMcpAppData(part);
}

export function getCompletedResponseCollapseEndIndex(content: ReadonlyArray<IChatRendererContent>, finalResponseStartIndex: number): number {
	for (let index = 0; index < finalResponseStartIndex; index++) {
		if (!shouldCollapseCompletedResponsePart(content[index])) {
			return index;
		}
	}
	return finalResponseStartIndex;
}

export type ChatItemHeightUpdateKind = 'none' | 'fire' | 'scheduleInitial' | 'deferReMeasure';

export interface IChatItemHeightUpdate {
	readonly nextRenderedHeight: number | undefined;
	readonly kind: ChatItemHeightUpdateKind;
	readonly height: number;
}

export function reconcileChatItemHeight(
	normalizedHeight: number,
	currentRenderedHeight: number | undefined,
	isBeingRendered: boolean,
	allocatedHeight: number | undefined,
): IChatItemHeightUpdate {
	if (normalizedHeight === currentRenderedHeight) {
		return { nextRenderedHeight: currentRenderedHeight, kind: 'none', height: normalizedHeight };
	}

	if (isBeingRendered) {
		return { nextRenderedHeight: currentRenderedHeight, kind: 'deferReMeasure', height: normalizedHeight };
	}

	if (typeof currentRenderedHeight === 'number') {
		return { nextRenderedHeight: normalizedHeight, kind: 'fire', height: normalizedHeight };
	}

	if (!shouldScheduleInitialHeightChange(normalizedHeight, allocatedHeight)) {
		return { nextRenderedHeight: normalizedHeight, kind: 'none', height: normalizedHeight };
	}

	return { nextRenderedHeight: normalizedHeight, kind: 'scheduleInitial', height: normalizedHeight };
}

export function renderChatResponseDetails(container: HTMLElement, details: string | undefined, completedAt: number | undefined, elapsedMs: number | undefined, verbose: boolean, tokenStatsAriaLabel?: string): HTMLElement | undefined {
	dom.clearNode(container);
	container.classList.remove('chat-response-flip-active', 'chat-response-flip-down', 'chat-response-flip-reset');

	const completion = verbose ? formatChatRequestTimestamp(completedAt) : undefined;
	const elapsed = completion ? formatChatResponseElapsedTime(elapsedMs) : undefined;
	const alternate = completion?.isRelative
		? formatChatResponseDetails(elapsed, completion.fullText)
		: elapsed;
	const responseDetails = formatChatResponseDetails(details, completion?.text);

	let completedAtElement: HTMLElement | undefined;
	if (completion) {
		const timing = dom.append(container, $('span.chat-response-timing'));
		completedAtElement = dom.append(timing, $('time.chat-response-completed-at', { datetime: completion.dateTime }, completion.text));
		if (alternate) {
			dom.append(timing, $('span.chat-response-alternate', undefined, alternate));
		}
		timing.classList.toggle('has-alternate', !!alternate);
	}
	if (completion && details) {
		dom.append(container, $('span.chat-response-details-separator', { 'aria-hidden': 'true' }, '\u2022'));
	}
	if (details) {
		dom.append(container, $('span.chat-response-model-details', undefined, details));
	}

	const accessibleTiming = completion
		? localize('chatResponseCompletedAt', "Completed {0}", completion.fullText)
		: undefined;
	const accessibleElapsed = elapsed
		? localize('chatResponseElapsed', "Elapsed time {0}", elapsed)
		: undefined;
	container.ariaLabel = [accessibleTiming, accessibleElapsed, details, tokenStatsAriaLabel].filter(Boolean).join(', ');
	container.classList.toggle('hidden', !responseDetails);
	container.tabIndex = responseDetails ? 0 : -1;
	return completedAtElement;
}

export function renderChatRequestTimestamp(container: HTMLElement, timestamp: number | undefined): { readonly element: HTMLElement; readonly hoverText?: string } | undefined {
	const formatted = formatChatRequestTimestamp(timestamp);
	if (!formatted) {
		return undefined;
	}

	if (!formatted.isRelative) {
		const element = dom.append(container, $('time.chat-request-timestamp', {
			datetime: formatted.dateTime,
			'aria-label': localize('chatRequestSentAt', "Sent {0}", formatted.fullText),
			tabindex: 0,
		}, formatted.text));
		return { element, hoverText: formatted.fullText };
	}

	const element = dom.append(container, $('span.chat-request-timestamp', {
		'aria-label': localize('chatRequestSentAt', "Sent {0}", formatted.fullText),
		tabindex: 0,
	}));
	const timing = dom.append(element, $('span.chat-request-timing.has-alternate'));
	dom.append(timing, $('time.chat-request-relative', { datetime: formatted.dateTime }, formatted.text));
	dom.append(timing, $('time.chat-request-full-date', { datetime: formatted.dateTime }, formatted.fullText));
	return { element };
}

export function shouldRenderInitialProgressiveContentImmediately(isComplete: boolean, hasMarkdownParts: boolean, hasRenderData: boolean): boolean {
	return !isComplete && hasMarkdownParts && !hasRenderData;
}

export function shouldStartNewCollapsedThinkingGroup(displayMode: ThinkingDisplayMode, existingGroup: 'reasoning' | 'items', incomingGroup: 'reasoning' | 'items'): boolean {
	return false;
}

export function shouldCreateGroupedThinkingPart(collapsedToolsMode: CollapsedToolsDisplayMode, separatedFromReasoning: boolean): boolean {
	return collapsedToolsMode === CollapsedToolsDisplayMode.Always || separatedFromReasoning;
}

export function shouldShowFileChangesSummaryForSettings(isComplete: boolean, isLocalSession: boolean, showFileChanges: boolean): boolean {
	return isComplete && isLocalSession && showFileChanges;
}

export function shouldShowTurnPillsSummary(isComplete: boolean, isAgentHostSession: boolean): boolean {
	return isComplete && isAgentHostSession;
}

export function shouldPinToolInvocationToThinking(state: IChatToolInvocation.StateKind, hasConfirmationMessages: boolean, hasMcpAppData: boolean): boolean {
	return !hasMcpAppData
		&& state !== IChatToolInvocation.StateKind.WaitingForConfirmation
		&& state !== IChatToolInvocation.StateKind.WaitingForPostApproval
		&& state !== IChatToolInvocation.StateKind.WaitingForAuthentication
		&& !hasConfirmationMessages;
}

function toolInvocationHasMcpAppData(toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized): boolean {
	return toolInvocation.toolSpecificData?.kind === 'input' && !!toolInvocation.toolSpecificData.mcpAppData;
}

function isGeneratedImageResultOwner(toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized, content: ReadonlyArray<IChatRendererContent>): boolean {
	for (let index = content.length - 1; index >= 0; index--) {
		const part = content[index];
		if ((part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && part.toolSpecificData?.kind === 'generatedImage') {
			return part.toolCallId === toolInvocation.toolCallId;
		}
	}
	return false;
}

const forceVerboseLayoutTracing = false
	;

export interface IChatRendererDelegate {
	container: HTMLElement;
	getListLength(): number;
	currentChatMode(): ChatModeKind;
	isStickyScrollEnabled(): boolean;
	refreshStickyScroll(): void;
	readonly stickyScrollTopPadding: number;
	getEditingValue?(): string | undefined;

	readonly onDidScroll?: Event<ScrollEvent>;
}

const mostRecentResponseClassName = 'chat-most-recent-response';

export function shouldHideChatUserIdentity(username: string, sessionResource: URI, isResponse: boolean, isSystemInitiatedRequest: boolean): boolean {
	const sessionType = getChatSessionType(sessionResource);
	return username === DARDCOR_USERNAME ||
		username === 'Dardcor AI' ||
		username === 'Dardcor Code' ||
		username.toLowerCase() === 'dardcor code' ||
		username.toLowerCase().includes('dardcor') ||
		(isResponse && isAgentHostCopilotSessionType(sessionType)) ||
		isSystemInitiatedRequest;
}

function isAgentHostCopilotSessionType(sessionType: string): boolean {
	return sessionType === 'agent-host-copilotcli' ||
		parseRemoteAgentHostSessionTypeAuthority(sessionType, SessionType.CopilotCLI) !== undefined;
}

function upvoteAnimationSettingToEnum(value: string | undefined): ClickAnimation | undefined {
	switch (value) {
		case 'confetti': return ClickAnimation.Confetti;
		case 'floatingThumbs': return ClickAnimation.FloatingIcons;
		case 'pulseWave': return ClickAnimation.PulseWave;
		case 'radiantLines': return ClickAnimation.RadiantLines;
		default: return undefined;
	}
}

export function isAnchorTarget(target: EventTarget | null): boolean {
	return dom.isHTMLElement(target) && !!target.closest('a');
}

export class ChatListItemRenderer extends Disposable implements ITreeRenderer<ChatTreeItem, FuzzyScore, IChatListItemTemplate> {
	static readonly ID = 'item';

	private readonly codeBlocksByResponseId = new Map<string, IChatCodeBlockInfo[]>();
	private readonly codeBlocksByEditorUri = new ResourceMap<IChatCodeBlockInfo>();

	private readonly fileTreesByResponseId = new Map<string, IChatFileTreeInfo[]>();
	private readonly focusedFileTreesByResponseId = new Map<string, number>();

	private readonly templateDataByRequestId = new Map<string, IChatListItemTemplate>();
	private readonly responseTemplateDataByRequestId = new Map<string, IChatListItemTemplate>();
	private readonly stickyScrollTemplateDataByRequestId = new Map<string, IChatListItemTemplate>();
	private readonly hoveredRequestBubbleByRequestId = new Map<string, HTMLElement>();
	private readonly stickyScrollSourceWidthRatioByRequestId = new Map<string, number>();
	private readonly appliedStickyScrollWidthRatioByBubble = new WeakMap<HTMLElement, number>();
	private readonly stickyScrollSourceRangesByRequestId = new Map<string, IStickyScrollNodeSourceRange | null>();
	private readonly stickyScrollRequestContentById = new Map<string, { contentKey: string; hasContent: boolean }>();
	private readonly pendingStickyScrollSourceRangeRefresh = this._register(new MutableDisposable<IDisposable>());
	private readonly pendingStickyScrollStateRefresh = this._register(new MutableDisposable<IDisposable>());
	private readonly templateDataByRow = new WeakMap<HTMLElement, IChatListItemTemplate>();

	private readonly pendingQuestionCarousels = new ResourceMap<Set<ChatQuestionCarouselPart>>();
	private readonly _notifiedQuestionCarousels = new Set<string>();
	private readonly workingProgressConfirmationEndListeners = new WeakSet<IChatToolInvocation>();

	private readonly chatContentMarkdownRenderer: IMarkdownRenderer;
	private readonly markdownDecorationsRenderer: ChatMarkdownDecorationsRenderer;
	protected readonly _onDidClickFollowup = this._register(new Emitter<IChatFollowup>());
	readonly onDidClickFollowup: Event<IChatFollowup> = this._onDidClickFollowup.event;

	private readonly _onDidClickRerunWithAgentOrCommandDetection = this._register(new Emitter<{ readonly sessionResource: URI; readonly requestId: string }>());
	readonly onDidClickRerunWithAgentOrCommandDetection = this._onDidClickRerunWithAgentOrCommandDetection.event;


	private readonly _onDidClickRequest = this._register(new Emitter<IChatListItemTemplate>());
	readonly onDidClickRequest: Event<IChatListItemTemplate> = this._onDidClickRequest.event;

	private readonly _onDidRerender = this._register(new Emitter<IChatListItemTemplate>());
	readonly onDidRerender: Event<IChatListItemTemplate> = this._onDidRerender.event;

	private readonly _onDidDispose = this._register(new Emitter<IChatListItemTemplate>());
	readonly onDidDispose: Event<IChatListItemTemplate> = this._onDidDispose.event;

	private readonly _onDidFocusOutside = this._register(new Emitter<void>());
	readonly onDidFocusOutside: Event<void> = this._onDidFocusOutside.event;

	protected readonly _onDidChangeItemHeight = this._register(new Emitter<IItemHeightChangeParams>());
	readonly onDidChangeItemHeight: Event<IItemHeightChangeParams> = this._onDidChangeItemHeight.event;

	private readonly _onDidUpdateViewModel = this._register(new Emitter<void>());

	private readonly _editorPool: EditorPool;
	private readonly _toolEditorPool: EditorPool;
	private readonly _diffEditorPool: DiffEditorPool;
	private readonly _treePool: TreePool;
	private readonly _contentReferencesListPool: CollapsibleListPool;

	private _currentLayoutWidth = observableValue(this, 0);
	private _isVisible = true;
	private _elementBeingRendered: ChatTreeItem | undefined;
	private _onDidChangeVisibility = this._register(new Emitter<boolean>());

	private readonly _inlineTextModels: InlineTextModelCollection;

	private _incrementalRenderingTelemetryLogged = false;

	private readonly _announcedToolProgressKeys = new Set<string>();

	constructor(
		editorOptions: ChatEditorOptions,
		private rendererOptions: IChatListItemRendererOptions,
		private readonly delegate: IChatRendererDelegate,
		overflowWidgetsDomNode: HTMLElement | undefined,
		private viewModel: IChatViewModel | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IThemeService private readonly themeService: IThemeService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@IChatService private readonly chatService: IChatService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IClipboardService private readonly clipboardService: IClipboardService,
	) {
		super();

		this.chatContentMarkdownRenderer = this.instantiationService.createInstance(ChatContentMarkdownRenderer);
		this.markdownDecorationsRenderer = this._register(this.instantiationService.createInstance(ChatMarkdownDecorationsRenderer));
		this._editorPool = this._register(this.instantiationService.createInstance(EditorPool, editorOptions, delegate, overflowWidgetsDomNode, true));
		this._toolEditorPool = this._register(this.instantiationService.createInstance(EditorPool, editorOptions, delegate, overflowWidgetsDomNode, true));
		this._diffEditorPool = this._register(this.instantiationService.createInstance(DiffEditorPool, editorOptions, delegate, overflowWidgetsDomNode, true));
		this._treePool = this._register(this.instantiationService.createInstance(TreePool, this._onDidChangeVisibility.event));
		this._contentReferencesListPool = this._register(this.instantiationService.createInstance(CollapsibleListPool, this._onDidChangeVisibility.event, undefined, undefined));

		this._inlineTextModels = this._register(this.instantiationService.createInstance(InlineTextModelCollection));
		this._register(this.instantiationService.createInstance(ChatCodeBlockContentProvider));
		this._register(this.chatService.onDidSubmitRequest(e => {
			const carousels = this.pendingQuestionCarousels.get(e.chatSessionResource);
			if (carousels) {
				for (const carousel of carousels) {
					carousel.skip();
				}
				carousels.clear();
			}
		}));

		this._register(this.configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.AutoReply) && this.configService.getValue<boolean>(ChatConfiguration.AutoReply)) {
				for (const [, carousels] of this.pendingQuestionCarousels) {
					for (const carousel of carousels) {
						carousel.skip();
					}
					carousels.clear();
				}
			}
		}));
	}

	private _pendingDragController: ChatPendingDragController | undefined;

	set pendingDragController(controller: ChatPendingDragController) {
		this._pendingDragController = controller;
	}

	public updateOptions(options: IChatListItemRendererOptions): void {
		this.rendererOptions = { ...this.rendererOptions, ...options };
	}

	get templateId(): string {
		return ChatListItemRenderer.ID;
	}

	editorsInUse(): Iterable<CodeBlockPart> {
		return Iterable.concat(this._editorPool.inUse(), this._toolEditorPool.inUse());
	}



	private traceLayout(method: string, message: string) {
		if (forceVerboseLayoutTracing) {
			this.logService.info(`ChatListItemRenderer#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatListItemRenderer#${method}: ${message}`);
		}
	}

	private fireItemHeightChange(template: IChatListItemTemplate, measuredHeight?: number): void {
		if (!template.currentElement || !template.rowContainer.isConnected) {
			return;
		}

		if (dom.findParentWithClass(template.rowContainer, 'monaco-tree-sticky-row')) {
			return;
		}

		if (isRequestVM(template.currentElement)) {
			this.scheduleStickyScrollSourceRangeRefresh();
		}

		const height = measuredHeight ?? template.rowContainer.getBoundingClientRect().height;
		if (height === 0 || !height) {
			return;
		}

		const normalizedHeight = Math.ceil(height);
		const element = template.currentElement;
		const update = reconcileChatItemHeight(
			normalizedHeight,
			element.currentRenderedHeight,
			element === this._elementBeingRendered,
			template.allocatedHeight,
		);
		element.currentRenderedHeight = update.nextRenderedHeight;

		if (update.kind === 'fire') {
			this._onDidChangeItemHeight.fire({ element, height: update.height });
		} else if (update.kind === 'scheduleInitial') {
			const scheduledHeight = update.height;
			dom.scheduleAtNextAnimationFrame(dom.getWindow(template.rowContainer), () => {
				if (template.currentElement !== element || element.currentRenderedHeight !== scheduledHeight) {
					return;
				}
				this._onDidChangeItemHeight.fire({ element, height: scheduledHeight });
			});
		} else if (update.kind === 'deferReMeasure') {
			dom.scheduleAtNextAnimationFrame(dom.getWindow(template.rowContainer), () => {
				if (template.currentElement === element && element !== this._elementBeingRendered) {
					this.fireItemHeightChange(template);
				}
			});
		}
	}

	private getProgressiveRenderRate(element: IChatResponseViewModel): number {
		const enum Rate {
			Min = 40,
			Max = 2000,
		}

		const minAfterComplete = 80;

		const rate = element.contentUpdateTimings?.impliedWordLoadRate;
		if (element.isComplete) {
			if (typeof rate === 'number') {
				return clamp(rate, minAfterComplete, Rate.Max);
			} else {
				return minAfterComplete;
			}
		}

		if (typeof rate === 'number') {
			return clamp(rate, Rate.Min, Rate.Max);
		}

		return 8;
	}

	getCodeBlockInfosForResponse(response: IChatResponseViewModel): IChatCodeBlockInfo[] {
		const codeBlocks = this.codeBlocksByResponseId.get(response.id);
		return codeBlocks ?? [];
	}

	getStickyScrollSourceRange(element: ChatTreeItem, defaultRange: IStickyScrollNodeSourceRange): IStickyScrollNodeSourceRange | undefined {
		if (!isRequestVM(element)
			|| element.isSystemInitiated
			|| !!element.confirmation
			|| !this.requestHasStickyScrollContent(element)) {
			return undefined;
		}

		const sourceRange = this.stickyScrollSourceRangesByRequestId.get(element.id);
		if (sourceRange) {
			return sourceRange;
		}
		return this.stickyScrollSourceRangesByRequestId.has(element.id) ? undefined : { ...defaultRange, estimated: true };
	}

	refreshStickyScrollSourceRanges(invalidateRejected = false): void {
		if (!this.delegate.isStickyScrollEnabled()) {
			this.stickyScrollSourceRangesByRequestId.clear();
			this.stickyScrollSourceWidthRatioByRequestId.clear();
			return;
		}

		if (invalidateRejected) {
			for (const [requestId, sourceRange] of this.stickyScrollSourceRangesByRequestId) {
				if (sourceRange === null) {
					this.stickyScrollSourceRangesByRequestId.delete(requestId);
				}
			}
		}

		for (const templateData of this.templateDataByRequestId.values()) {
			if (isRequestVM(templateData.currentElement)) {
				this.updateStickyScrollSourceRange(templateData.currentElement, templateData);
			}
		}
		for (const templateData of this.stickyScrollTemplateDataByRequestId.values()) {
			if (isRequestVM(templateData.currentElement)) {
				this.updateStickyScrollSourceRange(templateData.currentElement, templateData);
			}
		}
	}

	updateViewModel(viewModel: IChatViewModel | undefined): void {
		this.viewModel = viewModel;
		this._announcedToolProgressKeys.clear();
		this._notifiedQuestionCarousels.clear();
		this.codeBlocksByEditorUri.clear();
		this.codeBlocksByResponseId.clear();
		this.fileTreesByResponseId.clear();
		this.focusedFileTreesByResponseId.clear();
		this.responseTemplateDataByRequestId.clear();
		this.templateDataByRequestId.clear();
		this.stickyScrollTemplateDataByRequestId.clear();
		this.hoveredRequestBubbleByRequestId.clear();
		this.stickyScrollSourceWidthRatioByRequestId.clear();
		this.stickyScrollSourceRangesByRequestId.clear();
		this.stickyScrollRequestContentById.clear();

		this._onDidUpdateViewModel.fire();
		this._editorPool.clear();
		this._toolEditorPool.clear();
		this._diffEditorPool.clear();
		this._treePool.clear();
		this._contentReferencesListPool.clear();
	}

	getCodeBlockInfoForEditor(uri: URI): IChatCodeBlockInfo | undefined {
		return this.codeBlocksByEditorUri.get(uri);
	}

	getFileTreeInfosForResponse(response: IChatResponseViewModel): IChatFileTreeInfo[] {
		const fileTrees = this.fileTreesByResponseId.get(response.id);
		return fileTrees ?? [];
	}

	getLastFocusedFileTreeForResponse(response: IChatResponseViewModel): IChatFileTreeInfo | undefined {
		const fileTrees = this.fileTreesByResponseId.get(response.id);
		const lastFocusedFileTreeIndex = this.focusedFileTreesByResponseId.get(response.id);
		if (fileTrees?.length && lastFocusedFileTreeIndex !== undefined && lastFocusedFileTreeIndex < fileTrees.length) {
			return fileTrees[lastFocusedFileTreeIndex];
		}
		return undefined;
	}

	getTemplateDataForRequestId(requestId?: string): IChatListItemTemplate | undefined {
		if (!requestId) {
			return undefined;
		}
		const templateData = this.templateDataByRequestId.get(requestId);
		if (templateData && templateData.currentElement?.id === requestId) {
			return templateData;
		}
		if (templateData) {
			this.templateDataByRequestId.delete(requestId);
		}
		return undefined;
	}

	setVisible(visible: boolean): void {
		this._isVisible = visible;
		this._onDidChangeVisibility.fire(visible);
	}

	layout(width: number): void {
		const newWidth = width - (this.rendererOptions.contentHorizontalPadding ?? DEFAULT_CHAT_ITEM_HORIZONTAL_PADDING);
		if (newWidth !== this._currentLayoutWidth.get()) {
			this._currentLayoutWidth.set(newWidth, undefined);
			for (const editor of this._editorPool.inUse()) {
				editor.layout(newWidth);
			}
			for (const toolEditor of this._toolEditorPool.inUse()) {
				toolEditor.layout(newWidth);
			}
			for (const diffEditor of this._diffEditorPool.inUse()) {
				diffEditor.layout(newWidth);
			}
			this.stickyScrollSourceWidthRatioByRequestId.clear();
			this.stickyScrollSourceRangesByRequestId.clear();
			this.scheduleStickyScrollSourceRangeRefresh();
		}
	}

	getElementFromNode(node: HTMLElement): ChatTreeItem | undefined {
		let current: HTMLElement | null = node;
		while (current && this.delegate.container.contains(current)) {
			const element = this.templateDataByRow.get(current)?.currentElement;
			if (element) {
				return element;
			}
			current = current.parentElement;
		}
		return undefined;
	}

	renderTemplate(container: HTMLElement): IChatListItemTemplate {
		const templateDisposables = new DisposableStore();
		const disabledOverlay = dom.append(container, $('.chat-row-disabled-overlay'));
		const rowContainer = dom.append(container, $('.interactive-item-container'));
		if (this.rendererOptions.renderStyle === 'compact') {
			rowContainer.classList.add('interactive-item-compact');
		}

		let headerParent = rowContainer;
		let valueParent = rowContainer;
		let detailContainerParent: HTMLElement | undefined;

		if (this.rendererOptions.renderStyle === 'minimal') {
			rowContainer.classList.add('interactive-item-compact');
			rowContainer.classList.add('minimal');
			const lhsContainer = dom.append(rowContainer, $('.column.left'));
			const rhsContainer = dom.append(rowContainer, $('.column.right'));

			headerParent = lhsContainer;
			detailContainerParent = rhsContainer;
			valueParent = rhsContainer;
		}

		const header = dom.append(headerParent, $('.header'));
		const contextKeyService = templateDisposables.add(this.contextKeyService.createScoped(rowContainer));
		const scopedInstantiationService = templateDisposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService])));

		const requestHover = dom.append(rowContainer, $('.request-hover'));
		let titleToolbar: MenuWorkbenchToolBar | undefined;
		if (this.rendererOptions.noHeader) {
			header.classList.add('hidden');
		} else {
			titleToolbar = templateDisposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, requestHover, MenuId.ChatMessageTitle, {
				menuOptions: {
					shouldForwardArgs: true
				},
				toolbarOptions: {
					shouldInlineSubmenu: submenu => submenu.actions.length <= 1
				},
			}));
		}
		this.hoverHidden(requestHover);

		const checkpointContainer = dom.append(rowContainer, $('.checkpoint-container'));
		dom.append(checkpointContainer, $('.checkpoint-line-left'));

		const checkpointToolbar = templateDisposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, checkpointContainer, MenuId.ChatMessageCheckpoint, {
			actionViewItemProvider: (action, options) => {
				if (action instanceof MenuItemAction) {
					if (action.item.id === RestoreCheckpointActionId || action.item.id === StartOverActionId) {
						const isStartOver = action.item.id === StartOverActionId;
						const cancelLabel = isStartOver
							? localize('chat.startOver.cancelTooltip', "Cancel starting over")
							: localize('chat.restoreCheckpoint.cancelTooltip', "Cancel restoring this checkpoint");
						const confirmTooltip = isStartOver
							? localize('chat.startOver.confirmTooltip', "Confirm starting over and discarding all edits")
							: localize('chat.restoreCheckpoint.confirmTooltip', "Confirm restoring this checkpoint and discarding later edits");
						return this.instantiationService.createInstance(ChatRestoreCheckpointActionViewItem, action, { hoverDelegate: options.hoverDelegate }, (context: unknown) => this.discardEditsActionNeedsConfirmation(context), cancelLabel, confirmTooltip);
					}
					if (action.item.id === ForkConversationActionId) {
						return this.instantiationService.createInstance(ChatForkActionViewItem, action, { hoverDelegate: options.hoverDelegate });
					}
					return this.instantiationService.createInstance(CodiconActionViewItem, action, { hoverDelegate: options.hoverDelegate });
				}
				return undefined;
			},
			renderDropdownAsChildElement: true,
			menuOptions: {
				shouldForwardArgs: true
			},
			toolbarOptions: {
				shouldInlineSubmenu: submenu => submenu.actions.length <= 1
			},
		}));

		dom.append(checkpointContainer, $('.checkpoint-line-right'));

		const user = dom.append(header, $('.user'));
		const avatarContainer = dom.append(user, $('.avatar-container'));
		const username = dom.append(user, $('h3.username'));
		username.tabIndex = 0;
		const detailContainer = dom.append(detailContainerParent ?? user, $('span.detail-container'));
		const detail = dom.append(detailContainer, $('span.detail'));
		dom.append(detailContainer, $('span.chat-animated-ellipsis'));
		const value = dom.append(valueParent, $('.value'));
		const requestTimestampContainer = dom.append(valueParent, $('.chat-request-timestamp-container'));
		const requestActionsContainer = dom.append(valueParent, $('.chat-request-actions-container'));
		const elementDisposables = templateDisposables.add(new DisposableStore());
		const completedResponseDisclosureDisposables = templateDisposables.add(new DisposableStore());
		const responseTokenStatsHover = templateDisposables.add(new MutableDisposable<IManagedHover>());

		const footerToolbarContainer = dom.append(rowContainer, $('.chat-footer-toolbar'));
		if (this.rendererOptions.noFooter) {
			footerToolbarContainer.classList.add('hidden');
		}

		const footerToolbar = templateDisposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, footerToolbarContainer, MenuId.ChatMessageFooter, {
			menuOptions: { shouldForwardArgs: true, renderShortTitle: true },
			toolbarOptions: { shouldInlineSubmenu: submenu => submenu.actions.length <= 1 },
			actionViewItemProvider: (action: IAction, options: IActionViewItemOptions) => {
				if (action instanceof MenuItemAction && action.item.id === MarkHelpfulActionId) {
					const animation = upvoteAnimationSettingToEnum(this.configService.getValue<string>('chat.upvoteAnimation'));
					return scopedInstantiationService.createInstance(MenuEntryActionViewItem, action, { ...options, onClickAnimation: animation });
				}
				return createActionViewItem(scopedInstantiationService, action, options);
			}
		}));

		const footerDetailsContainer = dom.append(footerToolbar.getElement(), $('.chat-footer-details'));
		footerDetailsContainer.tabIndex = 0;

		const feedbackSurveyContainer = dom.append(rowContainer, $('.chat-feedback-survey-widget.hidden'));
		const feedbackSurveyWidget = templateDisposables.add(scopedInstantiationService.createInstance(ChatModelFeedbackSurveyWidget, feedbackSurveyContainer, () => focusChatModelFeedbackSurveyAction(footerToolbar)));

		const checkpointRestoreContainer = dom.append(rowContainer, $('.checkpoint-restore-container'));
		dom.append(checkpointRestoreContainer, $('.checkpoint-line-left'));
		const label = dom.append(checkpointRestoreContainer, $('span.checkpoint-label-text'));
		label.textContent = localize('checkpointRestore', 'Checkpoint Restored');
		const dot = dom.append(checkpointRestoreContainer, $('span.checkpoint-dot-separator'));
		dot.textContent = '\u00B7';
		dot.setAttribute('aria-hidden', 'true');
		const checkpointRestoreToolbar = templateDisposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, checkpointRestoreContainer, MenuId.ChatMessageRestoreCheckpoint, {
			actionViewItemProvider: (action, options) => {
				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(CodiconActionViewItem, action, { hoverDelegate: options.hoverDelegate });
				}
				return undefined;
			},
			renderDropdownAsChildElement: true,
			menuOptions: {
				shouldForwardArgs: true
			},
			toolbarOptions: {
				shouldInlineSubmenu: submenu => submenu.actions.length <= 1
			},
		}));

		dom.append(checkpointRestoreContainer, $('.checkpoint-line-right'));


		const agentHover = templateDisposables.add(this.instantiationService.createInstance(ChatAgentHover));
		const hoverContent = () => {
			if (isResponseVM(template.currentElement) && template.currentElement.agent && !template.currentElement.agent.isDefault) {
				agentHover.setAgent(template.currentElement.agent.id);
				return agentHover.domNode;
			}

			return undefined;
		};
		const hoverOptions = getChatAgentHoverOptions(() => isResponseVM(template.currentElement) ? template.currentElement.agent : undefined, this.commandService);
		templateDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), user, hoverContent, hoverOptions));
		templateDisposables.add(dom.addDisposableListener(user, dom.EventType.KEY_DOWN, e => {
			const ev = new StandardKeyboardEvent(e);
			if ((ev.equals(KeyCode.Space) || ev.equals(KeyCode.Enter)) && !isAnchorTarget(e.target)) {
				const content = hoverContent();
				if (content) {
					this.hoverService.showInstantHover({ content, target: user, trapFocus: true, actions: hoverOptions.actions }, true);
				}
			} else if (ev.equals(KeyCode.Escape)) {
				this.hoverService.hideHover();
			}
		}));
		const connectionObserver = document.createElement('connection-observer') as dom.ConnectionObserverElement;
		dom.append(container, connectionObserver);
		const template: IChatListItemTemplate = { header, avatarContainer, requestHover, username, detail, value, requestTimestampContainer, requestActionsContainer, rowContainer, elementDisposables, templateDisposables, contextKeyService, instantiationService: scopedInstantiationService, agentHover, titleToolbar, footerToolbar, footerToolbarContainer, footerDetailsContainer, disabledOverlay, checkpointToolbar, checkpointRestoreToolbar, checkpointContainer, checkpointRestoreContainer, completedResponseDisclosureDisposables, responseTokenStatsHover, feedbackSurveyWidget };
		this.templateDataByRow.set(rowContainer, template);

		templateDisposables.add(this._onDidUpdateViewModel.event(() => {
			if (!template.currentElement || !this.viewModel?.sessionResource || !isEqual(template.currentElement.sessionResource, this.viewModel.sessionResource)) {
				this.clearRenderedParts(template);
			}
		}));

		templateDisposables.add(dom.addDisposableListener(disabledOverlay, dom.EventType.CLICK, e => {
			if (!this.viewModel?.editing) {
				return;
			}
			const current = template.currentElement;
			if (!current || current.id === this.viewModel.editing.id) {
				return;
			}

			if (disabledOverlay.classList.contains('disabled')) {
				e?.preventDefault();
				e?.stopPropagation();
				this._onDidFocusOutside.fire();
			}
		}));

		const resizeObserver = templateDisposables.add(new dom.DisposableResizeObserver('ChatListItemRenderer.itemHeight', (entries) => {
			const entry = entries[0];
			if (entry) {
				this.fireItemHeightChange(template, entry.borderBoxSize.at(0)?.blockSize);
			}
		}));
		const resizeObservation = templateDisposables.add(new MutableDisposable<IDisposable>());
		connectionObserver.onDidConnect = () => {
			resizeObservation.value = resizeObserver.observe(rowContainer);
		};
		connectionObserver.onDidDisconnect = () => {
			template.renderedPartsMounted = false;
			resizeObservation.clear();
		};
		if (rowContainer.isConnected) {
			connectionObserver.onDidConnect();
		}

		return template;
	}

	private discardEditsActionNeedsConfirmation(context: unknown): boolean {
		if (!isRequestVM(context) && !isResponseVM(context)) {
			return false;
		}

		return false;
	}

	renderElement(node: ITreeNode<ChatTreeItem, FuzzyScore>, index: number, templateData: IChatListItemTemplate, details?: IListElementRenderDetails): void {
		templateData.allocatedHeight = details?.height;
		this._elementBeingRendered = node.element;
		try {
			this.renderChatTreeItem(node.element, index, templateData);
		} finally {
			this._elementBeingRendered = undefined;
		}
	}

	private clearRenderedParts(templateData: IChatListItemTemplate): void {
		this.removeCompletedResponseDisclosure(templateData);
		if (templateData.renderedParts) {
			dispose(coalesce(templateData.renderedParts));
			templateData.renderedParts = undefined;
			templateData.renderedContent = undefined;
			dom.clearNode(templateData.value);
		} else if (isPendingDividerVM(templateData.currentElement)) {
			dom.clearNode(templateData.value);
		}
		templateData.stickyScrollSource = undefined;

		templateData.movedOutToolParts?.dispose();
		templateData.movedOutToolParts = undefined;

		if (templateData.titleToolbar) {
			templateData.titleToolbar.context = undefined;
		}
		templateData.footerToolbar.context = undefined;
		templateData.checkpointToolbar.context = undefined;
		templateData.checkpointRestoreToolbar.context = undefined;
		templateData.currentElement = undefined;
		templateData.completedResponseDisclosureOpen = undefined;
		templateData.completedResponseCollapseEndIndex = undefined;
		templateData.wasResponseComplete = undefined;
	}

	private renderChatTreeItem(element: ChatTreeItem, index: number, templateData: IChatListItemTemplate): void {
		if (templateData.currentElement && templateData.currentElement.id !== element.id) {
			this.traceLayout('renderChatTreeItem', `Rendering a different element into the template, index=${index}`);
			const mappedTemplateData = this.templateDataByRequestId.get(templateData.currentElement.id);
			if (mappedTemplateData && (mappedTemplateData.currentElement?.id !== templateData.currentElement.id)) {
				this.templateDataByRequestId.delete(templateData.currentElement.id);
			}

			this.clearRenderedParts(templateData);
		}

		templateData.currentElement = element;
		if (!dom.findParentWithClass(templateData.rowContainer, 'monaco-tree-sticky-row')) {
			this.templateDataByRequestId.set(element.id, templateData);
		}

		templateData.rowContainer.classList.remove('pending-item', 'pending-divider', 'pending-request', 'chat-pending-dragging', 'terminal-command-request', 'chat-system-notification-response');
		templateData.dragHandle?.remove();
		templateData.dragHandle = undefined;
		delete templateData.rowContainer.dataset.pendingRequestId;
		delete templateData.rowContainer.dataset.pendingKind;

		if (isPendingDividerVM(element)) {
			this.renderPendingDivider(element, templateData);
			return;
		}

		const kind = isRequestVM(element) ? 'request' :
			isResponseVM(element) ? 'response' :
				isPendingDividerVM(element) ? 'pendingDivider' :
					'welcome';
		this.traceLayout('renderElement', `${kind}, index=${index}`);

		ChatContextKeys.isResponse.bindTo(templateData.contextKeyService).set(isResponseVM(element));
		ChatContextKeys.itemId.bindTo(templateData.contextKeyService).set(element.id);
		ChatContextKeys.isRequest.bindTo(templateData.contextKeyService).set(isRequestVM(element));
		ChatContextKeys.isFirstRequest.bindTo(templateData.contextKeyService).set(isRequestVM(element) && this.viewModel?.model.getRequests()[0]?.id === element.id);
		ChatContextKeys.isPendingRequest.bindTo(templateData.contextKeyService).set(isRequestVM(element) && !!element.pendingKind);
		ChatContextKeys.responseDetectedAgentCommand.bindTo(templateData.contextKeyService).set(isResponseVM(element) && element.agentOrSlashCommandDetected);
		if (isResponseVM(element)) {
			ChatContextKeys.responseSupportsIssueReporting.bindTo(templateData.contextKeyService).set(!!element.agent?.metadata.supportIssueReporting);
			ChatContextKeys.responseVote.bindTo(templateData.contextKeyService).set(element.vote === ChatAgentVoteDirection.Up ? 'up' : element.vote === ChatAgentVoteDirection.Down ? 'down' : '');
			templateData.feedbackSurveyWidget.render(element);
		} else {
			ChatContextKeys.responseVote.bindTo(templateData.contextKeyService).set('');
			templateData.feedbackSurveyWidget.render(undefined);
		}

		if (templateData.titleToolbar) {
			templateData.titleToolbar.context = element;
		}
		templateData.footerToolbar.context = element;

		const rendersInlineSystemNotificationTiming = isResponseVM(element)
			&& element.response.value.length > 0
			&& element.response.value.every(part => part.kind === 'systemNotification' && part.renderInlineTiming);
		const responseTimingListeners = templateData.elementDisposables.add(new MutableDisposable());
		const updateResponseDetails = () => {
			const inlineTimingContainer = rendersInlineSystemNotificationTiming
				? templateData.renderedParts?.findLast(part => part instanceof ChatSystemNotificationContentPart)?.inlineTimingContainer
				: undefined;
			const responseDetailsContainer = inlineTimingContainer ?? templateData.footerDetailsContainer;
			if (rendersInlineSystemNotificationTiming) {
				renderChatResponseDetails(templateData.footerDetailsContainer, undefined, undefined, undefined, false);
			}
			const details = isResponseVM(element) && !rendersInlineSystemNotificationTiming ? element.result?.details : undefined;
			const tokenStats = isResponseVM(element)
				&& !rendersInlineSystemNotificationTiming
				? formatResponseTokenStats(element.model.usage?.modelTotals, element.model.completionTimestamp)
				: undefined;
			const completedAtElement = renderChatResponseDetails(
				responseDetailsContainer,
				details,
				isResponseVM(element) ? element.model.completionTimestamp : undefined,
				isResponseVM(element) && !rendersInlineSystemNotificationTiming ? element.model.elapsedMs : undefined,
				isResponseVM(element) && this.configService.getValue<boolean>(ChatConfiguration.Verbose),
				tokenStats?.footerAriaLabel,
			);
			const tokenStatsHover = templateData.responseTokenStatsHover;
			if (!tokenStats) {
				tokenStatsHover.clear();
			} else if (tokenStatsHover.value) {
				tokenStatsHover.value.update(tokenStats);
			} else {
				tokenStatsHover.value = this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), templateData.footerDetailsContainer, tokenStats);
			}
			if (!completedAtElement) {
				responseTimingListeners.clear();
				return;
			}

			const listeners = new DisposableStore();
			responseTimingListeners.value = listeners;
			let responseTimingBounds: DOMRect | undefined;
			listeners.add(dom.addDisposableListener(completedAtElement, dom.EventType.MOUSE_ENTER, e => {
				const bounds = completedAtElement.getBoundingClientRect();
				responseTimingBounds = bounds;
				responseDetailsContainer.classList.add('chat-response-flip-reset');
				responseDetailsContainer.classList.remove('chat-response-flip-active');
				responseDetailsContainer.classList.toggle('chat-response-flip-down', e.clientY < bounds.top + bounds.height / 2);
				void responseDetailsContainer.offsetWidth;
				responseDetailsContainer.classList.remove('chat-response-flip-reset');
				void responseDetailsContainer.offsetWidth;
				responseDetailsContainer.classList.add('chat-response-flip-active');
			}));
			listeners.add(dom.addDisposableListener(responseDetailsContainer, dom.EventType.MOUSE_MOVE, e => {
				if (responseTimingBounds && (e.clientX < responseTimingBounds.left || e.clientX > responseTimingBounds.right || e.clientY < responseTimingBounds.top || e.clientY > responseTimingBounds.bottom)) {
					responseTimingBounds = undefined;
					responseDetailsContainer.classList.remove('chat-response-flip-active');
				}
			}));
			listeners.add(dom.addDisposableListener(responseDetailsContainer, dom.EventType.MOUSE_LEAVE, () => {
				responseTimingBounds = undefined;
				responseDetailsContainer.classList.remove('chat-response-flip-active');
			}));
			listeners.add(dom.addDisposableListener(responseDetailsContainer, dom.EventType.FOCUS, () => {
				responseDetailsContainer.classList.remove('chat-response-flip-active', 'chat-response-flip-down');
			}));
		};

		ChatContextKeys.responseHasError.bindTo(templateData.contextKeyService).set(isResponseVM(element) && !!element.errorDetails);
		const isFiltered = !!(isResponseVM(element) && element.errorDetails?.responseIsFiltered);
		ChatContextKeys.responseIsFiltered.bindTo(templateData.contextKeyService).set(isFiltered);

		const location = this.chatWidgetService.getWidgetBySessionResource(element.sessionResource)?.location;
		templateData.rowContainer.classList.toggle('editing-session', location === ChatAgentLocation.Chat);
		templateData.rowContainer.classList.toggle('interactive-request', isRequestVM(element));
		templateData.rowContainer.classList.toggle('interactive-response', isResponseVM(element));
		templateData.rowContainer.classList.toggle('chat-system-notification-response', rendersInlineSystemNotificationTiming);
		const progressMessageAtBottomOfResponse = checkModeOption(this.delegate.currentChatMode(), this.rendererOptions.progressMessageAtBottomOfResponse);
		templateData.rowContainer.classList.toggle('show-detail-progress', isResponseVM(element) && !element.isComplete && !element.progressMessages.length && !progressMessageAtBottomOfResponse);
		templateData.rowContainer.classList.toggle('chat-progress-reservable', isResponseVM(element) && !element.isComplete && !!progressMessageAtBottomOfResponse);

		const updateContainerCheckmarks = () => templateData.rowContainer.classList.toggle('show-checkmarks', !!this.configService.getValue<boolean>(AccessibilityWorkbenchSettingId.ShowChatCheckmarks));
		updateContainerCheckmarks();
		const updateVerboseDetails = () => templateData.rowContainer.classList.toggle('show-verbose-details', !!this.configService.getValue<boolean>(ChatConfiguration.Verbose));
		updateVerboseDetails();
		templateData.elementDisposables.add(this.configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AccessibilityWorkbenchSettingId.ShowChatCheckmarks)) {
				updateContainerCheckmarks();
			}
			if (e.affectsConfiguration(ChatConfiguration.Verbose)) {
				updateVerboseDetails();
				updateResponseDetails();
			}
			if (e.affectsConfiguration(ChatConfiguration.CollapseCompletedResponses) && isResponseVM(element)) {
				this.updateCompletedResponseDisclosure(element, templateData.renderedContent ?? [], templateData, false);
			}
		}));

		if (!this.rendererOptions.noHeader) {
			this.renderAvatar(element, templateData);
		}

		const isSystemInitiatedRequest = isRequestVM(element) && !!element.isSystemInitiated;

		templateData.username.textContent = element.username;
		const hideChatUserIdentity = shouldHideChatUserIdentity(element.username, element.sessionResource, isResponseVM(element), isSystemInitiatedRequest);
		templateData.username.classList.toggle('hidden', hideChatUserIdentity);
		templateData.avatarContainer.classList.toggle('hidden', hideChatUserIdentity);

		this.hoverHidden(templateData.requestHover);
		dom.clearNode(templateData.detail);
		dom.clearNode(templateData.requestTimestampContainer);
		dom.clearNode(templateData.requestActionsContainer);
		templateData.requestActionsContainer.classList.add('hidden');
		if (isResponseVM(element)) {
			this.renderDetail(element, templateData);
		}

		templateData.checkpointToolbar.context = element;
		const supportsForkOrRestoration = this.rendererOptions.supportsFork || (this.rendererOptions.restorable ?? true);
		const checkpointEnabled = this.configService.getValue<boolean>(ChatConfiguration.CheckpointsEnabled)
			&& supportsForkOrRestoration;
		const isPendingRequest = isRequestVM(element) && !!element.pendingKind;
		const isStickyScrollRow = !!dom.findParentWithClass(templateData.rowContainer, 'monaco-tree-sticky-row');

		templateData.checkpointContainer.classList.toggle('hidden', isStickyScrollRow || isResponseVM(element) || isPendingRequest || isSystemInitiatedRequest || !(checkpointEnabled));

		templateData.footerToolbar.refresh();
		templateData.checkpointToolbar.refresh();
		templateData.checkpointRestoreToolbar.refresh();

		if (isResponseVM(element)) {
			this.responseTemplateDataByRequestId.set(element.requestId, templateData);
			templateData.elementDisposables.add(toDisposable(() => this.responseTemplateDataByRequestId.delete(element.requestId)));
		}

		if (!isPendingRequest) {
			const setGroupHover = (hovered: boolean) => {
				const requestId = isRequestVM(element) ? element.id : isResponseVM(element) ? element.requestId : undefined;
				if (!requestId) {
					return;
				}
				const reqData = this.templateDataByRequestId.get(requestId);
				const resData = this.responseTemplateDataByRequestId.get(requestId);
				reqData?.rowContainer.classList.toggle('group-hovered', hovered);
				reqData?.checkpointContainer.classList.toggle('group-hovered', hovered);
				resData?.rowContainer.classList.toggle('group-hovered', hovered);
			};
			const hoverTargets = isResponseVM(element)
				? [templateData.value, templateData.footerToolbarContainer]
				: [templateData.rowContainer];
			const isHoverTarget = (target: EventTarget | null) => dom.isHTMLElement(target) && hoverTargets.some(hoverTarget => hoverTarget.contains(target));
			for (const hoverTarget of hoverTargets) {
				templateData.elementDisposables.add(dom.addDisposableListener(hoverTarget, dom.EventType.MOUSE_ENTER, () => setGroupHover(true)));
				templateData.elementDisposables.add(dom.addDisposableListener(hoverTarget, dom.EventType.MOUSE_LEAVE, e => {
					if (!isHoverTarget(e.relatedTarget)) {
						setGroupHover(false);
					}
				}));
			}
			templateData.elementDisposables.add(toDisposable(() => setGroupHover(false)));
		}

		const shouldShowRestore = !isStickyScrollRow && this.viewModel?.model.checkpoint && !this.viewModel?.editing && (index === this.delegate.getListLength() - 1) && !isPendingRequest;
		templateData.checkpointRestoreContainer.classList.toggle('hidden', !(shouldShowRestore && checkpointEnabled));

		const editing = !isStickyScrollRow && element.id === this.viewModel?.editing?.id;
		const isInput = this.configService.getValue<string>('chat.editRequests') === 'input';

		templateData.elementDisposables.add(autorun(r => {
			const shouldBeBlocked = element.shouldBeBlocked.read(r);
			templateData.disabledOverlay.classList.toggle('disabled', shouldBeBlocked && !editing && this.viewModel?.editing !== undefined);
		}));
		templateData.rowContainer.classList.toggle('editing', editing && !isInput);
		templateData.rowContainer.classList.toggle('editing-input', editing && isInput);
		templateData.requestHover.classList.toggle('editing', editing && isInput);
		templateData.requestHover.classList.toggle('hidden', (!!this.viewModel?.editing && !editing) || isResponseVM(element) || !this.rendererOptions.editable || isSystemInitiatedRequest);
		templateData.requestHover.classList.toggle('expanded', this.configService.getValue<string>('chat.editRequests') === 'hover');
		templateData.requestHover.classList.toggle('checkpoints-enabled', checkpointEnabled);
		templateData.elementDisposables.add(dom.addStandardDisposableListener(templateData.rowContainer, dom.EventType.CLICK, (e) => {
			const current = templateData.currentElement;
			if (current && this.viewModel?.editing && current.id !== this.viewModel.editing.id) {
				e?.stopPropagation();
				e?.preventDefault();
				this._onDidFocusOutside.fire();
			}
		}));


		const rowRoot = templateData.rowContainer.parentElement?.parentElement?.parentElement;
		rowRoot?.classList.toggle('request', isRequestVM(element));
		rowRoot?.classList.toggle('response', isResponseVM(element));
		templateData.rowContainer.classList.toggle(mostRecentResponseClassName, index === this.delegate.getListLength() - 1);
		templateData.rowContainer.classList.toggle('confirmation-message', isRequestVM(element) && !!element.confirmation);

		const isStickyScrollTargetItem = getStickyScrollTargetItem(this.viewModel?.getItems() ?? []) === element;

		const shouldShowHeader = (isResponseVM(element) && !this.rendererOptions.noHeader) && !isSystemInitiatedRequest && !hideChatUserIdentity;
		templateData.header?.classList.toggle('header-disabled', !shouldShowHeader);
		if (isResponseVM(element) && hideChatUserIdentity) {
			templateData.header?.classList.add('hidden');
		} else {
			templateData.header?.classList.remove('hidden');
		}

		if (isRequestVM(element) && element.confirmation) {
			this.renderConfirmationAction(element, templateData);
		}

		const incrementalRendering = this.configService.getValue<boolean>(ChatConfiguration.IncrementalRendering);
		if (isResponseVM(element) && isStickyScrollTargetItem && (!element.isComplete || element.renderData)) {
			this.traceLayout('renderElement', `start progressive render, index=${index}`);

			if (incrementalRendering && !element.renderData) {
				this.logIncrementalRenderingTelemetry();
				this.doIncrementalRender(element, index, templateData);
			} else {
				const timer = templateData.elementDisposables.add(new dom.WindowIntervalTimer());
				const runProgressiveRender = (initial?: boolean) => {
					try {
						if (this.doNextProgressiveRender(element, index, templateData, !!initial)) {
							timer.cancel();
						}
					} catch (err) {
						timer.cancel();
						this.logService.error(err as any);
					}
				};
				timer.cancelAndSet(runProgressiveRender, 50, dom.getWindow(templateData.rowContainer));
				runProgressiveRender(true);
			}
		} else {
			if (isResponseVM(element)) {
				if (incrementalRendering) {
					const rate = this.getProgressiveRenderRate(element);
					this._updateMorpherRate(templateData, rate, true);
				}
				this.renderChatResponseBasic(element, index, templateData);
			} else if (isRequestVM(element)) {
				this.renderChatRequest(element, index, templateData);
				this.updateStickyScrollSourceRange(element, templateData);
			}
		}
		updateResponseDetails();
		templateData.renderedPartsMounted = true;
	}

	private renderPendingDivider(element: IChatPendingDividerViewModel, templateData: IChatListItemTemplate): void {
		templateData.rowContainer.classList.add('pending-item');
		templateData.rowContainer.classList.add('pending-divider');
		templateData.rowContainer.classList.remove('interactive-request', 'interactive-response', 'pending-request');

		templateData.avatarContainer.classList.add('hidden');
		templateData.username.classList.add('hidden');
		templateData.requestHover.classList.add('hidden');
		templateData.checkpointContainer.classList.add('hidden');
		templateData.checkpointRestoreContainer.classList.add('hidden');
		templateData.footerToolbar.getElement().classList.add('hidden');
		if (templateData.titleToolbar) {
			templateData.titleToolbar.getElement().classList.add('hidden');
		}

		dom.clearNode(templateData.value);
		dom.clearNode(templateData.detail);
		dom.clearNode(templateData.requestTimestampContainer);

		const dividerContent = dom.$('.pending-divider-content');
		const label = dom.append(dividerContent, dom.$('span.pending-divider-label'));

		if (element.dividerKind === ChatRequestQueueKind.Steering) {
			if (element.isSystemInitiated) {
				label.textContent = localize('systemNotificationDivider', "System Notification");
				label.title = localize('systemNotificationDividerTooltip', "System notification will be sent after the next tool call happens");
			} else {
				label.textContent = localize('steeringDivider', "Steering");
				label.title = localize('steeringDividerTooltip', "Steering message will be sent after the next tool call happens");
			}
		} else {
			label.textContent = localize('queuedDivider', "Queued");
			label.title = localize('queuedDividerTooltip', "Queued messages will be sent after the current request completes");
		}

		templateData.value.appendChild(dividerContent);
	}

	private renderDetail(element: IChatResponseViewModel, templateData: IChatListItemTemplate): void {
		dom.clearNode(templateData.detail);

		if (element.agentOrSlashCommandDetected) {
			const msg = element.slashCommand ? localize('usedAgentSlashCommand', "used {0} [[(rerun without)]]", `${chatSubcommandLeader}${element.slashCommand.name}`) : localize('usedAgent', "[[(rerun without)]]");
			dom.reset(templateData.detail, renderFormattedText(msg, {
				actionHandler: {
					disposables: templateData.elementDisposables,
					callback: (content) => {
						this._onDidClickRerunWithAgentOrCommandDetection.fire(element);
					},
				}
			}, $('span.agentOrSlashCommandDetected')));

		} else if (this.rendererOptions.renderStyle !== 'minimal' && !element.isComplete && !checkModeOption(this.delegate.currentChatMode(), this.rendererOptions.progressMessageAtBottomOfResponse)) {
			templateData.detail.textContent = localize('working', "Working");
		}
	}

	private renderConfirmationAction(element: IChatRequestViewModel, templateData: IChatListItemTemplate) {
		dom.clearNode(templateData.detail);
		if (element.confirmation) {
			dom.append(templateData.detail, $('span.codicon.codicon-check', { 'aria-hidden': 'true' }));
			dom.append(templateData.detail, $('span.confirmation-text', undefined, localize('chatConfirmationAction', 'Selected "{0}"', element.confirmation)));
			templateData.header?.classList.remove('header-disabled');
			templateData.header?.classList.add('partially-disabled');
		}
	}

	private renderAvatar(element: ChatTreeItem, templateData: IChatListItemTemplate): void {
		if (isPendingDividerVM(element)) {
			return;
		}
		let icon: URI | ThemeIcon;
		if (isResponseVM(element)) {
			icon = this.getAgentIcon(element.agent?.metadata);
		} else if (isRequestVM(element)) {
			icon = element.avatarIcon ?? Codicon.account;
		} else {
			icon = Codicon.account;
		}
		if (icon instanceof URI) {
			const avatarIcon = dom.$<HTMLImageElement>('img.icon');
			avatarIcon.src = FileAccess.uriToBrowserUri(icon).toString(true);
			templateData.avatarContainer.replaceChildren(dom.$('.avatar', undefined, avatarIcon));
		} else {
			const avatarIcon = dom.$(ThemeIcon.asCSSSelector(templateData.rowContainer.classList.contains('interactive-item-compact') ? getCompactCodicon(icon) : icon));
			templateData.avatarContainer.replaceChildren(dom.$('.avatar.codicon-avatar', undefined, avatarIcon));
		}
	}

	private getAgentIcon(agent: IChatAgentMetadata | undefined): URI | ThemeIcon {
		if (agent?.themeIcon) {
			return agent.themeIcon;
		} else if (agent?.iconDark && isDark(this.themeService.getColorTheme().type)) {
			return agent.iconDark;
		} else if (agent?.icon) {
			return agent.icon;
		} else {
			return Codicon.chatSparkle;
		}
	}

	private renderChatResponseBasic(element: IChatResponseViewModel, index: number, templateData: IChatListItemTemplate) {
		templateData.rowContainer.classList.toggle('chat-response-loading', (isResponseVM(element) && !element.isComplete));

		this.finalizeCompletedResponseParts(element, templateData);
		templateData.requestActionsContainer.classList.add('hidden');
		dom.clearNode(templateData.requestActionsContainer);

		const content: IChatRendererContent[] = [];
		const isFiltered = !!element.errorDetails?.responseIsFiltered;
		if (!isFiltered) {
			content.push({ kind: 'references', references: element.contentReferences });
			const responseContent = annotateSpecialMarkdownContent(element.response.value);
			content.push(...(element.isComplete ? moveResponseOutcomeToolsAfterFinalResponse(responseContent) : responseContent));
			if (element.codeCitations.length) {
				content.push({ kind: 'codeCitations', citations: element.codeCitations });
			}
		}

		if (element.model.response === element.model.entireResponse && !element.isCanceled && element.errorDetails?.message && element.errorDetails.message !== canceledName) {
			content.push({ kind: 'errorDetails', errorDetails: element.errorDetails, isLast: getStickyScrollTargetItem(this.viewModel?.getItems() ?? []) === element });
		}

		const fileChangesSummaryPart = this.getChatFileChangesSummaryPart(element);
		if (fileChangesSummaryPart) {
			content.push(fileChangesSummaryPart);
		}

		const turnPillsPart = this.getChatTurnPillsPart(element);
		if (turnPillsPart) {
			content.push(turnPillsPart);
		}

		const workingProgress = this.shouldShowWorkingProgress(element, content, false, templateData);
		if (workingProgress) {
			content.push(workingProgress);
		}

		const diff = this.diff(templateData.renderedParts ?? [], content, element);
		this.renderChatContentDiff(diff, content, element, index, templateData);
		this.finalizeCompletedResponseParts(element, templateData);
	}

	private finalizeCompletedResponseParts(element: IChatResponseViewModel, templateData: IChatListItemTemplate): void {
		if (!element.isComplete && !element.isCanceled) {
			return;
		}
		const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
		if (lastThinking?.domNode && lastThinking.getIsActive()) {
			lastThinking.finalizeTitleIfDefault();
			lastThinking.markAsInactive();
		}
		this.finalizeAllSubagentParts(templateData, true);
	}

	private shouldShowWorkingProgress(element: IChatResponseViewModel, partsToRender: IChatRendererContent[], moreContentAvailable: boolean, templateData: IChatListItemTemplate): IChatWorkingProgress | undefined {
		if (element.agentOrSlashCommandDetected || this.rendererOptions.renderStyle === 'minimal' || element.isComplete || !checkModeOption(this.delegate.currentChatMode(), this.rendererOptions.progressMessageAtBottomOfResponse)) {
			return undefined;
		}

		if (partsToRender.some(part => part.kind === 'planReview' && !part.isUsed)) {
			return undefined;
		}

		if (endsWithActiveSubagentContent(partsToRender)) {
			return undefined;
		}

		if (isResponseVM(element)) {
			const widget = this.chatWidgetService.getWidgetBySessionResource(element.sessionResource);
			if (widget?.inputPart.hasActiveToolConfirmationCarousel) {
				const nonSubagentConfirmationCount = this.getPendingToolConfirmationCount(partsToRender, false);
				if (nonSubagentConfirmationCount > 0) {
					return {
						kind: 'working',
						content: new MarkdownString().appendText(this.getConfirmationPendingLabel(nonSubagentConfirmationCount))
					};
				}

				if (this.getPendingToolConfirmationCount(partsToRender, true) > 0) {
					return undefined;
				}

				return {
					kind: 'working',
					content: new MarkdownString().appendText(this.getConfirmationPendingLabel(1))
				};
			}
		}

		if (isWaitingForMcpServers(partsToRender)) {
			return undefined;
		}

		const workingParts = getWorkingProgressRelevantParts(partsToRender);
		const lastPart = findLastMeaningfulPart(workingParts);
		const endsWithCompletedQuestion = endsWithCompletedQuestionInteraction(workingParts);

		if (workingParts.some(part => part.kind === 'toolInvocation' && IChatToolInvocation.isStreaming(part))) {
			return undefined;
		}

		if (workingParts.some(part => part.kind === 'toolInvocation' && !IChatToolInvocation.isComplete(part) && isMcpToolInvocation(part))) {
			return undefined;
		}

		const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
		if (lastThinking && !endsWithCompletedQuestion) {
			return undefined;
		}

		if (lastPart && (lastPart.kind === 'toolInvocation' || lastPart.kind === 'toolInvocationSerialized')) {
			if (lastPart.isAttachedToThinking) {
				return undefined;
			}

			const isEffectivelyHiddenToolInvocation = IChatToolInvocation.isEffectivelyHidden(lastPart);
			const collapsedToolsMode = this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools');
			if (!isEffectivelyHiddenToolInvocation && collapsedToolsMode !== CollapsedToolsDisplayMode.Off && this.shouldPinPart(lastPart, isResponseVM(element) ? element : undefined)) {
				return undefined;
			}
		}

		const hasRenderedThinkingPart = (templateData.renderedParts ?? []).some(part => part instanceof ChatThinkingContentPart);
		const hasEditPillMarkdown = workingParts.some(part => part.kind === 'markdownContent' && this.hasEditCodeblockUri(part));
		if (hasRenderedThinkingPart && hasEditPillMarkdown) {
			return undefined;
		}

		if (
			!lastPart ||
			lastPart.kind === 'references' ||
			(lastPart.kind === 'markdownContent' && !moreContentAvailable && this.hasBeenCaughtUpLongEnough(element)) ||
			((lastPart.kind === 'toolInvocation' || lastPart.kind === 'toolInvocationSerialized') && (IChatToolInvocation.isComplete(lastPart) || IChatToolInvocation.isEffectivelyHidden(lastPart))) ||
			((lastPart.kind === 'textEditGroup' || lastPart.kind === 'notebookEditGroup') && lastPart.done && !workingParts.some(part => part.kind === 'toolInvocation' && !IChatToolInvocation.isComplete(part))) ||
			(lastPart.kind === 'externalEdit' && !workingParts.some(part => part.kind === 'toolInvocation' && !IChatToolInvocation.isComplete(part))) ||
			(lastPart.kind === 'progressTask' && lastPart.deferred.isSettled) ||
			endsWithCompletedQuestion ||
			lastPart.kind === 'mcpServersStarting' ||
			lastPart.kind === 'mcpAuthenticationRequired' ||
			lastPart.kind === 'mcpServersStartingSlow' ||
			lastPart.kind === 'disabledClaudeHooks' ||
			lastPart.kind === 'hook'
		) {
			return { kind: 'working' };
		}

		return undefined;
	}

	private getPendingToolConfirmationCount(parts: ReadonlyArray<IChatRendererContent | IChatProgressResponseContent>, includeSubagentConfirmations: boolean): number {
		return parts.filter(part => {
			if (part.kind !== 'toolInvocation') {
				return false;
			}

			const state = part.state.get();
			return state.type === IChatToolInvocation.StateKind.WaitingForConfirmation &&
				!!state.confirmationMessages?.title &&
				part.presentation !== 'hidden' &&
				part.source.type !== 'mcp' &&
				(isSubagentToolInvocation(part) === includeSubagentConfirmations);
		}).length;
	}

	private getConfirmationPendingLabel(count: number): string {
		return count === 1 ?
			localize('confirmationPending', "1 confirmation pending") :
			localize('confirmationsPending', "{0} confirmations pending", count);
	}

	private removeWorkingProgressContentPart(templateData: IChatListItemTemplate): void {
		const renderedParts = templateData.renderedParts;
		if (!renderedParts) {
			return;
		}

		for (let i = renderedParts.length - 1; i >= 0; i--) {
			const part = renderedParts[i];
			if (part instanceof ChatWorkingProgressContentPart) {
				part.dispose();
				part.domNode?.remove();
				renderedParts.splice(i, 1);
				this.fireItemHeightChange(templateData);
				return;
			}
		}
	}

	private updateWorkingProgressForPendingConfirmations(templateData: IChatListItemTemplate): void {
		const originalElement = templateData.currentElement;
		queueMicrotask(() => {
			if (templateData.currentElement !== originalElement) {
				return;
			}
			this.doUpdateWorkingProgressForPendingConfirmations(templateData);
		});
	}

	private doUpdateWorkingProgressForPendingConfirmations(templateData: IChatListItemTemplate): void {
		const element = templateData.currentElement;
		if (!isResponseVM(element)) {
			return;
		}

		const pendingConfirmationCount = this.getPendingToolConfirmationCount(element.response.value, false);
		if (pendingConfirmationCount === 0) {
			this.removeWorkingProgressContentPart(templateData);
			return;
		}

		const workingProgressPart = this.getWorkingProgressContentPart(templateData);
		if (workingProgressPart) {
			workingProgressPart.updateWorkingContent(new MarkdownString().appendText(this.getConfirmationPendingLabel(pendingConfirmationCount)));
		}
	}

	private getWorkingProgressContentPart(templateData: IChatListItemTemplate): ChatWorkingProgressContentPart | undefined {
		const renderedParts = templateData.renderedParts;
		if (!renderedParts) {
			return undefined;
		}

		for (let i = renderedParts.length - 1; i >= 0; i--) {
			const part = renderedParts[i];
			if (part instanceof ChatWorkingProgressContentPart) {
				return part;
			}
		}

		return undefined;
	}

	private createUpdateWorkingProgressOnConfirmationEnd(toolInvocation: IChatToolInvocation, templateData: IChatListItemTemplate): IDisposable | undefined {
		if (this.workingProgressConfirmationEndListeners.has(toolInvocation)) {
			return undefined;
		}

		this.workingProgressConfirmationEndListeners.add(toolInvocation);
		let wasWaitingForConfirmation = false;
		const disposable = autorun(reader => {
			const currentState = toolInvocation.state.read(reader);
			const isWaitingForConfirmation = currentState.type === IChatToolInvocation.StateKind.WaitingForConfirmation;
			if (wasWaitingForConfirmation && !isWaitingForConfirmation) {
				this.updateWorkingProgressForPendingConfirmations(templateData);
				this.workingProgressConfirmationEndListeners.delete(toolInvocation);
				disposable.dispose();
			}
			wasWaitingForConfirmation = isWaitingForConfirmation;
		});

		return toDisposable(() => {
			this.workingProgressConfirmationEndListeners.delete(toolInvocation);
			disposable.dispose();
		});
	}

	private hasBeenCaughtUpLongEnough(element: IChatResponseViewModel): boolean {
		const lastRenderTime = element.renderData?.lastRenderTime;
		if (typeof lastRenderTime !== 'number' || lastRenderTime === 0) {
			return false;
		}
		return (Date.now() - lastRenderTime) >= WORKING_CAUGHT_UP_DEBOUNCE_MS;
	}

	private isWorkingProgressDebouncePending(element: IChatResponseViewModel, partsToRender: readonly IChatRendererContent[]): boolean {
		if (element.isComplete) {
			return false;
		}
		if (partsToRender.some(part => part.kind === 'working')) {
			return false;
		}
		return findLastMeaningfulPart(getWorkingProgressRelevantParts(partsToRender))?.kind === 'markdownContent' && !this.hasBeenCaughtUpLongEnough(element);
	}

	private getChatFileChangesSummaryPart(element: IChatResponseViewModel): IChatChangesSummaryPart | undefined {
		if (this.shouldShowPillsSummary(element) || !this.shouldShowFileChangesSummary(element)) {
			return undefined;
		}
		if (!element.model.entireResponse.value.some(part => part.kind === 'textEditGroup' || part.kind === 'notebookEditGroup')) {
			return undefined;
		}

		return { kind: 'changesSummary', requestId: element.requestId, sessionResource: element.sessionResource };
	}

	private getChatTurnPillsPart(element: IChatResponseViewModel): IChatTurnPillsPart | undefined {
		if (!this.shouldShowPillsSummary(element)) {
			return undefined;
		}
		return {
			kind: 'turnPills',
			requestId: element.requestId,
			sessionResource: element.sessionResource,
			isLastTurn: element.session.model.lastRequest?.id === element.requestId,
		};
	}

	private renderChatRequest(element: IChatRequestViewModel, index: number, templateData: IChatListItemTemplate) {
		templateData.stickyScrollSource = undefined;
		templateData.rowContainer.classList.toggle('chat-response-loading', false);
		templateData.rowContainer.classList.toggle('pending-request', !!element.pendingKind);
		templateData.rowContainer.classList.toggle('system-initiated-request', !!element.isSystemInitiated);
		templateData.rowContainer.classList.toggle('terminal-command-request', !element.isSystemInitiated && element.isTerminalCommand);

		if (element.isSystemInitiated) {
			this.renderSystemInitiatedRequest(element, templateData);
			return;
		}

		if (element.pendingKind && this._pendingDragController) {
			templateData.rowContainer.dataset.pendingRequestId = element.id;
			templateData.rowContainer.dataset.pendingKind = element.pendingKind;

			const sameKindCount = (this.viewModel?.model.getPendingRequests() ?? []).filter(p => p.kind === element.pendingKind).length;
			if (sameKindCount > 1) {
				const handle = dom.$('.chat-pending-drag-handle' + ThemeIcon.asCSSSelector(Codicon.gripper));
				templateData.rowContainer.prepend(handle);
				templateData.dragHandle = handle;
				this._pendingDragController.attachDragHandle(element, handle, templateData.rowContainer, templateData.elementDisposables);
			}
		}

		const isStickyScrollRow = !!dom.findParentWithClass(templateData.rowContainer, 'monaco-tree-sticky-row');
		if (element.id === this.viewModel?.editing?.id && !isStickyScrollRow) {
			this._onDidRerender.fire(templateData);
		}

		if (this.configService.getValue<string>('chat.editRequests') !== 'none' && this.rendererOptions.editable) {
			templateData.elementDisposables.add(dom.addDisposableListener(templateData.rowContainer, dom.EventType.KEY_DOWN, e => {
				const ev = new StandardKeyboardEvent(e);
				if (ev.equals(KeyCode.Space) || ev.equals(KeyCode.Enter)) {
					if (this.viewModel?.editing?.id !== element.id) {
						ev.preventDefault();
						ev.stopPropagation();
						this._onDidClickRequest.fire(templateData);
					}
				}
			}));
		}

		let content: IChatRendererContent[] = [];
		const explicitFileOrImageVariables = element.variables.filter(isExplicitFileOrImageVariableEntry);
		const explicitImageVariables = explicitFileOrImageVariables.filter(variable => variable.kind === 'image');
		const explicitFileOrDirectoryVariables = element.variables.filter(variable => variable.kind === 'file' || variable.kind === 'directory' || isPasteVariableEntry(variable));
		const otherVariables = element.variables.filter(variable => !isExplicitFileOrImageVariableEntry(variable) && !isPasteVariableEntry(variable));
		const isStickyAndEditing = !element.confirmation && isStickyScrollRow && element.id === this.viewModel?.editing?.id;
		if (!element.confirmation && !isStickyAndEditing) {
			const requestMarkdown = this.getRequestMarkdown(element, explicitFileOrImageVariables);
			if (requestMarkdown) {
				content = [{ content: new MarkdownString(requestMarkdown), kind: 'markdownContent' }];
			}

			if (this.rendererOptions.renderStyle === 'minimal' && !element.isComplete) {
				templateData.value.classList.add('inline-progress');
				templateData.elementDisposables.add(toDisposable(() => templateData.value.classList.remove('inline-progress')));
				content.push({ content: new MarkdownString('<span></span>', { supportHtml: true }), kind: 'markdownContent' });
			} else {
				templateData.value.classList.remove('inline-progress');
			}
		}

		dom.clearNode(templateData.value);
		if (!isStickyScrollRow && element.origin) {
			const requestOriginPart = this.instantiationService.createInstance(ChatRequestOriginPart, element.sessionResource, element.origin);
			templateData.value.appendChild(requestOriginPart.domNode);
			templateData.elementDisposables.add(requestOriginPart);
		}
		const parts: IChatContentPart[] = [];
		if (!isStickyScrollRow) {
			const explicitImageAttachmentsPart = explicitImageVariables.length ? this.renderAttachments(explicitImageVariables, element.contentReferences, element.modelId, templateData, element.resolvedModelId) : undefined;
			if (explicitImageAttachmentsPart?.domNode) {
				explicitImageAttachmentsPart.domNode.classList.add('chat-request-attachment-cards', 'chat-request-image-attachments');
				templateData.value.appendChild(explicitImageAttachmentsPart.domNode);
				templateData.elementDisposables.add(explicitImageAttachmentsPart);
			}
			const explicitFileAttachmentsPart = explicitFileOrDirectoryVariables.length ? this.renderAttachments(explicitFileOrDirectoryVariables, element.contentReferences, element.modelId, templateData) : undefined;
			if (explicitFileAttachmentsPart?.domNode) {
				explicitFileAttachmentsPart.domNode.classList.add('chat-request-attachment-cards', 'chat-request-file-attachments');
				explicitFileAttachmentsPart.domNode.style.display = 'flex';
				explicitFileAttachmentsPart.domNode.style.flexDirection = 'column';
				explicitFileAttachmentsPart.domNode.style.alignItems = 'flex-end';
				explicitFileAttachmentsPart.domNode.style.flexWrap = 'nowrap';
				templateData.value.appendChild(explicitFileAttachmentsPart.domNode);
				templateData.elementDisposables.add(explicitFileAttachmentsPart);
			}
			if (otherVariables.length) {
				const otherAttachmentsPart = this.renderAttachments(otherVariables, element.contentReferences, element.modelId, templateData);
				if (otherAttachmentsPart.domNode) {
					templateData.value.appendChild(otherAttachmentsPart.domNode);
				}
				templateData.elementDisposables.add(otherAttachmentsPart);
			}
		}
		const contentContainer = templateData.value;

		if (isStickyAndEditing) {
			const store = new DisposableStore();
			templateData.elementDisposables.add(store);

			const editingText = this.delegate.getEditingValue?.() || '';
			const editingTextContent = dom.$('span', undefined, editingText);

			const container = dom.$('.rendered-markdown');
			const innerContent = dom.$('.chat-request-text');
			innerContent.classList.add('sticky-editing');
			innerContent.appendChild(editingTextContent);
			container.appendChild(innerContent);

			if (this.rendererOptions.renderStyle === 'minimal' && !element.isComplete) {
				templateData.value.classList.add('inline-progress');
				templateData.elementDisposables.add(toDisposable(() => templateData.value.classList.remove('inline-progress')));
				container.appendChild(dom.$('span'));
			} else {
				templateData.value.classList.remove('inline-progress');
			}

			container.tabIndex = 0;
			if (this.configService.getValue<string>('chat.editRequests') === 'inline' && this.rendererOptions.editable) {
				container.classList.add('clickable');
				store.add(dom.addDisposableListener(container, dom.EventType.CLICK, (e: MouseEvent) => {
					if (this.viewModel?.editing?.id === element.id) {
						return;
					}

					const selection = dom.getWindow(templateData.rowContainer).getSelection();
					if (selection && !selection.isCollapsed && selection.toString().length > 0) {
						return;
					}

					e?.preventDefault();
					e?.stopPropagation();
					this._onDidClickRequest.fire(templateData);
				}));
				store.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), container, localize('requestMarkdownPartTitle', "Click to Edit"), { trapFocus: true }));
			}
			store.add(dom.addDisposableListener(container, dom.EventType.FOCUS, () => {
				this.hoverVisible(templateData.requestHover);
			}));
			store.add(dom.addDisposableListener(container, dom.EventType.BLUR, () => {
				this.hoverHidden(templateData.requestHover);
			}));

			contentContainer.appendChild(container);
			templateData.stickyScrollSource = container;
			const editingTextPart: IChatContentPart = {
				domNode: container,
				hasSameContent: other => other.kind === 'markdownContent',
				dispose: () => store.dispose(),
				addDisposable: disposable => store.add(disposable),
			};
			parts.push(editingTextPart);
		}

		let inlineSlashCommandRendered = false;
		let codeBlockStartIndex = 0;
		content.forEach((data, contentIndex) => {
			const context: IChatContentPartRenderContext = {
				element,
				elementIndex: index,
				contentIndex: contentIndex,
				content: content,
				container: templateData.rowContainer,
				editorPool: this._editorPool,
				diffEditorPool: this._diffEditorPool,
				currentWidth: this._currentLayoutWidth,
				onDidChangeVisibility: this._onDidChangeVisibility.event,
				inlineTextModels: this._inlineTextModels,
				codeBlockStartIndex,
				treeStartIndex: 0,
			};
			const newPart = this.renderChatContentPart(data, templateData, context);
			if (newPart) {
				if (data.kind === 'markdownContent' && newPart.domNode) {
					templateData.stickyScrollSource ??= newPart.domNode;
				}
				if (isStickyScrollRow && data.kind === 'markdownContent' && newPart.domNode) {
					const firstBlock = newPart.domNode.firstElementChild;
					newPart.domNode.classList.toggle('chat-request-has-more', !!firstBlock?.nextElementSibling);
				}

				if (!isStickyScrollRow
					&& this.rendererOptions.renderDetectedCommandsWithRequest
					&& !inlineSlashCommandRendered
					&& element.agentOrSlashCommandDetected && element.slashCommand
					&& data.kind === 'markdownContent'
				) {
					if (newPart.domNode) {
						newPart.domNode.style.display = 'inline-flex';
					}
					const cmdPart = this.instantiationService.createInstance(ChatAgentCommandContentPart, element.slashCommand, () => this._onDidClickRerunWithAgentOrCommandDetection.fire({ sessionResource: element.sessionResource, requestId: element.id }));
					contentContainer.appendChild(cmdPart.domNode);
					parts.push(cmdPart);
					inlineSlashCommandRendered = true;
				}

				if (newPart.domNode && !newPart.domNode.parentElement) {
					contentContainer.appendChild(newPart.domNode);
				}
				parts.push(newPart);
				codeBlockStartIndex += newPart.codeblocks?.length ?? 0;
			}
		});

		if (templateData.renderedParts) {
			dispose(templateData.renderedParts);
		}
		templateData.renderedParts = parts;
		if (isStickyScrollRow && this.stickyScrollTemplateDataByRequestId.get(element.id) !== templateData) {
			this.stickyScrollTemplateDataByRequestId.set(element.id, templateData);
			templateData.elementDisposables.add(toDisposable(() => {
				if (this.stickyScrollTemplateDataByRequestId.get(element.id) === templateData) {
					this.stickyScrollTemplateDataByRequestId.delete(element.id);
				}
			}));
		}
		const stickyScrollSourcePart = parts.find(part => part.domNode === templateData.stickyScrollSource);
		if (stickyScrollSourcePart?.addDisposable && templateData.stickyScrollSource?.classList.contains('clickable')) {
			stickyScrollSourcePart.addDisposable(this.registerSynchronizedRequestBubbleHover(element.id, templateData, templateData.stickyScrollSource));
		}

		dom.clearNode(templateData.requestActionsContainer);
		if (!isStickyScrollRow && !element.isSystemInitiated) {
			templateData.requestActionsContainer.classList.remove('hidden');
			const copyBtn = dom.append(templateData.requestActionsContainer, dom.$('a.chat-request-copy-button', {
				'role': 'button',
				'aria-label': localize('interactive.copyItem.ariaLabel', "Copy"),
				'title': localize('interactive.copyItem.ariaLabel', "Copy"),
				'tabindex': '0',
			}));
			const iconContainer = dom.append(copyBtn, dom.$('.chat-copy-action-icons'));
			const copyIcon = dom.append(iconContainer, dom.$('.chat-copy-action-icon.chat-copy-action-icon-copy'));
			copyIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.copy));
			copyIcon.setAttribute('aria-hidden', 'true');

			const copiedIcon = dom.append(iconContainer, dom.$('.chat-copy-action-icon.chat-copy-action-icon-copied'));
			copiedIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
			copiedIcon.setAttribute('aria-hidden', 'true');

			let copyResetTimer: any;
			const onTriggerCopy = async (e?: { preventDefault(): void; stopPropagation(): void }) => {
				e?.preventDefault();
				e?.stopPropagation();
				const textToCopy = element.messageText || (typeof element.message === 'string' ? element.message : (element.message as any)?.text || '');
				if (textToCopy && this.clipboardService) {
					await this.clipboardService.writeText(textToCopy);
					copyBtn.classList.add('copied');
					copyBtn.title = localize('interactive.copyItem.copied', "Copied");
					copyBtn.setAttribute('aria-label', localize('interactive.copyItem.copiedAriaLabel', "Copied"));
					status(localize('interactive.copyItem.status', "Copied to clipboard"));

					if (copyResetTimer) {
						clearTimeout(copyResetTimer);
					}
					copyResetTimer = setTimeout(() => {
						copyBtn.classList.remove('copied');
						copyBtn.title = localize('interactive.copyItem.ariaLabel', "Copy");
						copyBtn.setAttribute('aria-label', localize('interactive.copyItem.ariaLabel', "Copy"));
					}, 1200);
				}
			};

			templateData.elementDisposables.add(dom.addDisposableListener(copyBtn, dom.EventType.CLICK, onTriggerCopy));
			templateData.elementDisposables.add(dom.addStandardDisposableListener(copyBtn, dom.EventType.KEY_DOWN, (e) => {
				if (e.keyCode === KeyCode.Enter || e.keyCode === KeyCode.Space) {
					onTriggerCopy(e);
				}
			}));
			templateData.elementDisposables.add(toDisposable(() => {
				if (copyResetTimer) {
					clearTimeout(copyResetTimer);
				}
			}));
		} else {
			templateData.requestActionsContainer.classList.add('hidden');
		}

		if (!isStickyScrollRow && !element.pendingKind && !element.confirmation && this.rendererOptions.renderStyle !== 'minimal' && templateData.value.childElementCount > 0) {
			const timestamp = renderChatRequestTimestamp(templateData.requestTimestampContainer, element.requestTimestamp);
			if (timestamp?.hoverText) {
				templateData.elementDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), timestamp.element, timestamp.hoverText));
			} else if (timestamp) {
				let requestTimingBounds: DOMRect | undefined;
				templateData.elementDisposables.add(dom.addDisposableListener(timestamp.element, dom.EventType.MOUSE_OVER, e => {
					const target = dom.isHTMLElement(e.target) ? e.target.closest('.chat-request-relative') : undefined;
					if (!dom.isHTMLElement(target) || !timestamp.element.contains(target)) {
						return;
					}
					const bounds = target.getBoundingClientRect();
					requestTimingBounds = bounds;
					timestamp.element.classList.add('chat-request-flip-reset');
					timestamp.element.classList.remove('chat-request-flip-active');
					timestamp.element.classList.toggle('chat-request-flip-down', e.clientY < bounds.top + bounds.height / 2);
					void timestamp.element.offsetWidth;
					timestamp.element.classList.remove('chat-request-flip-reset');
					void timestamp.element.offsetWidth;
					timestamp.element.classList.add('chat-request-flip-active');
				}));
				templateData.elementDisposables.add(dom.addDisposableListener(timestamp.element, dom.EventType.MOUSE_MOVE, e => {
					if (requestTimingBounds && (e.clientX < requestTimingBounds.left || e.clientX > requestTimingBounds.right || e.clientY < requestTimingBounds.top || e.clientY > requestTimingBounds.bottom)) {
						requestTimingBounds = undefined;
						timestamp.element.classList.remove('chat-request-flip-active');
					}
				}));
				templateData.elementDisposables.add(dom.addDisposableListener(timestamp.element, dom.EventType.MOUSE_LEAVE, () => {
					requestTimingBounds = undefined;
					timestamp.element.classList.remove('chat-request-flip-active');
				}));
				templateData.elementDisposables.add(dom.addDisposableListener(timestamp.element, dom.EventType.FOCUS, () => {
					timestamp.element.classList.remove('chat-request-flip-active', 'chat-request-flip-down');
				}));
			}
		}
	}

	private getRequestMarkdown(element: IChatRequestViewModel, explicitFileOrImageVariables = element.variables.filter(isExplicitFileOrImageVariableEntry)): string | undefined {
		const markdown = isChatFollowup(element.message)
			? element.message.message
			: this.markdownDecorationsRenderer.convertParsedRequestToMarkdown(element.sessionResource, element.message);
		const attachmentSummary = !element.messageText.trim() && !explicitFileOrImageVariables.length
			? getExplicitFileOrImageAttachmentSummary(element.variables)
			: undefined;
		return markdown.trim() ? markdown : attachmentSummary;
	}

	private requestHasStickyScrollContent(element: IChatRequestViewModel): boolean {
		const isEditing = element.id === this.viewModel?.editing?.id;
		const editingValue = isEditing ? this.delegate.getEditingValue?.() ?? '' : undefined;
		const contentKey = isEditing ? `editing:${editingValue}` : element.dataId;
		const cached = this.stickyScrollRequestContentById.get(element.id);
		if (cached?.contentKey === contentKey) {
			return cached.hasContent;
		}

		const hasContent = isEditing ? !!editingValue?.trim() : !!this.getRequestMarkdown(element)?.trim();
		this.stickyScrollRequestContentById.set(element.id, { contentKey, hasContent });
		this.stickyScrollSourceWidthRatioByRequestId.delete(element.id);
		this.stickyScrollSourceRangesByRequestId.delete(element.id);
		return hasContent;
	}

	private updateStickyScrollSourceRange(element: IChatRequestViewModel, templateData: IChatListItemTemplate): void {
		if (!this.delegate.isStickyScrollEnabled()
			|| templateData.currentElement !== element) {
			return;
		}

		const stickyScrollRow = dom.findParentWithClass(templateData.rowContainer, 'monaco-tree-sticky-row');
		const isStickyScrollRow = !!stickyScrollRow;
		const requestBubble = templateData.stickyScrollSource;
		if (!requestBubble?.textContent?.trim()) {
			this.rejectStickyScrollSourceRange(element.id, isStickyScrollRow);
			return;
		}
		if (isStickyScrollRow && !templateData.rowContainer.isConnected) {
			templateData.elementDisposables.add(dom.scheduleAtNextAnimationFrame(dom.getWindow(templateData.rowContainer), () => {
				if (templateData.currentElement === element && templateData.rowContainer.isConnected) {
					this.updateStickyScrollSourceRange(element, templateData);
				}
			}));
			return;
		}
		if (isStickyScrollRow) {
			this.updateStickyScrollRequestWidth(element.id, requestBubble);
		}

		const requestBounds = requestBubble.getBoundingClientRect();
		if (isStickyScrollRow) {
			const stickyRowBounds = stickyScrollRow.getBoundingClientRect();
			const visibleWidth = Math.min(requestBounds.right, stickyRowBounds.right) - Math.max(requestBounds.left, stickyRowBounds.left);
			const visibleHeight = Math.min(requestBounds.bottom, stickyRowBounds.bottom) - Math.max(requestBounds.top, stickyRowBounds.top);
			if (visibleHeight <= 0 || visibleWidth <= 0) {
				this.rejectStickyScrollSourceRange(element.id, true);
				return;
			}

			const previousRange = this.stickyScrollSourceRangesByRequestId.get(element.id);
			const stickyNodeHeight = this.delegate.stickyScrollTopPadding + requestBounds.height;
			if (!previousRange || previousRange.stickyNodeHeight !== stickyNodeHeight) {
				this.stickyScrollSourceRangesByRequestId.set(element.id, {
					start: previousRange?.start ?? 0,
					end: previousRange?.end ?? this.delegate.stickyScrollTopPadding + requestBounds.height,
					stickyNodeHeight,
				});
				this.scheduleStickyScrollStateRefresh();
			}
			return;
		}

		this.updateStickyScrollSourceWidthRatio(element.id, requestBubble, requestBounds.width);
		const rowBounds = templateData.rowContainer.getBoundingClientRect();
		const start = Math.max(0, requestBounds.top - rowBounds.top - this.delegate.stickyScrollTopPadding);
		const end = requestBounds.bottom - rowBounds.top;
		if (requestBounds.height <= 0 || end <= start) {
			return;
		}

		const stickyNodeHeight = this.stickyScrollSourceRangesByRequestId.get(element.id)?.stickyNodeHeight;
		this.stickyScrollSourceRangesByRequestId.set(element.id, { start, end, stickyNodeHeight });
	}

	private updateStickyScrollRequestWidth(requestId: string, requestBubble: HTMLElement): void {
		const widthRatio = this.stickyScrollSourceWidthRatioByRequestId.get(requestId);
		if (widthRatio !== undefined) {
			if (this.appliedStickyScrollWidthRatioByBubble.get(requestBubble) !== widthRatio) {
				requestBubble.style.boxSizing = 'border-box';
				requestBubble.style.width = `${widthRatio * 100}%`;
				requestBubble.style.maxWidth = 'none';
				this.appliedStickyScrollWidthRatioByBubble.set(requestBubble, widthRatio);
			}
		} else if (this.appliedStickyScrollWidthRatioByBubble.delete(requestBubble)) {
			requestBubble.style.removeProperty('box-sizing');
			requestBubble.style.removeProperty('width');
			requestBubble.style.removeProperty('max-width');
		}
	}

	private updateStickyScrollSourceWidthRatio(requestId: string, requestBubble: HTMLElement, requestWidth: number): void {
		const requestParentWidth = requestBubble.parentElement?.getBoundingClientRect().width;
		if (requestWidth > 0 && requestParentWidth && requestParentWidth > 0) {
			this.stickyScrollSourceWidthRatioByRequestId.set(requestId, requestWidth / requestParentWidth);
		} else {
			this.stickyScrollSourceWidthRatioByRequestId.delete(requestId);
		}
	}

	private registerSynchronizedRequestBubbleHover(requestId: string, templateData: IChatListItemTemplate, requestBubble: HTMLElement): IDisposable {
		const disposables = new DisposableStore();
		const setHovered = (hovered: boolean) => {
			if (hovered) {
				this.hoveredRequestBubbleByRequestId.set(requestId, requestBubble);
			} else if (this.hoveredRequestBubbleByRequestId.get(requestId) === requestBubble) {
				this.hoveredRequestBubbleByRequestId.delete(requestId);
			} else {
				return;
			}
			this.updateSynchronizedRequestBubbleHover(requestId);
		};
		disposables.add(dom.addDisposableListener(requestBubble, dom.EventType.MOUSE_ENTER, () => setHovered(true)));
		disposables.add(dom.addDisposableListener(requestBubble, dom.EventType.MOUSE_LEAVE, () => setHovered(false)));
		if (requestBubble.matches(':hover')) {
			setHovered(true);
		} else {
			this.updateSynchronizedRequestBubbleHover(requestId);
		}
		disposables.add(toDisposable(() => {
			setHovered(false);
			templateData.rowContainer.classList.remove('request-bubble-hovered');
		}));
		return disposables;
	}

	private updateSynchronizedRequestBubbleHover(requestId: string): void {
		const hovered = this.hoveredRequestBubbleByRequestId.has(requestId);
		this.templateDataByRequestId.get(requestId)?.rowContainer.classList.toggle('request-bubble-hovered', hovered);
		this.stickyScrollTemplateDataByRequestId.get(requestId)?.rowContainer.classList.toggle('request-bubble-hovered', hovered);
	}

	private rejectStickyScrollSourceRange(requestId: string, refreshStickyScroll: boolean): void {
		const alreadyRejected = this.stickyScrollSourceRangesByRequestId.get(requestId) === null;
		this.stickyScrollSourceRangesByRequestId.set(requestId, null);
		if (refreshStickyScroll && !alreadyRejected) {
			this.scheduleStickyScrollStateRefresh();
		}
	}

	private scheduleStickyScrollSourceRangeRefresh(): void {
		if (!this.delegate.isStickyScrollEnabled()) {
			return;
		}

		this.pendingStickyScrollSourceRangeRefresh.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(this.delegate.container), () => {
			this.refreshStickyScrollSourceRanges();
			this.delegate.refreshStickyScroll();
		});
	}

	private scheduleStickyScrollStateRefresh(): void {
		this.pendingStickyScrollStateRefresh.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(this.delegate.container), () => {
			this.delegate.refreshStickyScroll();
		});
	}

	private renderSystemInitiatedRequest(element: IChatRequestViewModel, templateData: IChatListItemTemplate) {
		dom.clearNode(templateData.value);
		if (templateData.renderedParts) {
			dispose(templateData.renderedParts);
		}
		templateData.renderedParts = [];

		const agentMerge = element.systemInitiatedLabel === undefined ? parseAgentMergePrompt(element.messageText) : undefined;
		if (agentMerge) {
			const agentMergePart = this.instantiationService.createInstance(ChatAgentMergeContentPart, agentMerge, element.sessionResource, this.chatContentMarkdownRenderer, element.requestTimestamp);
			templateData.elementDisposables.add(agentMergePart);
			templateData.value.appendChild(agentMergePart.domNode);
			return;
		}

		const label = element.systemInitiatedLabel ?? element.messageText;
		const notificationPart = this.instantiationService.createInstance(
			ChatSystemNotificationContentPart,
			{ kind: 'systemNotification', content: new MarkdownString(label) },
			this.chatContentMarkdownRenderer,
		);
		templateData.elementDisposables.add(notificationPart);
		templateData.value.appendChild(notificationPart.domNode);
	}

	private doIncrementalRender(element: IChatResponseViewModel, index: number, templateData: IChatListItemTemplate): void {
		if (!this._isVisible) {
			return;
		}

		const rate = this.getProgressiveRenderRate(element);
		this._updateMorpherRate(templateData, rate, element.isComplete || element.isCanceled);

		if (element.isCanceled || element.isComplete) {
			element.renderData = undefined;
			templateData.rowContainer.classList.toggle('chat-response-loading', false);
			this.renderChatResponseBasic(element, index, templateData);
			return;
		}

		templateData.rowContainer.classList.toggle('chat-response-loading', true);

		const contentForThisTurn = this.getNextProgressiveRenderContent(element, templateData);
		const partsToRender = this.diff(templateData.renderedParts ?? [], contentForThisTurn.content, element);
		const contentIsAlreadyRendered = partsToRender.every(part => part === null);
		if (!contentIsAlreadyRendered) {
			this.renderChatContentDiff(partsToRender, contentForThisTurn.content, element, index, templateData);
		}
	}

	private _updateMorpherRate(templateData: IChatListItemTemplate, rate: number, isComplete: boolean): void {
		const renderedParts = templateData.renderedParts;
		if (!renderedParts) {
			return;
		}
		for (const part of renderedParts) {
			if (part instanceof ChatMarkdownContentPart) {
				part.updateStreamRate(rate, isComplete);
			}
		}
	}

	private logIncrementalRenderingTelemetry(): void {
		if (this._incrementalRenderingTelemetryLogged) {
			return;
		}
		this._incrementalRenderingTelemetryLogged = true;

		type IncrementalRenderingSettingsEvent = {
			animationStyle: string;
			buffering: string;
		};
		type IncrementalRenderingSettingsClassification = {
			animationStyle: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The animation style selected for incremental rendering.' };
			buffering: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The buffering mode selected for incremental rendering.' };
			owner: 'pwang347';
			comment: 'Tracks which incremental rendering settings are in use.';
		};
		this.telemetryService.publicLog2<IncrementalRenderingSettingsEvent, IncrementalRenderingSettingsClassification>('chatIncrementalRenderingSettings', {
			animationStyle: this.configService.getValue<string>(ChatConfiguration.IncrementalRenderingStyle) ?? 'none',
			buffering: this.configService.getValue<string>(ChatConfiguration.IncrementalRenderingBuffering) ?? 'word',
		});
	}

	private doNextProgressiveRender(element: IChatResponseViewModel, index: number, templateData: IChatListItemTemplate, isInRenderElement: boolean): boolean {
		if (!this._isVisible) {
			return true;
		}

		if (element.isCanceled) {
			this.traceLayout('doNextProgressiveRender', `canceled, index=${index}`);
			element.renderData = undefined;
			this.renderChatResponseBasic(element, index, templateData);
			return true;
		}

		templateData.rowContainer.classList.toggle('chat-response-loading', true);
		this.traceLayout('doNextProgressiveRender', `START progressive render, index=${index}`);
		const contentForThisTurn = this.getNextProgressiveRenderContent(element, templateData);
		const partsToRender = this.diff(templateData.renderedParts ?? [], contentForThisTurn.content, element);

		const contentIsAlreadyRendered = partsToRender.every(part => part === null);
		if (contentIsAlreadyRendered) {
			if (contentForThisTurn.moreContentAvailable) {
				this.traceLayout('doNextProgressiveRender', 'not rendering any new content this tick, but more available');
				return false;
			} else if (element.isComplete) {
				this.traceLayout('doNextProgressiveRender', `END progressive render, index=${index} and clearing renderData, response is complete`);
				element.renderData = undefined;
				this.renderChatResponseBasic(element, index, templateData);
				return true;
			} else if (this.isWorkingProgressDebouncePending(element, contentForThisTurn.content)) {
				return false;
			} else {
				return true;
			}
		}

		this.traceLayout('doNextProgressiveRender', `doing progressive render, ${partsToRender.length} parts to render`);
		this.renderChatContentDiff(partsToRender, contentForThisTurn.content, element, index, templateData);

		return false;
	}

	private renderChatContentDiff(partsToRender: ReadonlyArray<IChatRendererContent | null>, contentForThisTurn: ReadonlyArray<IChatRendererContent>, element: IChatResponseViewModel, elementIndex: number, templateData: IChatListItemTemplate): void {
		const renderedParts = templateData.renderedParts ?? [];
		templateData.renderedParts = renderedParts;
		templateData.renderedContent = contentForThisTurn;
		const batchedSubagentParts = new Set<ChatSubagentContentPart>();
		let codeBlockStartIndex = 0;
		let treeStartIndex = 0;
		let displacedWorkingPart: ChatWorkingProgressContentPart | undefined;
		const renderParts = () => partsToRender.forEach((partToRender, contentIndex) => {
			if (contentIndex > 0) {
				const prevPart = renderedParts[contentIndex - 1];
				if (prevPart) {
					codeBlockStartIndex += prevPart.codeblocks?.length ?? 0;
					if (prevPart instanceof ChatTreeContentPart) {
						treeStartIndex++;
					}
				}
			}

			const alreadyRenderedPart = templateData.renderedParts?.[contentIndex];

			if (!partToRender) {
				if (!templateData.renderedPartsMounted) {
					alreadyRenderedPart?.onDidRemount?.();
				}
				return;
			}

			if (partToRender.kind === 'working' && displacedWorkingPart?.hasSameContent(partToRender, contentForThisTurn.slice(contentIndex + 1), element)) {
				renderedParts[contentIndex] = displacedWorkingPart;
				displacedWorkingPart = undefined;
				return;
			}

			const preserveWorkingPart = alreadyRenderedPart instanceof ChatWorkingProgressContentPart
				&& partToRender.kind !== 'working'
				&& contentForThisTurn.slice(contentIndex + 1).some(part => part.kind === 'working');
			if (alreadyRenderedPart) {
				if (partToRender.kind === 'thinking' && alreadyRenderedPart instanceof ChatThinkingContentPart) {
					if (!Array.isArray(partToRender.value)) {
						alreadyRenderedPart.updateThinking(partToRender);
					}
					renderedParts[contentIndex] = alreadyRenderedPart;
					return;
				} else if (alreadyRenderedPart instanceof ChatThinkingContentPart && this.shouldPinPart(partToRender, element)) {
					renderedParts[contentIndex] = alreadyRenderedPart;
					return;
				}

				if (partToRender.kind === 'markdownContent'
					&& alreadyRenderedPart instanceof ChatMarkdownContentPart
					&& this.configService.getValue<boolean>(ChatConfiguration.IncrementalRendering)
				) {
					if (alreadyRenderedPart.tryIncrementalUpdate(partToRender)) {
						renderedParts[contentIndex] = alreadyRenderedPart;
						return;
					}
				}

				if (preserveWorkingPart) {
					displacedWorkingPart = alreadyRenderedPart;
				} else {
					alreadyRenderedPart.dispose();
				}

				if (alreadyRenderedPart.domNode) {
					const thinkingToolWrapper = dom.findParentWithClass(alreadyRenderedPart.domNode, 'chat-thinking-tool-wrapper');
					if (thinkingToolWrapper) {
						thinkingToolWrapper.replaceWith(alreadyRenderedPart.domNode);
					}
				}
			}

			const context: IChatContentPartRenderContext = {
				element,
				elementIndex: elementIndex,
				content: contentForThisTurn,
				contentIndex: contentIndex,
				container: templateData.rowContainer,
				editorPool: this._editorPool,
				diffEditorPool: this._diffEditorPool,
				currentWidth: this._currentLayoutWidth,
				onDidChangeVisibility: this._onDidChangeVisibility.event,
				inlineTextModels: this._inlineTextModels,
				codeBlockStartIndex,
				treeStartIndex,
			};

			const lastThinking = this.getLastThinkingPart(renderedParts);
			if (lastThinking && (partToRender.kind === 'toolInvocation' || partToRender.kind === 'toolInvocationSerialized' || partToRender.kind === 'markdownContent' || partToRender.kind === 'textEditGroup' || partToRender.kind === 'externalEdit' || partToRender.kind === 'hook') && this.shouldPinPart(partToRender, element)) {
				if (alreadyRenderedPart instanceof ChatMarkdownContentPart) {
					lastThinking.removeEditPillByPartId(alreadyRenderedPart.codeblocksPartId);
				}

				const newPart = this.renderChatContentPart(partToRender, templateData, context, batchedSubagentParts);
				if (newPart) {
					renderedParts[contentIndex] = newPart;
					alreadyRenderedPart?.domNode?.remove();
				}
				return;
			}

			const newPart = this.renderChatContentPart(partToRender, templateData, context, batchedSubagentParts);
			if (newPart) {
				renderedParts[contentIndex] = newPart;
				try {
					if (alreadyRenderedPart?.domNode) {
						if (newPart.domNode) {
							if (preserveWorkingPart) {
								alreadyRenderedPart.domNode.before(newPart.domNode);
							} else {
								alreadyRenderedPart.domNode.replaceWith(newPart.domNode);
							}
						} else {
							if (!preserveWorkingPart) {
								alreadyRenderedPart.domNode.remove();
							}
						}
					} else if (newPart.domNode && !newPart.domNode.parentElement) {
						templateData.value.appendChild(newPart.domNode);
					}

				} catch (err) {
					this.logService.error('ChatListItemRenderer#renderChatContentDiff: error replacing part', err);
				}
			} else {
				alreadyRenderedPart?.domNode?.remove();
			}
		});
		try {
			renderParts();
		} finally {
			for (const subagentPart of batchedSubagentParts) {
				try {
					subagentPart.endToolPresentationBatch();
				} catch (error) {
					this.logService.error('ChatListItemRenderer#renderChatContentDiff: error flushing subagent presentation', error);
				}
			}
		}
		displacedWorkingPart?.dispose();
		displacedWorkingPart?.domNode?.remove();

		for (let i = partsToRender.length; i < renderedParts.length; i++) {
			const part = renderedParts[i];
			if (part) {
				part.dispose();
				part.domNode?.remove();
				delete renderedParts[i];
			}
		}

		const animateCollapse = templateData.wasResponseComplete === false && element.isComplete;
		this.updateCompletedResponseDisclosure(element, contentForThisTurn, templateData, animateCollapse);
		templateData.wasResponseComplete = element.isComplete;
	}

	private updateCompletedResponseDisclosure(element: IChatResponseViewModel, content: ReadonlyArray<IChatRendererContent>, templateData: IChatListItemTemplate, animateCollapse: boolean): void {
		if (!element.isComplete || !this.configService.getValue<boolean>(ChatConfiguration.CollapseCompletedResponses)) {
			this.removeCompletedResponseDisclosure(templateData);
			templateData.completedResponseDisclosureOpen = undefined;
			return;
		}

		const responseContent = annotateSpecialMarkdownContent(element.response.value);
		const responseFinalStartIndex = getFinalResponseStartIndexAfterMovingResponseOutcomeTools(responseContent);
		const finalResponseStartIndex = responseFinalStartIndex === undefined ? undefined : responseFinalStartIndex + 1;
		if (finalResponseStartIndex === undefined || !isFinalResponseRendered(content, finalResponseStartIndex) || finalResponseStartIndex === 0 || !content.slice(0, finalResponseStartIndex).some(part => part.kind !== 'references' || part.references.length > 0)) {
			this.removeCompletedResponseDisclosure(templateData);
			return;
		}
		const finalResponsePart = templateData.renderedParts?.[finalResponseStartIndex];
		if (!(finalResponsePart instanceof ChatMarkdownContentPart) || !finalResponsePart.isRenderComplete) {
			this.removeCompletedResponseDisclosure(templateData);
			if (finalResponsePart instanceof ChatMarkdownContentPart) {
				templateData.completedResponseDisclosureDisposables.add(Event.once(finalResponsePart.onDidFinishRendering)(() => {
					this.updateCompletedResponseDisclosure(element, content, templateData, false);
				}));
			}
			return;
		}

		const collapseEndIndex = getCompletedResponseCollapseEndIndex(content, finalResponseStartIndex);
		if (collapseEndIndex === 0) {
			this.removeCompletedResponseDisclosure(templateData);
			return;
		}
		const workspaceTransitionIndex = content.findIndex(part => part.kind === 'systemNotification' && part.presentation === 'workspaceTransition');
		const collapseStartIndex = workspaceTransitionIndex >= 0 && workspaceTransitionIndex < collapseEndIndex
			? workspaceTransitionIndex + 1
			: 0;

		const collapseEndNode = templateData.renderedParts?.[collapseEndIndex]?.domNode;
		if (!collapseEndNode) {
			this.removeCompletedResponseDisclosure(templateData);
			return;
		}

		let existingDisclosure = templateData.completedResponseDisclosure;
		if (existingDisclosure?.contains(collapseEndNode)) {
			this.removeCompletedResponseDisclosure(templateData);
			existingDisclosure = undefined;
		}

		let collapseEndRoot = collapseEndNode;
		while (collapseEndRoot.parentElement && collapseEndRoot.parentElement !== templateData.value) {
			collapseEndRoot = collapseEndRoot.parentElement;
		}
		if (collapseEndRoot.parentElement !== templateData.value) {
			this.removeCompletedResponseDisclosure(templateData);
			return;
		}

		if (existingDisclosure
			&& templateData.completedResponseCollapseStartIndex === collapseStartIndex
			&& templateData.completedResponseCollapseEndIndex === collapseEndIndex
			&& existingDisclosure.nextSibling === collapseEndRoot
			&& templateData.renderedParts?.slice(collapseStartIndex, collapseEndIndex).every(part => !part?.domNode || existingDisclosure.contains(part.domNode))
		) {
			return;
		}

		this.removeCompletedResponseDisclosure(templateData);
		const valueChildren = Array.from(templateData.value.childNodes);
		const collapseEndChildIndex = valueChildren.indexOf(collapseEndRoot);
		let collapseStartChildIndex = 0;
		const workspaceTransitionNode = workspaceTransitionIndex >= 0 ? templateData.renderedParts?.[workspaceTransitionIndex]?.domNode : undefined;
		if (workspaceTransitionNode) {
			let workspaceTransitionRoot = workspaceTransitionNode;
			while (workspaceTransitionRoot.parentElement && workspaceTransitionRoot.parentElement !== templateData.value) {
				workspaceTransitionRoot = workspaceTransitionRoot.parentElement;
			}
			const workspaceTransitionChildIndex = valueChildren.indexOf(workspaceTransitionRoot);
			if (workspaceTransitionChildIndex >= 0 && workspaceTransitionChildIndex < collapseEndChildIndex) {
				collapseStartChildIndex = workspaceTransitionChildIndex + 1;
			}
		}
		const nodesToCollapse = valueChildren.slice(collapseStartChildIndex, collapseEndChildIndex);
		const stepCount = getVisibleCompletedResponseItemCount(nodesToCollapse);
		if (stepCount < 2) {
			return;
		}

		const details = document.createElement('details');
		details.classList.add('completed-response-disclosure');
		const summary = details.appendChild(document.createElement('summary'));
		summary.classList.add('completed-response-summary', 'chat-used-context-label');
		const button = summary.appendChild($('span.monaco-button.monaco-text-button.monaco-icon-button'));
		const label = button.appendChild($('span.monaco-button-mdlabel'));
		const chevron = button.appendChild($('span.chat-collapsible-hover-chevron', { 'aria-hidden': 'true' }));
		chevron.classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronRight));
		const disclosureLabel = formatCompletedResponseDisclosureLabel(stepCount, element.model.elapsedMs);
		label.textContent = disclosureLabel;

		const activeElement = dom.getActiveElement();
		const keepOpenForFocus = nodesToCollapse.some(node => node.contains(activeElement));
		const shouldAnimateInitialCollapse = animateCollapse
			&& !keepOpenForFocus
			&& !this.accessibilityService.isMotionReduced()
			&& templateData.completedResponseDisclosureOpen === undefined;
		if (keepOpenForFocus) {
			templateData.completedResponseDisclosureOpen = true;
		}
		details.open = templateData.completedResponseDisclosureOpen ?? shouldAnimateInitialCollapse;
		const updateExpansionState = () => {
			summary.setAttribute('aria-expanded', String(details.open));
			chevron.classList.toggle('expanded', details.open);
		};
		updateExpansionState();

		templateData.value.insertBefore(details, collapseEndRoot);
		details.append(...nodesToCollapse);
		templateData.completedResponseDisclosure = details;
		templateData.completedResponseCollapseStartIndex = collapseStartIndex;
		templateData.completedResponseCollapseEndIndex = collapseEndIndex;
		templateData.completedResponseDisclosureDisposables.add(dom.addDisposableListener(details, 'toggle', () => {
			templateData.completedResponseDisclosureOpen = details.open;
			updateExpansionState();
		}));

		templateData.completedResponseDisclosureDisposables.add(dom.addDisposableListener(summary, dom.EventType.CLICK, () => {
			details.dispatchEvent(new CustomEvent(ChatCollapsibleContentPart.userToggleEvent, { bubbles: true }));
		}));

		if (shouldAnimateInitialCollapse) {
			const targetWindow = dom.getWindow(details);
			const animationFrame = targetWindow.requestAnimationFrame(() => {
				if (templateData.completedResponseDisclosure === details && details.open) {
					details.open = false;
				}
			});
			templateData.completedResponseDisclosureDisposables.add(toDisposable(() => targetWindow.cancelAnimationFrame(animationFrame)));
		}
	}

	private removeCompletedResponseDisclosure(templateData: IChatListItemTemplate): void {
		templateData.completedResponseDisclosureDisposables.clear();
		const details = templateData.completedResponseDisclosure;
		if (!details) {
			return;
		}

		while (details.childNodes.length > 1) {
			details.before(details.childNodes[1]);
		}
		details.remove();
		templateData.completedResponseDisclosure = undefined;
		templateData.completedResponseCollapseStartIndex = undefined;
		templateData.completedResponseCollapseEndIndex = undefined;
	}

	private getNextProgressiveRenderContent(element: IChatResponseViewModel, templateData: IChatListItemTemplate): { content: IChatRendererContent[]; moreContentAvailable: boolean } {
		const data = this.getDataForProgressiveRender(element);

		const incrementalRendering = this.configService.getValue<boolean>(ChatConfiguration.IncrementalRendering) === true;

		const responseContent = annotateSpecialMarkdownContent(element.response.value);
		const renderableResponse = element.isComplete ? moveResponseOutcomeToolsAfterFinalResponse(responseContent) : responseContent;

		this.traceLayout('getNextProgressiveRenderContent', `Want to render ${data.numWordsToRender} at ${data.rate} words/s, counting...`);
		let numNeededWords = data.numWordsToRender;
		const partsToRender: IChatRendererContent[] = [];

		partsToRender.push({ kind: 'references', references: element.contentReferences });

		let moreContentAvailable = false;
		for (let i = 0; i < renderableResponse.length; i++) {
			const part = renderableResponse[i];
			if (part.kind === 'markdownContent' && !incrementalRendering) {
				const wordCountResult = getNWords(part.content.value, numNeededWords);
				this.traceLayout('getNextProgressiveRenderContent', `  Chunk ${i}: Want to render ${numNeededWords} words and found ${wordCountResult.returnedWordCount} words. Total words in chunk: ${wordCountResult.totalWordCount}`);
				numNeededWords -= wordCountResult.returnedWordCount;

				if (wordCountResult.isFullString) {
					partsToRender.push(part);

					for (const nextPart of renderableResponse.slice(i + 1)) {
						if (nextPart.kind !== 'markdownContent') {
							i++;
							partsToRender.push(nextPart);
						} else {
							break;
						}
					}
				} else {
					moreContentAvailable = true;
					partsToRender.push({ ...part, content: new MarkdownString(wordCountResult.value, part.content) });
				}

				if (numNeededWords <= 0) {
					if (renderableResponse.slice(i + 1).some(part => part.kind === 'markdownContent')) {
						moreContentAvailable = true;
					}
					break;
				}
			} else {
				partsToRender.push(part);
			}
		}

		const lastWordCount = element.contentUpdateTimings?.lastWordCount ?? 0;
		const newRenderedWordCount = data.numWordsToRender - numNeededWords;
		const bufferWords = lastWordCount - newRenderedWordCount;
		this.traceLayout('getNextProgressiveRenderContent', `Want to render ${data.numWordsToRender} words. Rendering ${newRenderedWordCount} words. Buffer: ${bufferWords} words`);
		if (newRenderedWordCount > 0 && newRenderedWordCount !== element.renderData?.renderedWordCount) {
			element.renderData = { lastRenderTime: Date.now(), renderedWordCount: newRenderedWordCount, renderedParts: partsToRender };
		}

		const workingProgress = this.shouldShowWorkingProgress(element, partsToRender, moreContentAvailable, templateData);
		if (workingProgress) {
			partsToRender.push(workingProgress);
		}

		const fileChangesSummaryPart = this.getChatFileChangesSummaryPart(element);
		if (fileChangesSummaryPart) {
			partsToRender.push(fileChangesSummaryPart);
		}

		const turnPillsPart = this.getChatTurnPillsPart(element);
		if (turnPillsPart) {
			partsToRender.push(turnPillsPart);
		}

		return { content: partsToRender, moreContentAvailable };
	}

	private shouldShowFileChangesSummary(element: IChatResponseViewModel): boolean {
		const sessionType = getChatSessionType(element.sessionResource);
		const isLocalSession = sessionType === localChatSessionType;
		return shouldShowFileChangesSummaryForSettings(
			element.isComplete,
			isLocalSession,
			this.configService.getValue<boolean>('chat.checkpoints.showFileChanges'),
		);
	}

	private shouldShowPillsSummary(element: IChatResponseViewModel): boolean {
		return shouldShowTurnPillsSummary(
			element.isComplete,
			false,
		);
	}

	private getDataForProgressiveRender(element: IChatResponseViewModel) {
		const hasMarkdownParts = element.response.value.some(part => part.kind === 'markdownContent' && part.content.value.trim().length > 0);
		if (shouldRenderInitialProgressiveContentImmediately(element.isComplete, hasMarkdownParts, element.renderData !== undefined)) {
			return {
				numWordsToRender: Number.MAX_SAFE_INTEGER,
				rate: Number.MAX_SAFE_INTEGER
			};
		}

		const renderData = element.renderData ?? { lastRenderTime: 0, renderedWordCount: 0 };

		const rate = this.getProgressiveRenderRate(element);
		const numWordsToRender = renderData.lastRenderTime === 0 ?
			1 :
			renderData.renderedWordCount +
			Math.floor((Date.now() - renderData.lastRenderTime) / 1000 * rate);

		return {
			numWordsToRender,
			rate
		};
	}

	private diff(renderedParts: ReadonlyArray<IChatContentPart>, contentToRender: ReadonlyArray<IChatRendererContent>, element: ChatTreeItem): ReadonlyArray<IChatRendererContent | null> {
		const diff: (IChatRendererContent | null)[] = [];
		for (let i = 0; i < contentToRender.length; i++) {
			const content = contentToRender[i];
			const renderedPart = renderedParts[i];

			if (!renderedPart || !renderedPart.hasSameContent(content, contentToRender.slice(i + 1), element)) {
				diff.push(content);
			} else {
				diff.push(null);
			}
		}

		return diff;
	}

	private hasEditCodeblockUri(part: IChatRendererContent): boolean {
		if (part.kind !== 'markdownContent') {
			return false;
		}
		return hasEditCodeblockUriTag(part.content.value);
	}

	private isCodeblockComplete(part: IChatRendererContent, element: ChatTreeItem): boolean {
		if (part.kind !== 'markdownContent') {
			return true;
		}
		return !isResponseVM(element) || element.isComplete || codeblockHasClosingBackticks(part.content.value);
	}

	private shouldPinPart(part: IChatRendererContent, element?: IChatResponseViewModel): boolean {
		const collapsedToolsMode = this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools');

		if (part.kind === 'thinking' || part.kind === 'working') {
			return true;
		}

		if (part.kind === 'undoStop') {
			return true;
		}

		if (part.kind === 'hook') {
			if (part.subAgentInvocationId) {
				return false;
			}
			return part.hookType === HookType.PreToolUse || part.hookType === HookType.PostToolUse;
		}

		if (collapsedToolsMode === CollapsedToolsDisplayMode.Off) {
			return false;
		}

		if (this.hasEditCodeblockUri(part) || part.kind === 'textEditGroup' || part.kind === 'externalEdit') {
			return true;
		}

		const isMcpTool = (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && isMcpToolInvocation(part);
		if (isMcpTool) {
			return false;
		}

		const isMermaidTool = (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && part.toolId.toLowerCase().includes('mermaid');
		if (isMermaidTool) {
			return false;
		}

		const isAskQuestionsTool = (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && isAskQuestionsToolInvocation(part);
		if (isAskQuestionsTool) {
			return false;
		}

		if ((part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && isSubagentToolInvocation(part)) {
			return false;
		}

		if ((part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && (isCreateSessionTool(part.toolId) || isCreateChatTool(part.toolId) || isSendMessageTool(part.toolId))) {
			return false;
		}

		if ((part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized')
			&& (part.toolId === 'image_gen.imagegen' || part.toolSpecificData?.kind === 'generatedImage')) {
			return false;
		}

		const isTerminalTool = (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && part.toolSpecificData?.kind === 'terminal';
		const isContributedTerminalToolInvocation = element
			&& (element.sessionResource.scheme !== Schemas.vscodeChatInput && getChatSessionType(element.sessionResource) !== localChatSessionType)
			&& part.kind === 'toolInvocationSerialized' && part.toolSpecificData?.kind === 'terminal';
		if (isTerminalTool && !isContributedTerminalToolInvocation) {
			if (part.kind === 'toolInvocation' && IChatToolInvocation.getConfirmationMessages(part)) {
				return false;
			}
			const terminalToolsInThinking = this.configService.getValue<boolean>(ChatConfiguration.TerminalToolsInThinking);
			return !!terminalToolsInThinking;
		}

		if (part.kind === 'toolInvocation') {
			const state = part.state.get();
			return shouldPinToolInvocationToThinking(state.type, !!IChatToolInvocation.getConfirmationMessages(part), toolInvocationHasMcpAppData(part));
		}

		if (part.kind === 'toolInvocationSerialized') {
			return !toolInvocationHasMcpAppData(part);
		}

		return false;
	}

	private getLastThinkingPart(renderedParts: ReadonlyArray<IChatContentPart> | undefined): ChatThinkingContentPart | undefined {
		if (!renderedParts || renderedParts.length === 0) {
			return undefined;
		}

		for (let i = renderedParts.length - 1; i >= 0; i--) {
			const part = renderedParts[i];
			if (part instanceof ChatThinkingContentPart && part.getIsActive()) {
				return part;
			}
		}

		return undefined;
	}

	private getLastThinkingPartForGroupedItem(context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): { part: ChatThinkingContentPart | undefined; separatedFromReasoning: boolean } {
		const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
		const displayMode = getEffectiveThinkingDisplayMode(this.configService, this.contextKeyService);
		if (lastThinking?.hasReasoningContent() && shouldStartNewCollapsedThinkingGroup(displayMode, 'reasoning', 'items')) {
			this.finalizeCurrentThinkingPart(context, templateData);
			return { part: undefined, separatedFromReasoning: true };
		}
		return { part: lastThinking, separatedFromReasoning: false };
	}

	private isThinkingLookAheadComplete(context: IChatContentPartRenderContext, element?: IChatResponseViewModel): boolean {
		if (element?.isComplete) {
			return true;
		}

		for (let i = context.contentIndex + 1; i < context.content.length; i++) {
			const nextPart = context.content[i];
			if (!this.shouldPinPart(nextPart, element)) {
				return true;
			}
		}

		return false;
	}

	private getSubagentPart(renderedParts: ReadonlyArray<IChatContentPart> | undefined, subAgentInvocationId?: string): ChatSubagentContentPart | undefined {
		if (!renderedParts || renderedParts.length === 0) {
			return undefined;
		}

		for (let i = renderedParts.length - 1; i >= 0; i--) {
			const part = renderedParts[i];
			if (part instanceof ChatSubagentContentPart) {
				if (subAgentInvocationId && part.subAgentInvocationId === subAgentInvocationId) {
					return part;
				}
				if (!subAgentInvocationId && part.getIsActive()) {
					return part;
				}
			}
		}

		return undefined;
	}

	private finalizeAllSubagentParts(templateData: IChatListItemTemplate, force: boolean = false): void {
		if (!templateData.renderedParts) {
			return;
		}

		for (const part of templateData.renderedParts) {
			if (part instanceof ChatSubagentContentPart && part.getIsActive() && (force || !part.shouldRemainActive()) && (force || !part.hasToolsWaitingForConfirmation)) {
				part.markAsInactive(force);
			}
		}
	}

	private handleSubagentToolGrouping(toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized, subagentId: string, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate, codeBlockStartIndex: number, batchedSubagentParts?: Set<ChatSubagentContentPart>): IChatContentPart {
		this.finalizeCurrentThinkingPart(context, templateData);

		const lastSubagent = this.getSubagentPart(templateData.renderedParts, subagentId);
		if (lastSubagent) {
			this.beginSubagentToolPresentationBatch(lastSubagent, batchedSubagentParts);
			this.maybeRouteSubagentToolToCarousel(toolInvocation, lastSubagent, context, templateData, codeBlockStartIndex);

			if (!isParentSubagentTool(toolInvocation)) {
				lastSubagent.appendToolInvocation(toolInvocation, codeBlockStartIndex);
				return this.renderNoContent(other =>
					(other.kind === 'toolInvocation' || other.kind === 'toolInvocationSerialized')
					&& other.toolCallId === toolInvocation.toolCallId);
			}
			return lastSubagent;
		}

		const subagentPart = this.instantiationService.createInstance(
			ChatSubagentContentPart,
			subagentId,
			toolInvocation,
			context,
			this.chatContentMarkdownRenderer,
			this._contentReferencesListPool,
			this._toolEditorPool,
			() => this._currentLayoutWidth.get(),
			this._announcedToolProgressKeys,
		);
		this.beginSubagentToolPresentationBatch(subagentPart, batchedSubagentParts);
		this.maybeRouteSubagentToolToCarousel(toolInvocation, subagentPart, context, templateData, codeBlockStartIndex);

		if (!isParentSubagentTool(toolInvocation)) {
			subagentPart.appendToolInvocation(toolInvocation, codeBlockStartIndex);
		}

		return subagentPart;
	}

	private beginSubagentToolPresentationBatch(subagentPart: ChatSubagentContentPart, batchedSubagentParts: Set<ChatSubagentContentPart> | undefined): void {
		if (batchedSubagentParts && !batchedSubagentParts.has(subagentPart)) {
			batchedSubagentParts.add(subagentPart);
			subagentPart.beginToolPresentationBatch();
		}
	}

	private maybeRouteSubagentToolToCarousel(
		toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized,
		subagentPart: ChatSubagentContentPart,
		context: IChatContentPartRenderContext,
		templateData: IChatListItemTemplate,
		codeBlockStartIndex: number,
	): void {
		if (!this.configService.getValue<boolean>(ChatConfiguration.ToolConfirmationCarousel)) {
			return;
		}
		if (toolInvocation.kind !== 'toolInvocation' || !isResponseVM(context.element)) {
			return;
		}
		if (isParentSubagentTool(toolInvocation) || toolInvocation.presentation === 'hidden' || toolInvocation.source.type === 'mcp') {
			return;
		}
		if (!!this.viewModel?.editing) {
			return;
		}

		const widget = this.chatWidgetService.getWidgetBySessionResource(context.element.sessionResource);
		if (!widget) {
			return;
		}

		const subAgentInvocationId = subagentPart.subAgentInvocationId;
		const subagentTitle = subagentPart.getSubagentTitle();

		const revealSubagent = (targetSubAgentId: string) => {
			const currentTemplateData = this.getTemplateDataForRequestId(context.element.id);
			const currentSubagentPart = this.getSubagentPart(currentTemplateData?.renderedParts, targetSubAgentId) ?? subagentPart;
			currentSubagentPart.domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
		};
		const revealSubagentLabel = undefined;

		const navigateToCarousel = (targetSubAgentId: string) => {
			widget.inputPart.activateCarouselForSubagent(targetSubAgentId);
		};

		const factory = (tool: IChatToolInvocation) => this.instantiationService.createInstance(
			ChatToolInvocationPart, tool, context,
			this.chatContentMarkdownRenderer, this._contentReferencesListPool,
			this._toolEditorPool, () => this._currentLayoutWidth.get(),
			this._announcedToolProgressKeys,
			codeBlockStartIndex
		);

		const addToolToCarousel = (tool: IChatToolInvocation) => {
			widget.inputPart.addToolToConfirmationCarousel(tool, factory, subAgentInvocationId, subagentTitle, revealSubagent, revealSubagentLabel);
			const listener = this.createUpdateWorkingProgressOnConfirmationEnd(tool, templateData);
			if (listener) {
				templateData.elementDisposables.add(listener);
			}
		};
		const shouldUseCarouselForTool = (tool: IChatToolInvocation, state: IChatToolInvocation.State) =>
			this.configService.getValue<boolean>(ChatConfiguration.ToolConfirmationCarousel) &&
			!this.viewModel?.editing &&
			tool.presentation !== 'hidden' &&
			tool.source.type !== 'mcp' &&
			state.type === IChatToolInvocation.StateKind.WaitingForConfirmation &&
			!!state.confirmationMessages?.title;

		subagentPart.enableCarouselMode(navigateToCarousel, addToolToCarousel, shouldUseCarouselForTool, widget.inputPart.onDidChangeActiveConfirmationSubagent);
		subagentPart.setConfirmationActive(widget.inputPart.activeConfirmationSubagentId === subAgentInvocationId);

		const toolState = toolInvocation.state.get();
		if (toolState.type === IChatToolInvocation.StateKind.WaitingForConfirmation &&
			toolState.confirmationMessages?.title) {
			addToolToCarousel(toolInvocation);
		}
	}

	private finalizeCurrentThinkingPart(context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): void {
		const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
		if (!lastThinking) {
			return;
		}
		const style = getEffectiveThinkingDisplayMode(this.configService, this.contextKeyService);
		if (style === ThinkingDisplayMode.CollapsedPreview) {
			lastThinking.collapseContent();
		}
		lastThinking.finalizeTitleIfDefault();
		lastThinking.resetId();
		lastThinking.markAsInactive();
	}

	private renderChatContentPart(content: IChatRendererContent, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext, batchedSubagentParts?: Set<ChatSubagentContentPart>): IChatContentPart | undefined {
		try {
			if (content.kind === 'thinking' && (Array.isArray(content.value) ? content.value.length === 0 : content.value === '')) {
				const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
				lastThinking?.resetId();
				return this.renderNoContent(other => content.kind === other.kind);
			}

			const isResponseElement = isResponseVM(context.element);
			const shouldPin = this.shouldPinPart(content, isResponseElement ? context.element : undefined);

			if (context.element.isComplete && !shouldPin) {
				const elementTemplateData = this.getTemplateDataForRequestId(context.element.id);
				if (elementTemplateData?.renderedParts) {
					const lastThinking = this.getLastThinkingPart(elementTemplateData.renderedParts);
					if (lastThinking?.getIsActive()) {
						this.finalizeCurrentThinkingPart(context, elementTemplateData);
					}
				}
			}

			const isSubagentContent = (content.kind === 'toolInvocation' || content.kind === 'toolInvocationSerialized')
				&& isSubagentToolInvocation(content);

			if (context.element.isComplete && !isSubagentContent) {
				const elementTemplateData = this.getTemplateDataForRequestId(context.element.id);
				if (elementTemplateData) {
					this.finalizeAllSubagentParts(elementTemplateData);
				}
			}

			if (content.kind === 'treeData') {
				return this.renderTreeData(content, templateData, context);
			} else if (content.kind === 'multiDiffData') {
				return this.renderMultiDiffData(content, templateData, context);
			} else if (content.kind === 'progressMessage') {
				return this.instantiationService.createInstance(ChatProgressContentPart, content, this.chatContentMarkdownRenderer, context, undefined, undefined, undefined, undefined, content.shimmer);
			} else if (content.kind === 'systemNotification') {
				return this.instantiationService.createInstance(ChatSystemNotificationContentPart, content, this.chatContentMarkdownRenderer);
			} else if (content.kind === 'working') {
				return this.instantiationService.createInstance(ChatWorkingProgressContentPart, content, this.chatContentMarkdownRenderer, context);
			} else if (content.kind === 'progressTask' || content.kind === 'progressTaskSerialized') {
				return this.renderProgressTask(content, templateData, context);
			} else if (content.kind === 'command') {
				return this.instantiationService.createInstance(ChatCommandButtonContentPart, content, context);
			} else if (content.kind === 'textEditGroup') {
				return this.renderTextEdit(context, content, templateData);
			} else if (content.kind === 'confirmation') {
				return this.renderConfirmation(context, content, templateData);
			} else if (content.kind === 'warning') {
				return this.instantiationService.createInstance(ChatErrorContentPart, ChatErrorLevel.Warning, content.content, content, this.chatContentMarkdownRenderer);
			} else if (content.kind === 'info') {
				return this.instantiationService.createInstance(ChatErrorContentPart, ChatErrorLevel.Info, content.content, content, this.chatContentMarkdownRenderer);
			} else if (content.kind === 'hook') {
				return this.renderHookPart(content, context, templateData, batchedSubagentParts);
			} else if (content.kind === 'markdownContent') {
				return this.renderMarkdown(content, templateData, context);
			} else if (content.kind === 'references') {
				if (isResponseVM(context.element) && context.element.agent?.isDefault && !context.element.agent.modes.includes(ChatModeKind.Ask)) {
					return this.renderNoContent(other => other.kind === content.kind);
				}
				return this.renderContentReferencesListData(content, undefined, context, templateData);
			} else if (content.kind === 'codeCitations') {
				return this.renderCodeCitations(content, context, templateData);
			} else if (content.kind === 'toolInvocation' || content.kind === 'toolInvocationSerialized') {
				return this.renderToolInvocation(content, context, templateData, batchedSubagentParts);
			} else if (content.kind === 'extensions') {
				return this.renderExtensionsContent(content, context, templateData);
			} else if (content.kind === 'pullRequest') {
				return this.renderPullRequestContent(content, context, templateData);
			} else if (content.kind === 'undoStop') {
				return this.renderUndoStop(content);
			} else if (content.kind === 'errorDetails') {
				return this.renderChatErrorDetails(context, content, templateData);
			} else if (content.kind === 'elicitation2' || content.kind === 'elicitationSerialized') {
				return this.renderElicitation(context, content, templateData);
			} else if (content.kind === 'questionCarousel') {
				return this.renderQuestionCarousel(context, content, templateData);
			} else if (content.kind === 'planReview') {
				return this.renderPlanReview(context, content, templateData);
			} else if (content.kind === 'changesSummary') {
				return this.renderChangesSummary(content, context, templateData);
			} else if (content.kind === 'turnPills') {
				return this.renderTurnPills(content, context);
			} else if (content.kind === 'mcpServersStarting') {
				return this.renderMcpServersInteractionRequired(content, context, templateData);
			} else if (content.kind === 'mcpAuthenticationRequired') {
				return this.instantiationService.createInstance(ChatMcpAuthenticationContentPart, content);
			} else if (content.kind === 'mcpServersStartingSlow') {
				return this.instantiationService.createInstance(ChatMcpServersStartingContentPart, content, {
					onDidFinishStarting: () => this.showWorkingProgressAfterMcp(context, templateData),
				});
			} else if (content.kind === 'disabledClaudeHooks') {
				return this.renderDisabledClaudeHooks(content, context);
			} else if (content.kind === 'thinking') {
				return this.renderThinkingPart(content, context, templateData);
			} else if (content.kind === 'workspaceEdit') {
				return this.instantiationService.createInstance(ChatWorkspaceEditContentPart, content, context, this.chatContentMarkdownRenderer);
			} else if (content.kind === 'externalEdit') {
				return this.renderExternalEdit(content, context, templateData);
			} else if (content.kind === 'autoModeResolution') {
				if (!content.resolved && context.element.isComplete) {
					return this.renderNoContent(other => other.kind === content.kind && !other.resolved);
				}
				return this.instantiationService.createInstance(ChatAutoModeResolutionContentPart, content, context);
			}

			return this.renderNoContent(other => content.kind === other.kind);
		} catch (err) {
			alert(`Chat error: ${toErrorMessage(err, false)}`);
			this.logService.error('ChatListItemRenderer#renderChatContentPart: error rendering content', toErrorMessage(err, true));
			const errorPart = this.instantiationService.createInstance(ChatErrorContentPart, ChatErrorLevel.Error, new MarkdownString(localize('renderFailMsg', "Failed to render content") + `: ${toErrorMessage(err, false)}`), content, this.chatContentMarkdownRenderer);
			return {
				dispose: () => errorPart.dispose(),
				domNode: errorPart.domNode,
				hasSameContent: (other => content.kind === other.kind),
			};
		}
	}

	private showWorkingProgressAfterMcp(context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): void {
		const originalElement = context.element;
		const originalRenderedParts = templateData.renderedParts;
		queueMicrotask(() => {
			if (!isResponseVM(originalElement) || templateData.currentElement !== originalElement || originalElement.isComplete || originalElement.isCanceled) {
				return;
			}

			if (!originalRenderedParts || templateData.renderedParts !== originalRenderedParts || originalRenderedParts.some(part => part instanceof ChatWorkingProgressContentPart)) {
				return;
			}

			this.renderChatResponseBasic(originalElement, context.elementIndex, templateData);
			this.fireItemHeightChange(templateData);
		});
	}

	override dispose(): void {
		this._announcedToolProgressKeys.clear();
		super.dispose();
	}


	private renderChatErrorDetails(context: IChatContentPartRenderContext, content: IChatErrorDetailsPart, templateData: IChatListItemTemplate): IChatContentPart {
		if (!isResponseVM(context.element)) {
			return this.renderNoContent(other => content.kind === other.kind);
		}

		const isLast = content.isLast;
		if (content.errorDetails.isQuotaExceeded) {
			const renderedError = this.instantiationService.createInstance(ChatQuotaExceededPart, context.element, content, this.chatContentMarkdownRenderer);
			return renderedError;
		} else if (content.errorDetails.isRateLimited && this.chatEntitlementService.anonymous) {
			const renderedError = this.instantiationService.createInstance(ChatAnonymousRateLimitedPart, content);
			return renderedError;
		} else if (content.errorDetails.confirmationButtons && isLast) {
			const level = content.errorDetails.level ?? ChatErrorLevel.Error;
			const errorConfirmation = this.instantiationService.createInstance(ChatErrorConfirmationContentPart, level, new MarkdownString(content.errorDetails.message), content, content.errorDetails.confirmationButtons, this.chatContentMarkdownRenderer, context);
			return errorConfirmation;
		} else {
			const level = content.errorDetails.level ?? ChatErrorLevel.Error;
			return this.instantiationService.createInstance(ChatErrorContentPart, level, new MarkdownString(content.errorDetails.message), content, this.chatContentMarkdownRenderer);
		}
	}

	private renderUndoStop(content: IChatUndoStop) {
		return this.renderNoContent(other => other.kind === content.kind && other.id === content.id);
	}

	private renderNoContent(equals: (other: IChatRendererContent, followingContent: IChatRendererContent[], element: ChatTreeItem) => boolean): IChatContentPart {
		return {
			dispose: () => { },
			domNode: undefined,
			hasSameContent: equals,
		};
	}

	private renderTreeData(content: IChatTreeData, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart {
		const data = content.treeData;
		const treePart = this.instantiationService.createInstance(ChatTreeContentPart, data, this._treePool);

		if (isResponseVM(context.element)) {
			const fileTreeFocusInfo = {
				treeDataId: data.uri.toString(),
				treeIndex: context.treeStartIndex,
				focus() {
					treePart.domFocus();
				}
			};

			treePart.addDisposable(treePart.onDidFocus(() => {
				this.focusedFileTreesByResponseId.set(context.element.id, fileTreeFocusInfo.treeIndex);
			}));

			const fileTrees = this.fileTreesByResponseId.get(context.element.id) ?? [];
			fileTrees.push(fileTreeFocusInfo);
			this.fileTreesByResponseId.set(context.element.id, distinct(fileTrees, (v) => v.treeDataId));
			treePart.addDisposable(toDisposable(() => this.fileTreesByResponseId.set(context.element.id, fileTrees.filter(v => v.treeDataId !== data.uri.toString()))));
		}

		return treePart;
	}

	private renderMultiDiffData(content: IChatMultiDiffData | IChatMultiDiffDataSerialized, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart {
		const multiDiffPart = this.instantiationService.createInstance(ChatMultiDiffContentPart, content, context.element);
		return multiDiffPart;
	}

	private renderContentReferencesListData(references: IChatReferences, labelOverride: string | undefined, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): ChatCollapsibleListContentPart {
		const referencesPart = this.instantiationService.createInstance(ChatUsedReferencesListContentPart, references.references, labelOverride, context, this._contentReferencesListPool, { expandedWhenEmptyResponse: checkModeOption(this.delegate.currentChatMode(), this.rendererOptions.referencesExpandedWhenEmptyResponse) });

		return referencesPart;
	}

	private renderCodeCitations(citations: IChatCodeCitations, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): ChatCodeCitationContentPart {
		const citationsPart = this.instantiationService.createInstance(ChatCodeCitationContentPart, citations, context);
		return citationsPart;
	}

	private handleRenderedCodeblocks(element: ChatTreeItem, part: IChatContentPart, codeBlockStartIndex: number): void {
		if (!part.addDisposable || part.codeblocksPartId === undefined) {
			return;
		}

		const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id) ?? [];
		this.codeBlocksByResponseId.set(element.id, codeBlocksByResponseId);
		part.addDisposable(toDisposable(() => {
			const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id);
			if (codeBlocksByResponseId) {
				part.codeblocks?.forEach((info, i) => {
					const codeblock = codeBlocksByResponseId[codeBlockStartIndex + i];
					if (codeblock?.ownerMarkdownPartId === part.codeblocksPartId) {
						delete codeBlocksByResponseId[codeBlockStartIndex + i];
					}
				});
			}
		}));

		part.codeblocks?.forEach((info, i) => {
			codeBlocksByResponseId[codeBlockStartIndex + i] = info;

			const uri = info.uri;
			if (uri) {
				this.codeBlocksByEditorUri.set(uri, info);
				part.addDisposable!(toDisposable(() => {
					const codeblock = this.codeBlocksByEditorUri.get(uri);
					if (codeblock?.ownerMarkdownPartId === part.codeblocksPartId) {
						this.codeBlocksByEditorUri.delete(uri);
					}
				}));
			}
		});

	}

	private renderToolInvocation(toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate, batchedSubagentParts?: Set<ChatSubagentContentPart>): IChatContentPart | undefined {
		if (IChatToolInvocation.isComplete(toolInvocation) && IChatToolInvocation.isEffectivelyHidden(toolInvocation)) {
			const msg = toolInvocation.pastTenseMessage ?? toolInvocation.invocationMessage;
			const text = typeof msg === 'string' ? msg : msg?.value;
			if (!text || text.trim().length === 0) {
				return this.renderNoContent((other) =>
					(other.kind === 'toolInvocation' || other.kind === 'toolInvocationSerialized') && other.toolCallId === toolInvocation.toolCallId);
			}
		}

		if (context.element.isComplete
			&& toolInvocation.toolSpecificData?.kind === 'generatedImage'
			&& !isGeneratedImageResultOwner(toolInvocation, context.content)) {
			return this.renderNoContent(other =>
				(other.kind === 'toolInvocation' || other.kind === 'toolInvocationSerialized')
				&& other.toolCallId === toolInvocation.toolCallId);
		}

		if (this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools') === CollapsedToolsDisplayMode.Off) {
			this.finalizeCurrentThinkingPart(context, templateData);
		}

		const codeBlockStartIndex = context.codeBlockStartIndex;

		let lazilyCreatedPart: ChatToolInvocationPart | undefined = undefined;
		const createToolPart = (): { domNode: HTMLElement; disposable: ChatToolInvocationPart; part: ChatToolInvocationPart } => {
			lazilyCreatedPart = this.instantiationService.createInstance(ChatToolInvocationPart, toolInvocation, context, this.chatContentMarkdownRenderer, this._contentReferencesListPool, this._toolEditorPool, () => this._currentLayoutWidth.get(), this._announcedToolProgressKeys, codeBlockStartIndex);
			lazilyCreatedPart.addDisposable(lazilyCreatedPart.onDidChangeHeight(() => this.fireItemHeightChange(templateData)));
			this.handleRenderedCodeblocks(context.element, lazilyCreatedPart, codeBlockStartIndex);
			return { domNode: lazilyCreatedPart.domNode, disposable: lazilyCreatedPart, part: lazilyCreatedPart };
		};

		const collapsedToolsMode = this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools');
		if (isResponseVM(context.element) && collapsedToolsMode !== CollapsedToolsDisplayMode.Off) {
			const { part: lastThinking, separatedFromReasoning } = this.getLastThinkingPartForGroupedItem(context, templateData);

			if (!lastThinking && !IChatToolInvocation.isEffectivelyHidden(toolInvocation) && this.shouldPinPart(toolInvocation, context.element) && shouldCreateGroupedThinkingPart(collapsedToolsMode, separatedFromReasoning)) {
				const thinkingPart = this.renderThinkingPart({
					kind: 'thinking',
				}, context, templateData);

				if (thinkingPart instanceof ChatThinkingContentPart) {
					toolInvocation.isAttachedToThinking = true;
					thinkingPart.appendItem(createToolPart, toolInvocation.toolId, toolInvocation, templateData.value);
					this.setupConfirmationTransitionWatcher(toolInvocation, thinkingPart, () => lazilyCreatedPart, createToolPart, context, templateData);
				}

				return thinkingPart;
			}

			if (this.shouldPinPart(toolInvocation, context.element)) {
				if (lastThinking && !IChatToolInvocation.isEffectivelyHidden(toolInvocation)) {
					toolInvocation.isAttachedToThinking = true;
					lastThinking.appendItem(createToolPart, toolInvocation.toolId, toolInvocation, templateData.value);
					this.setupConfirmationTransitionWatcher(toolInvocation, lastThinking, () => lazilyCreatedPart, createToolPart, context, templateData);
					return this.renderNoContent((other, followingContent, element) => lazilyCreatedPart ?
						lazilyCreatedPart.hasSameContent(other, followingContent, element) :
						toolInvocation.kind === other.kind);
				}
			} else {
				this.finalizeCurrentThinkingPart(context, templateData);
			}
		}

		const subagentId = getSubagentId(toolInvocation);
		if (subagentId && isResponseVM(context.element) && !IChatToolInvocation.isEffectivelyHidden(toolInvocation)) {
			return this.handleSubagentToolGrouping(toolInvocation, subagentId, context, templateData, codeBlockStartIndex, batchedSubagentParts);
		}

		const { part } = createToolPart();
		if (this.configService.getValue<boolean>(ChatConfiguration.ToolConfirmationCarousel) &&
			toolInvocation.kind === 'toolInvocation' && isResponseVM(context.element) &&
			toolInvocation.source.type !== 'mcp' && !this.viewModel?.editing) {
			const widget = this.chatWidgetService.getWidgetBySessionResource(context.element.sessionResource);
			if (widget) {
				const factory = (tool: IChatToolInvocation) => this.instantiationService.createInstance(
					ChatToolInvocationPart, tool, context,
					this.chatContentMarkdownRenderer, this._contentReferencesListPool,
					this._toolEditorPool, () => this._currentLayoutWidth.get(),
					this._announcedToolProgressKeys,
					codeBlockStartIndex
				);
				const routePartToCarousel = (): boolean => {
					widget.inputPart.addToolToConfirmationCarousel(toolInvocation, factory);
					dom.hide(part.domNode);
					return true;
				};
				let hasScheduledCarouselRoute = false;
				const scheduleRoutePartToCarousel = () => {
					if (hasScheduledCarouselRoute) {
						return;
					}

					hasScheduledCarouselRoute = true;
					part.addDisposable(dom.scheduleAtNextAnimationFrame(dom.getWindow(part.domNode), () => {
						hasScheduledCarouselRoute = false;
						const state = toolInvocation.state.get();
						if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation && state.confirmationMessages?.title &&
							toolInvocation.presentation !== 'hidden' &&
							toolInvocation.source.type !== 'mcp' &&
							!this.viewModel?.editing) {
							routePartToCarousel();
						}
					}));
				};
				part.addDisposable(autorun(reader => {
					const state = toolInvocation.state.read(reader);
					const isCarouselConfirmation = state.type === IChatToolInvocation.StateKind.WaitingForConfirmation &&
						!!state.confirmationMessages?.title &&
						toolInvocation.presentation !== 'hidden' &&
						toolInvocation.source.type !== 'mcp' &&
						!this.viewModel?.editing;

					if (isCarouselConfirmation) {
						if (!routePartToCarousel()) {
							dom.hide(part.domNode);
							scheduleRoutePartToCarousel();
						}
					} else if (IChatToolInvocation.isEffectivelyHidden(toolInvocation, reader)) {
						this.updateWorkingProgressForPendingConfirmations(templateData);
						dom.hide(part.domNode);
					} else {
						this.updateWorkingProgressForPendingConfirmations(templateData);
						dom.show(part.domNode);
					}
				}));
			}
		}

		return part;
	}

	private setupConfirmationTransitionWatcher(
		toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized,
		thinkingPart: ChatThinkingContentPart,
		getCreatedPart: () => ChatToolInvocationPart | undefined,
		createToolPart: () => { domNode: HTMLElement; disposable: ChatToolInvocationPart; part: ChatToolInvocationPart },
		context: IChatContentPartRenderContext,
		templateData: IChatListItemTemplate
	): void {
		if (toolInvocation.kind !== 'toolInvocation') {
			return;
		}

		const moveConfirmationWidgetOutOfThinking = (): ChatToolInvocationPart => {
			const createdPart = getCreatedPart();
			toolInvocation.isAttachedToThinking = false;
			let part: ChatToolInvocationPart;
			if (createdPart?.domNode) {
				part = createdPart;
				const wrapper = createdPart.domNode.parentElement;
				if (wrapper?.classList.contains('chat-thinking-tool-wrapper')) {
					wrapper.remove();
				}
				templateData.value.appendChild(createdPart.domNode);
				thinkingPart.removeMaterializedItem(toolInvocation.toolCallId);
				(templateData.movedOutToolParts ??= new DisposableMap()).set(toolInvocation.toolCallId, createdPart);
			} else {
				thinkingPart.removeLazyItem(toolInvocation.toolId);
				const { domNode, part: createdPart } = createToolPart();
				part = createdPart;
				(templateData.movedOutToolParts ??= new DisposableMap()).set(toolInvocation.toolCallId, createdPart);
				templateData.value.appendChild(domNode);
			}
			this.finalizeCurrentThinkingPart(context, templateData);

			if (thinkingPart.isEffectivelyEmpty()) {
				thinkingPart.domNode?.remove();
				thinkingPart.dispose();
			}

			return part;
		};

		const isWorkingState = (type: IChatToolInvocation.StateKind) =>
			type === IChatToolInvocation.StateKind.Streaming || type === IChatToolInvocation.StateKind.Executing;

		const tryRouteConfirmationToCarousel = (): boolean => {
			if (!this.configService.getValue<boolean>(ChatConfiguration.ToolConfirmationCarousel) ||
				!isResponseVM(context.element) ||
				this.viewModel?.editing ||
				toolInvocation.presentation === 'hidden' ||
				toolInvocation.source.type === 'mcp') {
				return false;
			}

			const state = toolInvocation.state.get();
			if (state.type !== IChatToolInvocation.StateKind.WaitingForConfirmation || !state.confirmationMessages?.title) {
				return false;
			}

			const widget = this.chatWidgetService.getWidgetBySessionResource(context.element.sessionResource);
			if (!widget) {
				return false;
			}

			const part = moveConfirmationWidgetOutOfThinking();
			const factory = (tool: IChatToolInvocation) => this.instantiationService.createInstance(
				ChatToolInvocationPart, tool, context,
				this.chatContentMarkdownRenderer, this._contentReferencesListPool,
				this._toolEditorPool, () => this._currentLayoutWidth.get(),
				this._announcedToolProgressKeys,
				context.codeBlockStartIndex
			);

			part.addDisposable(autorun(reader => {
				const currentState = toolInvocation.state.read(reader);
				if (currentState.type === IChatToolInvocation.StateKind.WaitingForConfirmation && currentState.confirmationMessages?.title) {
					widget.inputPart.addToolToConfirmationCarousel(toolInvocation, factory);
					dom.hide(part.domNode);
				} else if (IChatToolInvocation.isEffectivelyHidden(toolInvocation, reader)) {
					this.updateWorkingProgressForPendingConfirmations(templateData);
					dom.hide(part.domNode);
				} else {
					this.updateWorkingProgressForPendingConfirmations(templateData);
					dom.show(part.domNode);
				}
			}));

			return true;
		};

		const currentState = toolInvocation.state.get();
		if (toolInvocationHasMcpAppData(toolInvocation)) {
			moveConfirmationWidgetOutOfThinking();
			return;
		}

		if (currentState.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
			if (!tryRouteConfirmationToCarousel()) {
				moveConfirmationWidgetOutOfThinking();
			}
			return;
		}
		if (currentState.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
			moveConfirmationWidgetOutOfThinking();
			return;
		}

		if (!isWorkingState(currentState.type)) {
			return;
		}

		let didMoveToolOut = false;
		const disposable = autorun(reader => {
			const state = toolInvocation.state.read(reader);
			toolInvocation.toolSpecificDataKind.read(reader);
			if (toolInvocationHasMcpAppData(toolInvocation)) {
				if (didMoveToolOut) {
					return;
				}
				didMoveToolOut = true;
				disposable.dispose();
				moveConfirmationWidgetOutOfThinking();
				return;
			}
			if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				if (didMoveToolOut) {
					return;
				}
				didMoveToolOut = true;
				disposable.dispose();
				if (state.type !== IChatToolInvocation.StateKind.WaitingForConfirmation || !tryRouteConfirmationToCarousel()) {
					moveConfirmationWidgetOutOfThinking();
				}
			}
		});

		thinkingPart.addDisposable(disposable);
	}

	private renderExtensionsContent(extensionsContent: IChatExtensionsContent, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart | undefined {
		const part = this.instantiationService.createInstance(ChatExtensionsContentPart, extensionsContent);
		return part;
	}

	private renderHookPart(hookPart: IChatHookPart, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate, batchedSubagentParts?: Set<ChatSubagentContentPart>): IChatContentPart {
		if (!(hookPart.stopReason || hookPart.systemMessage)) {
			return this.renderNoContent(other => other.kind === 'hook' && other.hookType === hookPart.hookType);
		}

		if (hookPart.subAgentInvocationId) {
			const subagentPart = this.getSubagentPart(templateData.renderedParts, hookPart.subAgentInvocationId);
			if (subagentPart) {
				this.beginSubagentToolPresentationBatch(subagentPart, batchedSubagentParts);
				subagentPart.appendHookItem(() => {
					const part = this.instantiationService.createInstance(ChatHookContentPart, hookPart, context);
					return { domNode: part.domNode, disposable: part };
				}, hookPart);
				return this.renderNoContent(other => other.kind === 'hook' && other.hookType === hookPart.hookType && other.subAgentInvocationId === hookPart.subAgentInvocationId);
			}
		}

		const shouldPinToThinking = hookPart.hookType === HookType.PreToolUse || hookPart.hookType === HookType.PostToolUse;
		if (shouldPinToThinking) {
			const hookTitle = hookPart.stopReason
				? (hookPart.toolDisplayName
					? localize('hook.thinking.blocked', "Blocked {0}", hookPart.toolDisplayName)
					: localize('hook.thinking.blockedGeneric', "Blocked by hook"))
				: (hookPart.toolDisplayName
					? localize('hook.thinking.warning', "Used {0}, but received a warning", hookPart.toolDisplayName)
					: localize('hook.thinking.warningGeneric', "Tool call received a warning"));

			let { part: thinkingPart } = this.getLastThinkingPartForGroupedItem(context, templateData);
			if (!thinkingPart) {
				const newThinking = this.renderThinkingPart({ kind: 'thinking' }, context, templateData);
				if (newThinking instanceof ChatThinkingContentPart) {
					thinkingPart = newThinking;
				}
			}

			if (thinkingPart) {
				thinkingPart.appendItem(() => {
					const part = this.instantiationService.createInstance(ChatHookContentPart, hookPart, context);
					return { domNode: part.domNode, disposable: part };
				}, hookTitle, undefined, templateData.value);
				return thinkingPart;
			}
		}

		const part = this.instantiationService.createInstance(ChatHookContentPart, hookPart, context);
		return part;
	}

	private renderPullRequestContent(pullRequestContent: IChatPullRequestContent, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart | undefined {
		const part = this.instantiationService.createInstance(ChatPullRequestContentPart, pullRequestContent);
		return part;
	}

	private renderProgressTask(task: IChatTask | IChatTaskSerialized, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart | undefined {
		if (!isResponseVM(context.element)) {
			return;
		}

		this.finalizeCurrentThinkingPart(context, templateData);

		const taskPart = this.instantiationService.createInstance(ChatTaskContentPart, task, this._contentReferencesListPool, this.chatContentMarkdownRenderer, context);
		return taskPart;
	}


	private renderConfirmation(context: IChatContentPartRenderContext, confirmation: IChatConfirmation, templateData: IChatListItemTemplate): IChatContentPart {
		const part = this.instantiationService.createInstance(ChatConfirmationContentPart, confirmation, context);
		return part;
	}

	private renderElicitation(context: IChatContentPartRenderContext, elicitation: IChatElicitationRequest | IChatElicitationRequestSerialized, templateData: IChatListItemTemplate): IChatContentPart {
		if (elicitation.kind === 'elicitationSerialized' ? elicitation.isHidden : elicitation.isHidden?.get()) {
			return this.renderNoContent(other => elicitation.kind === other.kind);
		}

		this.finalizeCurrentThinkingPart(context, templateData);

		const part = this.instantiationService.createInstance(ChatElicitationContentPart, elicitation, context);
		return part;
	}

	private renderQuestionCarousel(context: IChatContentPartRenderContext, carousel: IChatQuestionCarousel, templateData: IChatListItemTemplate): IChatContentPart {
		this.finalizeCurrentThinkingPart(context, templateData);
		this._notifyOnQuestionCarousel(context, carousel);

		if (!carousel.terminalId && isResponseVM(context.element)) {
			const responseElement = context.element;
			const model = this.chatService.getSession(responseElement.sessionResource);
			const request = model?.getRequests().find(r => r.id === responseElement.requestId);
			if (request?.terminalExecutionId) {
				carousel.terminalId = request.terminalExecutionId;
				this.logService.trace(`ChatListItemRenderer#renderQuestionCarousel: backfilled terminalId=${carousel.terminalId} for request=${responseElement.requestId}`);
			} else {
				this.logService.trace(`ChatListItemRenderer#renderQuestionCarousel: no terminalExecutionId to backfill for request=${responseElement.requestId}`);
			}
		}

		const widget = isResponseVM(context.element) ? this.chatWidgetService.getWidgetBySessionResource(context.element.sessionResource) : undefined;
		const shouldAutoFocus = !!widget && dom.isAncestorOfActiveElement(widget.domNode) && widget.getInput() === '';
		const responseId = isResponseVM(context.element) ? context.element.requestId : undefined;
		const carouselKey = carousel.resolveId ?? `${responseId ?? ''}_${context.contentIndex}`;

		const handleSubmit = async (answers: Map<string, IChatQuestionAnswerValue> | undefined, part: ChatQuestionCarouselPart) => {
			if (carousel.isUsed) {
				return;
			}
			const answersRecord: IChatQuestionAnswers | undefined = answers ? Object.fromEntries(answers) : undefined;
			carousel.data = answersRecord ?? {};
			carousel.isUsed = true;
			if (carousel instanceof ChatQuestionCarouselData) {
				carousel.draftAnswers = undefined;
				carousel.draftCurrentIndex = undefined;
				carousel.completion.complete({ answers: answersRecord });
			}

			if (isResponseVM(context.element) && carousel.resolveId) {
				this.chatService.notifyQuestionCarouselAnswer(context.element.requestId, carousel.resolveId, answersRecord);
			}

			this.removeCarouselFromTracking(context, part);

			widget?.input.clearQuestionCarousel(undefined, carouselKey);
		};

		const responseIsComplete = isResponseVM(context.element) && context.element.isComplete;
		const inputPartHasCarousel = widget?.input.questionCarousel !== undefined;

		if (carousel.isUsed || responseIsComplete) {
			if (responseIsComplete && !carousel.isUsed && isResponseVM(context.element) && carousel.resolveId) {
				carousel.data = {};
				carousel.isUsed = true;
				if (carousel instanceof ChatQuestionCarouselData) {
					carousel.draftAnswers = undefined;
					carousel.draftCurrentIndex = undefined;
					carousel.completion.complete({ answers: undefined });
				}
				this.chatService.notifyQuestionCarouselAnswer(context.element.requestId, carousel.resolveId, undefined);
				this.pendingQuestionCarousels.get(context.element.sessionResource)?.clear();
			}

			if (inputPartHasCarousel) {
				if (carousel.isUsed) {
					widget?.input.clearQuestionCarousel(undefined, carouselKey);
				} else if (responseIsComplete && responseId) {
					widget?.input.clearQuestionCarousel(responseId);
				}
			}

			const part = this.instantiationService.createInstance(ChatQuestionCarouselPart, carousel, context, {
				shouldAutoFocus: false,
				onSubmit: async (answers) => handleSubmit(answers, part)
			});
			return part;
		}

		const isEditing = !!this.viewModel?.editing;
		const part = isEditing ? undefined : widget?.input.renderQuestionCarousel(carousel, context, {
			shouldAutoFocus,
			onSubmit: async (answers) => handleSubmit(answers, part!)
		});

		if (!part) {
			const fallbackPart = this.instantiationService.createInstance(ChatQuestionCarouselPart, carousel, context, {
				shouldAutoFocus,
				onSubmit: async (answers) => handleSubmit(answers, fallbackPart)
			});
			return fallbackPart;
		}

		if (isResponseVM(context.element) && carousel.allowSkip && !carousel.isUsed) {
			let carousels = this.pendingQuestionCarousels.get(context.element.sessionResource);
			if (!carousels) {
				carousels = new Set();
				this.pendingQuestionCarousels.set(context.element.sessionResource, carousels);
			}
			if (!carousels.has(part)) {
				carousels.add(part);

				part.addDisposable({ dispose: () => this.removeCarouselFromTracking(context, part) });
			}
		}

		return this.renderNoContent((other, _followingContent, element) => {
			if (carousel.isUsed || (isResponseVM(element) && element.isComplete)) {
				return false;
			}
			if (other.kind === 'questionCarousel') {
				const otherCarousel = other as IChatQuestionCarousel;
				if (carousel.resolveId && otherCarousel.resolveId) {
					return carousel.resolveId === otherCarousel.resolveId;
				}
				return other === carousel;
			}
			return false;
		});
	}

	private _getCarouselStableKey(context: IChatContentPartRenderContext, carousel: IChatQuestionCarousel): string | undefined {
		const requestId = isResponseVM(context.element) ? context.element.requestId : undefined;
		if (!requestId || !carousel.resolveId) {
			return undefined;
		}
		return `${requestId}::${carousel.resolveId}`;
	}

	private _notifyOnQuestionCarousel(context: IChatContentPartRenderContext, carousel: IChatQuestionCarousel): void {
		if (carousel.isUsed) {
			return;
		}

		const stableKey = this._getCarouselStableKey(context, carousel);
		if (stableKey ? this._notifiedQuestionCarousels.has(stableKey) : false) {
			return;
		}
		const questionCount = carousel.questions.length;
		const question = carousel.questions.length > 0 && carousel.questions[0].message ? carousel.questions[0].message : localize('chat.questionCarouselNeedsInputSR', "Chat input required.");
		const stringQuestion = typeof question === 'string' ? question : question.value;
		const alertMessage = questionCount === 1
			? localize('chat.questionCarouselAlertOne', "Chat input required (1 question): {0}", stringQuestion)
			: localize('chat.questionCarouselAlertMany', "Chat input required ({0} questions): {1}", questionCount, stringQuestion);
		this.accessibilityService.alert(alertMessage);
		if (stableKey) {
			this._notifiedQuestionCarousels.add(stableKey);
		}

		const signalMessage = questionCount === 1
			? localize('chat.questionCarouselSignalOne', "Chat needs your input (1 question).")
			: localize('chat.questionCarouselSignalMany', "Chat needs your input ({0} questions).", questionCount);
		this.accessibilitySignalService.playSignal(AccessibilitySignal.chatUserActionRequired, { allowManyInParallel: true, customAlertMessage: signalMessage });

	}

	private renderPlanReview(context: IChatContentPartRenderContext, review: IChatPlanReview, templateData: IChatListItemTemplate): IChatContentPart {
		const widget = isResponseVM(context.element) ? this.chatWidgetService.getWidgetBySessionResource(context.element.sessionResource) : undefined;
		const responseId = isResponseVM(context.element) ? context.element.requestId : undefined;
		const reviewKey = review.resolveId ?? `${responseId ?? ''}_${context.contentIndex}`;

		this.finalizeCurrentThinkingPart(context, templateData);

		const handleSubmit = (result: IChatPlanReviewResult) => {
			review.data = result;
			review.isUsed = true;
			if (review instanceof ChatPlanReviewData) {
				review.completion.complete(result);
			}
			widget?.input.clearPlanReview(undefined, reviewKey);
		};

		const responseIsComplete = isResponseVM(context.element) && context.element.isComplete;
		if (responseIsComplete && !review.isUsed) {
			review.isUsed = true;
			if (review instanceof ChatPlanReviewData) {
				review.completion.complete(undefined);
			}
		}
		if (responseIsComplete && responseId) {
			widget?.input.clearPlanReview(responseId);
		}

		const renderProgress = (): IChatContentPart => {
			const message = this.getPlanReviewProgressMessage(review);
			if (!message) {
				return this.renderNoContent(other => other.kind === 'planReview');
			}
			const renderedAsUsed = !!review.isUsed;
			const isPending = !renderedAsUsed;
			const content = buildPlanReviewProgressContent(review, message);
			const progressPart = this.instantiationService.createInstance(
				ChatProgressContentPart,
				{ content },
				this.chatContentMarkdownRenderer,
				context,
				isPending,
				true,
				isPending ? undefined : Codicon.check,
				undefined,
				isPending,
			);
			return {
				domNode: progressPart.domNode,
				dispose: () => progressPart.dispose(),
				hasSameContent: (other, _followingContent, _element) => {
					if (other.kind !== 'planReview') {
						return false;
					}
					if (!!review.isUsed !== renderedAsUsed) {
						return false;
					}
					if (review.resolveId && other.resolveId) {
						return review.resolveId === other.resolveId;
					}
					return other === review;
				},
			};
		};

		if (review.isUsed) {
			return renderProgress();
		}

		const isEditing = !!this.viewModel?.editing;
		const dockedPart = isEditing ? undefined : widget?.input.renderPlanReview(review, context, {
			onSubmit: handleSubmit,
		});

		if (!dockedPart) {
			const fallbackPart = this.instantiationService.createInstance(ChatPlanReviewPart, review, context, {
				onSubmit: handleSubmit,
			});
			return fallbackPart;
		}

		return renderProgress();
	}

	private getPlanReviewProgressMessage(review: IChatPlanReview): string | undefined {
		if (!review.isUsed) {
			return localize('chat.planReview.required', "Plan review required");
		}
		const result = review.data;
		if (!result) {
			return undefined;
		}
		if (result.rejected) {
			return localize('chat.planReview.rejected', "Rejected plan");
		}
		if (result.feedback) {
			return localize('chat.planReview.feedback', "Provided feedback");
		}
		const action = review.actions.find(a => a.label === result.action);
		if (action?.permissionLevel === 'autopilot') {
			return localize('chat.planReview.autopilot', "Started implementation with Autopilot");
		}
		return localize('chat.planReview.approved', "Approved plan");
	}

	private removeCarouselFromTracking(context: IChatContentPartRenderContext, part: ChatQuestionCarouselPart): void {
		if (isResponseVM(context.element)) {
			const carousels = this.pendingQuestionCarousels.get(context.element.sessionResource);
			if (carousels) {
				carousels.delete(part);
			}
		}
	}

	private renderChangesSummary(content: IChatChangesSummaryPart, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart {
		const part = this.instantiationService.createInstance(ChatCheckpointFileChangesSummaryContentPart, content, context);
		return part;
	}

	private renderTurnPills(content: IChatTurnPillsPart, context: IChatContentPartRenderContext): IChatContentPart {
		return this.instantiationService.createInstance(ChatTurnPillsContentPart, content, context);
	}

	private renderAttachments(variables: readonly IChatRequestVariableEntry[], contentReferences: ReadonlyArray<IChatContentReference> | undefined, modelId: string | undefined, templateData: IChatListItemTemplate, resolvedModelId?: string) {
		return this.instantiationService.createInstance(ChatAttachmentsContentPart, {
			variables,
			contentReferences,
			modelId,
			resolvedModelId,
			domNode: undefined
		});
	}

	private renderTextEdit(context: IChatContentPartRenderContext, chatTextEdit: IChatTextEditGroup, templateData: IChatListItemTemplate): IChatContentPart {
		const textEditPart = this.instantiationService.createInstance(ChatTextEditContentPart, chatTextEdit, context, this.rendererOptions, this._diffEditorPool, this._currentLayoutWidth.get());
		return textEditPart;
	}

	private renderExternalEdit(content: IChatExternalEdit, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart {
		const editPart = this.instantiationService.createInstance(ChatExternalEditContentPart, content, context);

		const collapsedToolsMode = this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools');
		if (isResponseVM(context.element) && collapsedToolsMode !== CollapsedToolsDisplayMode.Off && this.shouldPinPart(content, context.element)) {
			const partId = `externalEdit-${content.uri.toString()}-${content.undoStopId ?? ''}`;
			const { part: lastThinking, separatedFromReasoning } = this.getLastThinkingPartForGroupedItem(context, templateData);
			if (!lastThinking && shouldCreateGroupedThinkingPart(collapsedToolsMode, separatedFromReasoning)) {
				const thinkingPart = this.renderThinkingPart({ kind: 'thinking' }, context, templateData);
				if (thinkingPart instanceof ChatThinkingContentPart) {
					thinkingPart.appendItem(
						() => ({ domNode: editPart.domNode, disposable: editPart }),
						partId,
						content,
						templateData.value,
						editPart.onDidChangeDiff,
						editPart,
					);
				}
				return thinkingPart;
			}
			if (lastThinking) {
				lastThinking.appendItem(
					() => ({ domNode: editPart.domNode, disposable: editPart }),
					partId,
					content,
					templateData.value,
					editPart.onDidChangeDiff,
					editPart,
				);
				return this.renderNoContent(other => other.kind === content.kind);
			}
		}

		return editPart;
	}

	private renderMarkdown(markdown: IChatMarkdownContent, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart {
		const element = context.element;
		const isBlankMarkdown = !markdown.content.value.trim();
		const hasPendingEditCodeblock = isResponseVM(element) && !element.isComplete
			&& hasCodeblockUriTag(markdown.content.value)
			&& !codeblockHasClosingBackticks(markdown.content.value);
		if (!this.hasEditCodeblockUri(markdown) && !isBlankMarkdown && !hasPendingEditCodeblock) {
			this.finalizeCurrentThinkingPart(context, templateData);
		}
		const fillInIncompleteTokens = isResponseVM(element) && (!element.isComplete || element.isCanceled || element.errorDetails?.responseIsFiltered || element.errorDetails?.responseIsIncomplete || !!element.renderData);
		const codeBlockStartIndex = context.codeBlockStartIndex;
		const markdownPart = templateData.instantiationService.createInstance(ChatMarkdownContentPart, markdown, context, this._editorPool, fillInIncompleteTokens, codeBlockStartIndex, this.chatContentMarkdownRenderer, undefined, this._currentLayoutWidth.get(), { codeBlockRenderOptions: this.rendererOptions.codeBlockRenderOptions });
		markdownPart.addDisposable(markdownPart.onDidChangeHeight(() => this.fireItemHeightChange(templateData)));
		if (isRequestVM(element)) {
			markdownPart.domNode.tabIndex = 0;
			if (this.configService.getValue<string>('chat.editRequests') === 'inline' && this.rendererOptions.editable) {
				markdownPart.domNode.classList.add('clickable');
				markdownPart.addDisposable(dom.addDisposableListener(markdownPart.domNode, dom.EventType.CLICK, (e: MouseEvent) => {
					if (this.viewModel?.editing?.id === element.id) {
						return;
					}

					if (isAnchorTarget(e.target)) {
						return;
					}
					const clickedElement = e.target as HTMLElement;

					const selection = dom.getWindow(templateData.rowContainer).getSelection();
					if (selection && !selection.isCollapsed && selection.toString().length > 0) {
						return;
					}

					const monacoEditor = dom.findParentWithClass(clickedElement, 'monaco-editor');
					if (monacoEditor) {
						const editorPart = Array.from(this.editorsInUse()).find(editor =>
							editor.element.contains(monacoEditor));

						if (editorPart?.editor.getSelection()?.isEmpty() === false) {
							return;
						}
					}

					e?.preventDefault();
					e?.stopPropagation();
					this._onDidClickRequest.fire(templateData);
				}));
				markdownPart.addDisposable(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), markdownPart.domNode, localize('requestMarkdownPartTitle', "Click to Edit"), { trapFocus: true }));
			}
			markdownPart.addDisposable(dom.addDisposableListener(markdownPart.domNode, dom.EventType.FOCUS, () => {
				this.hoverVisible(templateData.requestHover);
			}));
			markdownPart.addDisposable(dom.addDisposableListener(markdownPart.domNode, dom.EventType.BLUR, () => {
				this.hoverHidden(templateData.requestHover);
			}));
		}

		if (!dom.findParentWithClass(templateData.rowContainer, 'monaco-tree-sticky-row')) {
			this.handleRenderedCodeblocks(element, markdownPart, codeBlockStartIndex);
		}

		const collapsedToolsMode = this.configService.getValue<CollapsedToolsDisplayMode>('chat.agent.thinking.collapsedTools');
		if (isResponseVM(context.element) && collapsedToolsMode !== CollapsedToolsDisplayMode.Off) {

			const isComplete = this.isCodeblockComplete(markdown, context.element);

			const subAgentInvocationId = extractSubAgentInvocationIdFromText(markdown.content.value);
			if (subAgentInvocationId) {
				const subagentPart = this.getSubagentPart(templateData.renderedParts, subAgentInvocationId);
				if (subagentPart && markdownPart?.domNode && isComplete) {
					subagentPart.appendMarkdownItem(
						() => ({ domNode: markdownPart.domNode, disposable: markdownPart }),
						markdownPart.codeblocksPartId,
						markdown,
						templateData.value,
						markdownPart,
					);
					return this.renderNoContent(other =>
						other.kind === 'markdownContent'
						&& other.content.value === markdown.content.value
						&& extractSubAgentInvocationIdFromText(other.content.value) === subAgentInvocationId);
				}
			}

			const shouldPin = this.shouldPinPart(markdown, context.element);
			if (markdownPart?.domNode && shouldPin && isComplete) {
				const { part: lastThinking, separatedFromReasoning } = this.getLastThinkingPartForGroupedItem(context, templateData);
				if (!lastThinking && shouldCreateGroupedThinkingPart(collapsedToolsMode, separatedFromReasoning)) {
					const thinkingPart = this.renderThinkingPart({
						kind: 'thinking',
					}, context, templateData);

					if (thinkingPart instanceof ChatThinkingContentPart) {
						thinkingPart.appendItem(
							() => ({ domNode: markdownPart.domNode, disposable: markdownPart }),
							markdownPart.codeblocksPartId,
							markdown,
							templateData.value,
							markdownPart.onDidChangeDiff,
							markdownPart,
						);
					}

					return thinkingPart;
				}

				if (lastThinking) {
					lastThinking.appendItem(
						() => ({ domNode: markdownPart.domNode, disposable: markdownPart }),
						markdownPart.codeblocksPartId,
						markdown,
						templateData.value,
						markdownPart.onDidChangeDiff
					);
				}
			} else if (!shouldPin && !isBlankMarkdown && !hasPendingEditCodeblock) {
				this.finalizeCurrentThinkingPart(context, templateData);
			}
		}

		return markdownPart;
	}

	renderThinkingPart(content: IChatThinkingPart, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart {
		if (!content.id) {
			content.id = Date.now().toString();
		}

		const element = isResponseVM(context.element) ? context.element : undefined;
		const streamingCompleted = this.isThinkingLookAheadComplete(context, element);
		const lastThinkingPart = this.getLastThinkingPart(templateData.renderedParts);
		if (lastThinkingPart?.hasGroupedItems() && shouldStartNewCollapsedThinkingGroup(getEffectiveThinkingDisplayMode(this.configService, this.contextKeyService), 'items', 'reasoning')) {
			this.finalizeCurrentThinkingPart(context, templateData);
		}

		if (Array.isArray(content.value)) {
			if (content.value.length < 1) {
				const lastThinking = this.getLastThinkingPart(templateData.renderedParts);
				lastThinking?.finalizeTitleIfDefault();
				return this.renderNoContent(other => content.kind === other.kind);
			}
			let lastPart: IChatContentPart | undefined;
			for (const item of content.value) {
				if (item) {
					const lastThinkingPart = lastPart instanceof ChatThinkingContentPart && lastPart.getIsActive() ? lastPart : undefined;
					if (lastThinkingPart) {
						lastThinkingPart.setupThinkingContainer({ ...content, value: item });
					} else {
						const itemContent = { ...content, value: item };
						const itemPart = templateData.instantiationService.createInstance(ChatThinkingContentPart, itemContent, context, this.chatContentMarkdownRenderer, streamingCompleted);
						lastPart = itemPart;
					}
				}
			}
			return lastPart ?? this.renderNoContent(other => content.kind === other.kind);
		} else {
			const lastActiveThinking = this.getLastThinkingPart(templateData.renderedParts);
			if (lastActiveThinking) {
				lastActiveThinking.setupThinkingContainer(content);
				return lastActiveThinking;
			} else {
				const part = templateData.instantiationService.createInstance(ChatThinkingContentPart, content, context, this.chatContentMarkdownRenderer, streamingCompleted);
				return part;
			}

		}
	}

	disposeElement(node: ITreeNode<ChatTreeItem, FuzzyScore>, index: number, templateData: IChatListItemTemplate, details?: IListElementRenderDetails): void {
		this.traceLayout('disposeElement', `Disposing element, index=${index}`);
		templateData.elementDisposables.clear();
		const ownsElementMappings = this.templateDataByRequestId.get(node.element.id) === templateData;

		if (templateData.currentElement && !this.viewModel?.editing) {
			const mapped = this.templateDataByRequestId.get(templateData.currentElement.id);
			if (mapped === templateData) {
				this.templateDataByRequestId.delete(templateData.currentElement.id);
			}
		}

		if (ownsElementMappings) {
			const codeBlocks = this.codeBlocksByResponseId.get(node.element.id);
			if (codeBlocks) {
				for (const info of codeBlocks) {
					if (info?.uri) {
						this.codeBlocksByEditorUri.delete(info.uri);
					}
				}
				this.codeBlocksByResponseId.delete(node.element.id);
			}
		}
		this.fileTreesByResponseId.delete(node.element.id);
		this.focusedFileTreesByResponseId.delete(node.element.id);

		if (isRequestVM(node.element) && node.element.id === this.viewModel?.editing?.id && details?.onScroll) {
			this._onDidDispose.fire(templateData);
		}

		if (templateData.titleToolbar) {
			templateData.titleToolbar.context = undefined;
		}
		templateData.footerToolbar.context = undefined;
		templateData.checkpointToolbar.context = undefined;
		templateData.checkpointRestoreToolbar.context = undefined;
		templateData.responseTokenStatsHover.clear();
	}

	private renderMcpServersInteractionRequired(content: IChatMcpServersStarting | IChatMcpServersStartingSerialized, context: IChatContentPartRenderContext, templateData: IChatListItemTemplate): IChatContentPart {
		return this.instantiationService.createInstance(ChatMcpServersInteractionContentPart, content, context);
	}

	private renderDisabledClaudeHooks(content: IChatDisabledClaudeHooksPart, context: IChatContentPartRenderContext): IChatContentPart {
		return this.instantiationService.createInstance(ChatDisabledClaudeHooksContentPart, context);
	}

	disposeTemplate(templateData: IChatListItemTemplate): void {
		this.clearRenderedParts(templateData);
		templateData.templateDisposables.dispose();
	}

	private hoverVisible(requestHover: HTMLElement) {
		requestHover.style.opacity = '1';
	}

	private hoverHidden(requestHover: HTMLElement) {
		requestHover.style.opacity = '0';
	}

}

export class ChatListDelegate extends CachedListVirtualDelegate<ChatTreeItem> {
	constructor(
		private readonly defaultElementHeight: number,
	) {
		super();
	}

	protected estimateHeight(element: ChatTreeItem): number {
		return element.currentRenderedHeight ?? this.defaultElementHeight;
	}

	getTemplateId(element: ChatTreeItem): string {
		return ChatListItemRenderer.ID;
	}

	hasDynamicHeight(element: ChatTreeItem): boolean {
		return true;
	}

	getMeasuredHeight(element: ChatTreeItem): number | undefined {
		return this.getCachedHeight(element);
	}
}

function isParentSubagentTool(invocation: IChatToolInvocation | IChatToolInvocationSerialized): boolean {
	return invocation.toolSpecificData?.kind === 'subagent' && !invocation.subAgentInvocationId;
}

function getSubagentId(invocation: IChatToolInvocation | IChatToolInvocationSerialized): string | undefined {
	if (isParentSubagentTool(invocation)) {
		return invocation.toolCallId;
	}
	return invocation.subAgentInvocationId;
}

function isSubagentToolInvocation(invocation: IChatToolInvocation | IChatToolInvocationSerialized): boolean {
	return !!getSubagentId(invocation);
}

export function getWorkingProgressRelevantParts(parts: readonly IChatRendererContent[]): IChatRendererContent[] {
	return parts.filter(part => {
		if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') {
			return !isSubagentToolInvocation(part);
		}
		if (part.kind === 'hook') {
			return !part.subAgentInvocationId;
		}
		return part.kind !== 'markdownContent' || !extractSubAgentInvocationIdFromText(part.content.value);
	});
}

export function endsWithActiveSubagentContent(parts: readonly IChatRendererContent[]): boolean {
	const lastPart = findLastMeaningfulPart(parts.filter(part => !isNestedSubagentContent(part)));
	if (!lastPart || (lastPart.kind !== 'toolInvocation' && lastPart.kind !== 'toolInvocationSerialized')) {
		return false;
	}
	if (!isParentSubagentTool(lastPart)) {
		return false;
	}
	return lastPart.toolSpecificData?.kind === 'subagent'
		&& (lastPart.toolSpecificData.isActive ?? !IChatToolInvocation.isComplete(lastPart));
}

function isNestedSubagentContent(part: IChatRendererContent): boolean {
	if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') {
		return !!part.subAgentInvocationId;
	}
	if (part.kind === 'hook') {
		return !!part.subAgentInvocationId;
	}
	return part.kind === 'markdownContent' && !!extractSubAgentInvocationIdFromText(part.content.value);
}

export function endsWithCompletedQuestionInteraction(parts: readonly IChatRendererContent[]): boolean {
	const lastPart = findLastMeaningfulPart(parts);
	if (!lastPart) {
		return false;
	}
	if (lastPart.kind === 'questionCarousel') {
		return !!lastPart.isUsed;
	}
	return (lastPart.kind === 'toolInvocation' || lastPart.kind === 'toolInvocationSerialized')
		&& isAskQuestionsToolInvocation(lastPart)
		&& IChatToolInvocation.isComplete(lastPart);
}

export function isWaitingForMcpServers(parts: readonly IChatRendererContent[]): boolean {
	return parts.some(part => part.kind === 'mcpServersStartingSlow' && part.servers.get().length > 0);
}

function findLastMeaningfulPart(parts: readonly IChatRendererContent[]): IChatRendererContent | undefined {
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (part.kind !== 'markdownContent' || part.content.value.trim().length > 0) {
			return part;
		}
	}
	return undefined;
}
