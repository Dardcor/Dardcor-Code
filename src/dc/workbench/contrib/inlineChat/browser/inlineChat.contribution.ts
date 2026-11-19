import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { InlineChatController } from './inlineChatController.js';
import * as InlineChatActions from './inlineChatActions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { InlineChatNotebookContribution } from './inlineChatNotebook.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IInlineChatSessionService } from './inlineChatSessionService.js';
import { InlineChatEnabler, InlineChatEscapeToolContribution, InlineChatSessionServiceImpl } from './inlineChatSessionServiceImpl.js';
import { IInlineChatSessionResolver, InlineChatSessionResolver } from './inlineChatSessionResolver.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { InlineChatAccessibilityHelp } from './inlineChatAccessibilityHelp.js';
import { InlineChatDefaultModel } from './inlineChatDefaultModel.js';

registerEditorContribution(InlineChatController.ID, InlineChatController, EditorContributionInstantiation.Eager);

registerAction2(InlineChatActions.KeepSessionAction2);
registerAction2(InlineChatActions.UndoAndCloseSessionAction2);
registerAction2(InlineChatActions.CancelSessionAction);
registerAction2(InlineChatActions.ContinueInlineChatInChatViewAction);
registerAction2(InlineChatActions.RephraseInlineChatSessionAction);

registerSingleton(IInlineChatSessionService, InlineChatSessionServiceImpl, InstantiationType.Delayed);
registerSingleton(IInlineChatSessionResolver, InlineChatSessionResolver, InstantiationType.Delayed);

registerAction2(InlineChatActions.StartSessionAction);
registerAction2(InlineChatActions.AskInChatAction);
registerAction2(InlineChatActions.FocusInlineChat);
registerAction2(InlineChatActions.FixDiagnosticsAction);
registerAction2(InlineChatActions.DismissEditorAffordanceAction);

registerWorkbenchContribution2('inlineChat.notebooks', InlineChatNotebookContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(InlineChatDefaultModel.ID, InlineChatDefaultModel, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(InlineChatEnabler.Id, InlineChatEnabler, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(InlineChatEscapeToolContribution.Id, InlineChatEscapeToolContribution, WorkbenchPhase.AfterRestored);

AccessibleViewRegistry.register(new InlineChatAccessibilityHelp());
