/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isAncestorOfActiveElement } from '../../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { Event } from '../../../../../../../base/common/event.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { ChatTodoListWidget } from '../../../../browser/widget/chatContentParts/chatTodoListWidget.js';
import { IChatTodo, IChatTodoListService } from '../../../../common/tools/chatTodoListService.js';

const testSessionUri = URI.parse('chat-session://test/session1');

suite('ChatTodoListWidget Accessibility', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let widget: ChatTodoListWidget;

	const sampleTodos: IChatTodo[] = [
		{ id: 1, title: 'First task', status: 'not-started' },
		{ id: 2, title: 'Second task', status: 'in-progress' },
		{ id: 3, title: 'Third task', status: 'completed' }
	];

	setup(() => {
		const mockTodoListService: IChatTodoListService = {
			_serviceBrand: undefined,
			onDidUpdateTodos: Event.None,
			getTodos: (sessionResource: URI) => sampleTodos,
			setTodos: (sessionResource: URI, todos: IChatTodo[]) => { },
			migrateTodos: (oldSessionResource: URI, newSessionResource: URI) => { }
		};

		const mockConfigurationService = new TestConfigurationService();

		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IChatTodoListService, mockTodoListService);
		instantiationService.stub(IConfigurationService, mockConfigurationService);
		widget = store.add(instantiationService.createInstance(ChatTodoListWidget));
		mainWindow.document.body.appendChild(widget.domNode);
	});

	teardown(() => {
		if (widget.domNode.parentNode) {
			widget.domNode.parentNode.removeChild(widget.domNode);
		}
	});

	test('creates proper semantic list structure', () => {
		widget.render(testSessionUri);

		const todoListContainer = widget.domNode.querySelector('.todo-list-container');
		assert.ok(todoListContainer, 'Should have todo list container');
		assert.strictEqual(todoListContainer?.getAttribute('aria-labelledby'), 'todo-list-title');
		assert.strictEqual(todoListContainer?.getAttribute('role'), 'list');

		const titleElement = widget.domNode.querySelector('#todo-list-title');
		assert.ok(titleElement, 'Should have title element with ID todo-list-title');
		assert.ok(titleElement?.textContent, 'Title should have content');

		const todoItems = todoListContainer?.querySelectorAll('li.todo-item');
		assert.ok(todoItems && todoItems.length > 0, 'Should have todo items in the list container');
	});

	test('todo items have proper accessibility attributes', () => {
		widget.render(testSessionUri);

		const todoItems = widget.domNode.querySelectorAll('.todo-item');
		assert.strictEqual(todoItems.length, 3, 'Should have 3 todo items');

		const firstItem = todoItems[0] as HTMLElement;
		assert.strictEqual(firstItem.getAttribute('role'), 'listitem');
		assert.ok(firstItem.getAttribute('aria-label')?.includes('First task'));
		assert.ok(firstItem.getAttribute('aria-label')?.includes('not started'));

		const secondItem = todoItems[1] as HTMLElement;
		assert.ok(secondItem.getAttribute('aria-label')?.includes('Second task'));
		assert.ok(secondItem.getAttribute('aria-label')?.includes('in progress'));

		const thirdItem = todoItems[2] as HTMLElement;
		assert.ok(thirdItem.getAttribute('aria-label')?.includes('Third task'));
		assert.ok(thirdItem.getAttribute('aria-label')?.includes('completed'));
	});

	test('status icons are hidden from screen readers', () => {
		widget.render(testSessionUri);

		const statusIcons = widget.domNode.querySelectorAll('.todo-status-icon');
		statusIcons.forEach(icon => {
			assert.strictEqual(icon.getAttribute('aria-hidden'), 'true', 'Status icons should be hidden from screen readers');
		});
	});

	test('expand button has proper accessibility attributes', () => {
		widget.render(testSessionUri);

		const expandoContainer = widget.domNode.querySelector('.todo-list-expand');
		assert.ok(expandoContainer, 'Should have expando container');

		const expandoButton = expandoContainer?.querySelector('.monaco-button');
		assert.ok(expandoButton, 'Should have Monaco button');
		assert.strictEqual(expandoButton?.getAttribute('aria-expanded'), 'false');
		assert.strictEqual(expandoButton?.getAttribute('aria-controls'), 'todo-list-container');

		const titleElement = expandoButton?.querySelector('.todo-list-title');
		assert.ok(titleElement, 'Should have title element');
		const titleText = titleElement?.textContent;
		assert.ok(titleText?.includes('(2/3)'), `Title should show progress format, but got: "${titleText}"`);
		assert.ok(titleText?.includes('Second task'), `Title should show current task when collapsed, but got: "${titleText}"`);
	});

	test('todo items have complete aria-label with status information', () => {
		widget.render(testSessionUri);

		const todoItems = widget.domNode.querySelectorAll('.todo-item');
		assert.strictEqual(todoItems.length, 3, 'Should have 3 todo items');

		const firstItem = todoItems[0] as HTMLElement;
		const firstAriaLabel = firstItem.getAttribute('aria-label');
		assert.ok(firstAriaLabel?.includes('First task'), 'First item aria-label should include title');
		assert.ok(firstAriaLabel?.includes('not started'), 'First item aria-label should include status');

		const secondItem = todoItems[1] as HTMLElement;
		const secondAriaLabel = secondItem.getAttribute('aria-label');
		assert.ok(secondAriaLabel?.includes('Second task'), 'Second item aria-label should include title');
		assert.ok(secondAriaLabel?.includes('in progress'), 'Second item aria-label should include status');

		const thirdItem = todoItems[2] as HTMLElement;
		const thirdAriaLabel = thirdItem.getAttribute('aria-label');
		assert.ok(thirdAriaLabel?.includes('Third task'), 'Third item aria-label should include title');
		assert.ok(thirdAriaLabel?.includes('completed'), 'Third item aria-label should include status');
	});

	test('widget displays properly when no todos exist', () => {
		const emptyTodoListService: IChatTodoListService = {
			_serviceBrand: undefined,
			onDidUpdateTodos: Event.None,
			getTodos: (sessionResource: URI) => [],
			setTodos: (sessionResource: URI, todos: IChatTodo[]) => { },
			migrateTodos: (oldSessionResource: URI, newSessionResource: URI) => { }
		};

		const emptyConfigurationService = new TestConfigurationService();

		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IChatTodoListService, emptyTodoListService);
		instantiationService.stub(IConfigurationService, emptyConfigurationService);
		const emptyWidget = store.add(instantiationService.createInstance(ChatTodoListWidget));
		mainWindow.document.body.appendChild(emptyWidget.domNode);

		emptyWidget.render(testSessionUri);

		assert.strictEqual(emptyWidget.domNode.style.display, 'none', 'Widget should be hidden when no todos');
	});

	test('clear button has proper accessibility', () => {
		widget.render(testSessionUri);

		const clearButton = widget.domNode.querySelector('.todo-clear-button-container .monaco-button');
		assert.ok(clearButton, 'Should have clear button');
		assert.strictEqual(clearButton?.getAttribute('tabindex'), '0', 'Clear button should be focusable');
	});

	test('title element displays progress correctly and is accessible', () => {
		widget.render(testSessionUri);

		const titleElement = widget.domNode.querySelector('#todo-list-title');
		assert.ok(titleElement, 'Should have title element with ID');

		const titleText = titleElement?.textContent;
		assert.ok(titleText?.includes('(2/3)'), `Title should show progress format, but got: "${titleText}"`);
		assert.ok(titleText?.includes('Second task'), `Title should show current task when collapsed, but got: "${titleText}"`);

		const todoListContainer = widget.domNode.querySelector('.todo-list-container');
		assert.strictEqual(todoListContainer?.getAttribute('aria-labelledby'), 'todo-list-title');
	});

	test('focus expands and places focus on the todo list', () => {
		widget.render(testSessionUri);

		const expandoButton = widget.domNode.querySelector('.todo-list-expand .monaco-button');
		assert.strictEqual(expandoButton?.getAttribute('aria-expanded'), 'false', 'Todo list should start collapsed');

		const focused = widget.focus();
		assert.strictEqual(focused, true, 'Focus should succeed when todos are present');
		assert.strictEqual(expandoButton?.getAttribute('aria-expanded'), 'true', 'Focus should expand the todo list');

		const todoListContainer = widget.domNode.querySelector('.todo-list-container') as HTMLElement;
		assert.ok(todoListContainer, 'Todo list container should exist');
		assert.ok(isAncestorOfActiveElement(todoListContainer), 'Todo list container should contain the active element after focusing');
	});

	test('hasTodos reports visibility state', () => {
		widget.render(testSessionUri);
		assert.strictEqual(widget.hasTodos(), true, 'Widget should report todos are present');

		const emptyTodoListService: IChatTodoListService = {
			_serviceBrand: undefined,
			onDidUpdateTodos: Event.None,
			getTodos: () => [],
			setTodos: () => { },
			migrateTodos: () => { }
		};
		const emptyConfigurationService = new TestConfigurationService({ 'chat.todoListTool.descriptionField': true });
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IChatTodoListService, emptyTodoListService);
		instantiationService.stub(IConfigurationService, emptyConfigurationService);
		const emptyWidget = store.add(instantiationService.createInstance(ChatTodoListWidget));
		mainWindow.document.body.appendChild(emptyWidget.domNode);

		emptyWidget.render(testSessionUri);
		assert.strictEqual(emptyWidget.hasTodos(), false, 'Widget should report no todos when the list is empty');

		if (emptyWidget.domNode.parentNode) {
			emptyWidget.domNode.parentNode.removeChild(emptyWidget.domNode);
		}
	});
});
