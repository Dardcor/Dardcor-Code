/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	FunctionComponent,
	PromptComponentChild,
	PromptElement,
	PromptElementProps,
	PromptFragment,
} from '../src/components/components';

function functionComponentFunction(
	type: FunctionComponent,
	props: PromptElementProps,
	key?: string | number
): PromptElement {
	let children: PromptComponentChild[] = [];
	if (Array.isArray(props.children)) {
		children = props.children;
	} else if (props.children) {
		children = [props.children];
	}
	const componentProps = { ...props, children };
	if (key) {
		componentProps.key = key;
	}
	return { type, props: componentProps };
}

function fragmentFunction(children: PromptComponentChild[]): PromptFragment {
	return { type: 'f', children };
}
fragmentFunction.isFragmentFunction = true;

export namespace JSX {
	export interface IntrinsicElements {
		[s: string]: unknown;
	}

	export interface IntrinsicAttributes {
		key?: string | number;
		weight?: number;
		source?: unknown;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export type ElementType<P = any> = FunctionComponent<P>;
	export type Element = PromptElement;

	export interface ElementAttributesProperty {
		props: unknown;
	}

	export interface ElementChildrenAttribute {
		children: unknown;
	}
}

export { fragmentFunction as Fragment, functionComponentFunction as jsx, functionComponentFunction as jsxs };
