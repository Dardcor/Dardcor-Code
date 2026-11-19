/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataConsumer, Dispatch, StateUpdater, TypePredicate } from './hooks';
import { TokenizerName } from '../tokenization';
import { CancellationToken } from 'vscode-languageserver-protocol';


export type PromptComponentChild = PromptElement | string | number | undefined;

type PromptComponentChildren = PromptComponentChild[] | PromptComponentChild;

interface PromptAttributes {
	[key: string]: unknown;
	key?: string | number;
	weight?: number;
	source?: unknown;
}

export type PromptElementProps<P = object> = P & Readonly<PromptAttributes & { children?: PromptComponentChildren }>;

export interface ComponentContext {
	useState<S = undefined>(): [S | undefined, Dispatch<StateUpdater<S | undefined>>];
	useState<S>(initialState: S | (() => S)): [S, Dispatch<StateUpdater<S>>];

	useData<T>(typePredicate: TypePredicate<T>, consumer: DataConsumer<T>): void;
}

export interface PromptFragment {
	type: 'f';
	children: PromptComponentChild[];
}

export interface FragmentFunction {
	(children: PromptComponentChildren): PromptFragment;
}

export interface FunctionComponent<P = PromptAttributes> {
	(props: PromptElementProps<P>, context: ComponentContext): PromptComponentChildren;
}

export interface PromptElement<P = PromptAttributes> {
	type: FunctionComponent<P> | FragmentFunction;
	props: P & { children: PromptComponentChildren };
}

export interface PromptSnapshotNodeStatistics {
	updateDataTimeMs?: number;
}

export interface PromptSnapshotNode {
	name: string;
	path: string;
	value?: string;
	props?: PromptElementProps;
	children?: PromptSnapshotNode[];
	statistics: PromptSnapshotNodeStatistics;
}

export interface PromptRenderer<T extends Prompt, P extends PromptRenderOptions> {
	render(snapshot: PromptSnapshotNode, options: P, cancellationToken?: CancellationToken): T;
}

export type PromptMetadata = {
	renderId: number;
	rendererName?: string;
	tokenizer: string;
	elisionTimeMs: number;
	renderTimeMs: number;
	updateDataTimeMs: number;
	componentStatistics: ComponentStatistics[];
};

export type ComponentStatistics = {
	componentPath: string;
	expectedTokens?: number;
	actualTokens?: number;
	updateDataTimeMs?: number;
	source?: unknown;
};

type StatusOk = { status: 'ok' };
export type StatusNotOk = { status: 'cancelled' } | { status: 'error'; error: Error };
export type Status = StatusOk | StatusNotOk;

export type PromptOk = StatusOk & {
	metadata: PromptMetadata;
};
type Prompt = PromptOk | StatusNotOk;

export interface PromptRenderOptions {
	tokenizer?: TokenizerName;
	delimiter?: string;
}

type TextPromptComponentChild = string | number | undefined;
interface TextPromptElementProps extends PromptElementProps {
	children?: TextPromptComponentChild[] | TextPromptComponentChild;
}

export function Text(props: TextPromptElementProps) {
	if (props.children) {
		if (Array.isArray(props.children)) {
			return props.children.join('');
		}

		return props.children;
	}
	return;
}

export function Chunk(props: PromptElementProps) {
	return props.children;
}
