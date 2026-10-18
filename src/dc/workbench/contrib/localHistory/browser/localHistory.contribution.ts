/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './localHistoryCommands.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { LocalHistoryTimeline } from './localHistoryTimeline.js';

registerWorkbenchContribution2(LocalHistoryTimeline.ID, LocalHistoryTimeline, WorkbenchPhase.BlockRestore );
