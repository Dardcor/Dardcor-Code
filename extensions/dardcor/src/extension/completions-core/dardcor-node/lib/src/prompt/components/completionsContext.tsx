/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//** @jsxRuntime automatic */
/** @jsxImportSource ../../../../prompt/jsx-runtime */

import { PromptElementProps, PromptSnapshotNode } from '../../../../prompt/src/components/components';

export function CompletionsContext(props: PromptElementProps) {
	return props.children;
}

export function StableCompletionsContext(props: PromptElementProps) {
	return props.children;
}

export function AdditionalCompletionsContext(props: PromptElementProps) {
	return props.children;
}

export function isContextNode(node: PromptSnapshotNode): boolean {
	return (
		node.name === CompletionsContext.name ||
		node.name === StableCompletionsContext.name ||
		node.name === AdditionalCompletionsContext.name
	);
}
