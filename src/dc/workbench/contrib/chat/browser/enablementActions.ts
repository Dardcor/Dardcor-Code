/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, IAction } from '../../../../base/common/actions.js';
import { localize } from '../../../../nls.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { ContributionEnablementState, IEnablementModel, isContributionDisabled } from '../common/enablement.js';

export function createEnablementActions(
	key: string,
	enablementModel: IEnablementModel,
	idPrefix: string,
): [enable: Action, enableWorkspace: Action, disable: Action, disableWorkspace: Action] {
	return [
		new Action(`${idPrefix}.enable`, localize('enable', "Enable"), undefined, true,
			() => { enablementModel.setEnabled(key, ContributionEnablementState.EnabledProfile); return Promise.resolve(); }),
		new Action(`${idPrefix}.enableForWorkspace`, localize('enableForWorkspace', "Enable (Workspace)"), undefined, true,
			() => { enablementModel.setEnabled(key, ContributionEnablementState.EnabledWorkspace); return Promise.resolve(); }),
		new Action(`${idPrefix}.disable`, localize('disable', "Disable"), undefined, true,
			() => { enablementModel.setEnabled(key, ContributionEnablementState.DisabledProfile); return Promise.resolve(); }),
		new Action(`${idPrefix}.disableForWorkspace`, localize('disableForWorkspace', "Disable (Workspace)"), undefined, true,
			() => { enablementModel.setEnabled(key, ContributionEnablementState.DisabledWorkspace); return Promise.resolve(); }),
	];
}

export function buildEnablementContextMenuGroup(
	enablementState: ContributionEnablementState,
	key: string,
	enablementModel: IEnablementModel,
	workspaceContextService: IWorkspaceContextService,
	idPrefix: string,
): IAction[] {
	const hasWorkspace = workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
	const [enable, enableWorkspace, disable, disableWorkspace] = createEnablementActions(key, enablementModel, idPrefix);
	const actions: IAction[] = [];
	if (isContributionDisabled(enablementState)) {
		actions.push(enable);
		if (hasWorkspace) {
			actions.push(enableWorkspace);
		}
	} else {
		actions.push(disable);
		if (hasWorkspace) {
			actions.push(disableWorkspace);
		}
	}
	return actions;
}
