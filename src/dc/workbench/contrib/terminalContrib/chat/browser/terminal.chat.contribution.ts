import { registerTerminalContribution } from '../../../terminal/browser/terminalExtensions.js';
import { TerminalInlineChatAccessibleView } from './terminalChatAccessibleView.js';
import { TerminalChatController } from './terminalChatController.js';
import './terminalChatActions.js';
import { AccessibleViewRegistry } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { TerminalChatAccessibilityHelp } from './terminalChatAccessibilityHelp.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { TerminalChatEnabler } from './terminalChatEnabler.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { ITerminalChatService } from '../../../terminal/browser/terminal.js';
import { TerminalChatService } from './terminalChatService.js';
import { ITerminalChatSessionResolver, TerminalChatSessionResolver } from './terminalChatSessionResolver.js';

registerTerminalContribution(TerminalChatController.ID, TerminalChatController, false);
AccessibleViewRegistry.register(new TerminalInlineChatAccessibleView());
AccessibleViewRegistry.register(new TerminalChatAccessibilityHelp());
registerWorkbenchContribution2(TerminalChatEnabler.Id, TerminalChatEnabler, WorkbenchPhase.AfterRestored);

registerSingleton(ITerminalChatService, TerminalChatService, InstantiationType.Delayed);
registerSingleton(ITerminalChatSessionResolver, TerminalChatSessionResolver, InstantiationType.Delayed);
