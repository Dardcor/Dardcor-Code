/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIdentityProvider } from '../../../../../base/browser/ui/list/list.js';
import { ObjectTree } from '../../../../../base/browser/ui/tree/objectTree.js';
import { IObjectTreeElement, ObjectTreeElementCollapseState } from '../../../../../base/browser/ui/tree/tree.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { MarshalledId } from '../../../../../base/common/marshallingIds.js';
import { ISerializedTestTreeCollapseState, isCollapsedInSerializedTestTree } from './testingViewState.js';
import { ITestItemContext, InternalTestItem, TestItemExpandState, TestResultState } from '../../common/testTypes.js';

export interface ITestTreeProjection extends IDisposable {
	readonly onUpdate: Event<void>;

	lastState: ISerializedTestTreeCollapseState;

	expandElement(element: TestItemTreeElement, depth: number): void;

	getElementByTestId(testId: string): TestItemTreeElement | undefined;

	applyTo(tree: ObjectTree<TestExplorerTreeElement, FuzzyScore>): void;
}

let idCounter = 0;

const getId = () => String(idCounter++);

export abstract class TestItemTreeElement {
	protected readonly changeEmitter = new Emitter<void>();

	public readonly onChange = this.changeEmitter.event;

	public readonly children = new Set<TestExplorerTreeElement>();

	public readonly treeId = getId();

	public depth: number;

	public retired = false;

	public state = TestResultState.Unset;

	public duration: number | undefined;

	public abstract description: string | null;

	constructor(
		public readonly test: InternalTestItem,
		public readonly parent: TestItemTreeElement | null = null,
	) {
		this.depth = parent ? parent.depth + 1 : 0;
	}

	public toJSON() {
		if (this.depth === 0) {
			return { controllerId: this.test.controllerId };
		}

		const context: ITestItemContext = {
			$mid: MarshalledId.TestItemContext,
			tests: [InternalTestItem.serialize(this.test)],
		};

		for (let p = this.parent; p && p.depth > 0; p = p.parent) {
			context.tests.unshift(InternalTestItem.serialize(p.test));
		}

		return context;
	}
}

export class TestTreeErrorMessage {
	public readonly treeId = getId();
	public readonly children = new Set<never>();

	public get description() {
		return typeof this.message === 'string' ? this.message : this.message.value;
	}

	constructor(
		public readonly message: string | IMarkdownString,
		public readonly parent: TestExplorerTreeElement,
	) { }
}

export type TestExplorerTreeElement = TestItemTreeElement | TestTreeErrorMessage;

export const testIdentityProvider: IIdentityProvider<TestExplorerTreeElement> = {
	getId(element) {
		const expandComponent = element instanceof TestTreeErrorMessage
			? 'error'
			: element.test.expand === TestItemExpandState.NotExpandable
				? !!element.children.size
				: element.test.expand;

		return element.treeId + '\0' + expandComponent;
	}
};

export const getChildrenForParent = (serialized: ISerializedTestTreeCollapseState, rootsWithChildren: Iterable<TestExplorerTreeElement>, node: TestExplorerTreeElement | null): Iterable<IObjectTreeElement<TestExplorerTreeElement>> => {
	let it: Iterable<TestExplorerTreeElement>;
	if (node === null) {
		const rootsWithChildrenArr = [...rootsWithChildren];
		if (rootsWithChildrenArr.length === 1) {
			return getChildrenForParent(serialized, rootsWithChildrenArr, rootsWithChildrenArr[0]);
		}
		it = rootsWithChildrenArr;
	} else {
		it = node.children;
	}

	return Iterable.map(it, element => (
		element instanceof TestTreeErrorMessage
			? { element }
			: {
				element,
				collapsible: element.test.expand !== TestItemExpandState.NotExpandable,
				collapsed: element.test.item.error
					? ObjectTreeElementCollapseState.PreserveOrExpanded
					: (isCollapsedInSerializedTestTree(serialized, element.test.item.extId) ?? element.depth > 0
						? ObjectTreeElementCollapseState.PreserveOrCollapsed
						: ObjectTreeElementCollapseState.PreserveOrExpanded),
				children: getChildrenForParent(serialized, rootsWithChildren, element),
			}
	));
};
