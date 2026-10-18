/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { timeout } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { HoverService } from '../../browser/hoverService.js';
import { IHoverService, WorkbenchHoverDelegate } from '../../browser/hover.js';
import { HoverWidget } from '../../browser/hoverWidget.js';
import { IContextMenuService } from '../../../contextview/browser/contextView.js';
import { IKeybindingService } from '../../../keybinding/common/keybinding.js';
import { ILayoutService } from '../../../layout/browser/layoutService.js';
import { IAccessibilityService } from '../../../accessibility/common/accessibility.js';
import { TestAccessibilityService } from '../../../accessibility/test/common/testAccessibilityService.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { NoMatchingKb } from '../../../keybinding/common/keybindingResolver.js';
import { IMarkdownRendererService } from '../../../markdown/browser/markdownRenderer.js';
import type { IHoverWidget } from '../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { AnchorAlignment } from '../../../../base/common/layout.js';

suite('HoverService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let hoverService: HoverService;
	let fixture: HTMLElement;
	let instantiationService: TestInstantiationService;

	setup(() => {
		fixture = document.createElement('div');
		mainWindow.document.body.appendChild(fixture);
		store.add(toDisposable(() => fixture.remove()));

		instantiationService = store.add(new TestInstantiationService());

		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('workbench.hover.delay', 0);
		configurationService.setUserConfiguration('workbench.hover.reducedDelay', 0);
		instantiationService.stub(IConfigurationService, configurationService);

		instantiationService.stub(IContextMenuService, {
			onDidShowContextMenu: Event.None
		});

		instantiationService.stub(IKeybindingService, {
			mightProducePrintableCharacter() { return false; },
			softDispatch() { return NoMatchingKb; },
			resolveKeyboardEvent() {
				return {
					getLabel() { return ''; },
					getAriaLabel() { return ''; },
					getElectronAccelerator() { return null; },
					getUserSettingsLabel() { return null; },
					isWYSIWYG() { return false; },
					hasMultipleChords() { return false; },
					getDispatchChords() { return [null]; },
					getSingleModifierDispatchChords() { return []; },
					getChords() { return []; }
				};
			}
		});

		instantiationService.stub(ILayoutService, {
			activeContainer: fixture,
			mainContainer: fixture,
			getContainer() { return fixture; },
			onDidLayoutContainer: Event.None
		});

		instantiationService.stub(IAccessibilityService, new TestAccessibilityService());

		instantiationService.stub(IMarkdownRendererService, {
			render() { return { element: document.createElement('div'), dispose() { } }; },
			setDefaultCodeBlockRenderer() { }
		});

		hoverService = store.add(instantiationService.createInstance(HoverService));
		instantiationService.stub(IHoverService, hoverService);
	});


	function createTarget(): HTMLElement {
		const target = document.createElement('div');
		target.style.width = '100px';
		target.style.height = '100px';
		fixture.appendChild(target);
		return target;
	}

	function showHover(content: string, target?: HTMLElement, options?: Partial<Parameters<typeof hoverService.showInstantHover>[0]>): IHoverWidget {
		const hover = hoverService.showInstantHover({
			content,
			target: target ?? createTarget(),
			...options
		});
		assert.ok(hover, `Hover with content "${content}" should be created`);
		return hover;
	}

	function asHoverWidget(hover: IHoverWidget): HoverWidget {
		return hover as HoverWidget;
	}

	function isInDOM(hover: IHoverWidget): boolean {
		return mainWindow.document.body.contains(asHoverWidget(hover).domNode);
	}

	function assertInDOM(hover: IHoverWidget, message?: string): void {
		assert.ok(isInDOM(hover), message ?? 'Hover should be in the DOM');
	}

	function assertNotInDOM(hover: IHoverWidget, message?: string): void {
		assert.ok(!isInDOM(hover), message ?? 'Hover should not be in the DOM');
	}

	function createNestedHover(parentHover: IHoverWidget, content: string): IHoverWidget {
		const nestedTarget = document.createElement('div');
		asHoverWidget(parentHover).domNode.appendChild(nestedTarget);
		return showHover(content, nestedTarget);
	}

	function createHoverChain(depth: number): HoverWidget[] {
		const hovers: HoverWidget[] = [];
		let currentTarget: HTMLElement = createTarget();

		for (let i = 0; i < depth; i++) {
			const hover = hoverService.showInstantHover({
				content: `Hover ${i + 1}`,
				target: currentTarget
			});
			if (!hover) {
				break;
			}
			hovers.push(asHoverWidget(hover));
			currentTarget = document.createElement('div');
			asHoverWidget(hover).domNode.appendChild(currentTarget);
		}

		return hovers;
	}

	function disposeHovers(hovers: HoverWidget[]): void {
		for (const h of [...hovers].reverse()) {
			h?.dispose();
		}
	}


	suite('showInstantHover', () => {
		test('should not show hover with empty content', () => {
			const target = createTarget();
			const hover = hoverService.showInstantHover({
				content: '',
				target
			});

			assert.strictEqual(hover, undefined, 'Hover should not be created for empty content');
		});

		test('should align the right edge of a hover with its target', () => {
			const target = createTarget();
			target.getBoundingClientRect = () => new DOMRect(300, 100, 100, 20);
			const hover = showHover('Right aligned hover', target, {
				position: {
					hoverPosition: HoverPosition.BELOW,
					anchorAlignment: AnchorAlignment.RIGHT,
				},
				appearance: { showPointer: true }
			});
			const hoverWidget = asHoverWidget(hover);
			Object.defineProperty(hoverWidget.domNode, 'clientWidth', { configurable: true, value: 200 });

			hoverWidget.layout();

			assert.strictEqual(hoverWidget.x, 198);
			hover.dispose();
		});

		test('should constrain a right-aligned hover to the available width', () => {
			const target = createTarget();
			let targetLeft = 100;
			target.getBoundingClientRect = () => new DOMRect(targetLeft, 100, 50, 20);
			const hover = showHover('Constrained right aligned hover', target, {
				position: {
					hoverPosition: HoverPosition.BELOW,
					anchorAlignment: AnchorAlignment.RIGHT,
				},
				appearance: { showPointer: true }
			});
			const hoverWidget = asHoverWidget(hover);
			Object.defineProperty(hoverWidget.domNode, 'clientWidth', {
				configurable: true,
				get: () => Math.min(200, Number.parseFloat(hoverWidget.domNode.style.maxWidth) || 200)
			});

			hoverWidget.layout();
			const constrainedMaxWidth = hoverWidget.domNode.style.maxWidth;
			targetLeft = 300;
			hoverWidget.layout();

			assert.deepStrictEqual({
				constrainedMaxWidth,
				restoredMaxWidth: hoverWidget.domNode.style.maxWidth
			}, {
				constrainedMaxWidth: '146px',
				restoredMaxWidth: ''
			});
			hover.dispose();
		});

		test('should call onDidShow callback when hover is shown', () => {
			const target = createTarget();
			let didShowCalled = false;

			const hover = hoverService.showInstantHover({
				content: 'Test',
				target,
				onDidShow: () => { didShowCalled = true; }
			});

			assert.ok(didShowCalled, 'onDidShow should be called');
			assert.ok(hover);
			assertInDOM(hover, 'Hover should be in DOM after showing');

			hover.dispose();
			assertNotInDOM(hover, 'Hover should be removed from DOM after dispose');
		});

		test('should call onDidHide exactly once when hover is disposed', () => {
			const target = createTarget();
			let didHideCount = 0;

			const hover = hoverService.showInstantHover({
				content: 'Test',
				target,
				onDidHide: () => { didHideCount++; }
			});

			assert.ok(hover);
			hover.dispose();
			hover.dispose();

			assert.strictEqual(didHideCount, 1);
		});

		test('should call onDidHide when hover is hidden during onDidShow', () => {
			const target = createTarget();
			const calls: string[] = [];

			hoverService.showInstantHover({
				content: 'Test',
				target,
				onDidShow: () => {
					calls.push('show');
					hoverService.hideHover(true);
				},
				onDidHide: () => { calls.push('hide'); }
			});

			assert.deepStrictEqual(calls, ['show', 'hide']);
		});

		test('should deduplicate hovers by id', () => {
			const target = createTarget();

			const hover1 = hoverService.showInstantHover({
				content: 'Same content',
				target,
				id: 'same-id'
			});

			const hover2 = hoverService.showInstantHover({
				content: 'Same content',
				target,
				id: 'same-id'
			});

			assert.ok(hover1, 'First hover should be created');
			assertInDOM(hover1, 'First hover should be in DOM');
			assert.strictEqual(hover2, undefined, 'Second hover with same id should not be created');

			const hover3 = hoverService.showInstantHover({
				content: 'Content 3',
				target,
				id: 'different-id'
			});

			assert.ok(hover3, 'Hover with different id should be created');
			assertInDOM(hover3, 'Third hover should be in DOM');

			hover1?.dispose();
			hover3?.dispose();
		});

		test('should apply additional classes to hover DOM', () => {
			const hover = showHover('Test', undefined, {
				additionalClasses: ['custom-class-1', 'custom-class-2']
			});

			const domNode = asHoverWidget(hover).domNode;
			assertInDOM(hover, 'Hover should be in DOM');
			assert.ok(domNode.classList.contains('custom-class-1'), 'Should have custom-class-1');
			assert.ok(domNode.classList.contains('custom-class-2'), 'Should have custom-class-2');

			hover.dispose();
			assertNotInDOM(hover, 'Hover should be removed from DOM after dispose');
		});
	});

	suite('hideHover', () => {
		test('should hide non-locked hover', () => {
			const hover = showHover('Test');
			assertInDOM(hover, 'Hover should be in DOM initially');

			hoverService.hideHover();

			assert.strictEqual(hover.isDisposed, true, 'Hover should be disposed after hideHover');
			assertNotInDOM(hover, 'Hover should be removed from DOM after hideHover');
		});

		test('should not hide locked hover without force flag', () => {
			const hover = showHover('Test', undefined, {
				persistence: { sticky: true }
			});
			assertInDOM(hover, 'Locked hover should be in DOM');

			hoverService.hideHover();
			assert.strictEqual(hover.isDisposed, false, 'Locked hover should not be disposed without force');
			assertInDOM(hover, 'Locked hover should remain in DOM');

			hoverService.hideHover(true);
			assert.strictEqual(hover.isDisposed, true, 'Locked hover should be disposed with force=true');
			assertNotInDOM(hover, 'Locked hover should be removed from DOM with force');
		});
	});

	suite('nested hovers', () => {
		test('should keep parent hover visible when nested hover is created', () => {
			const parentHover = showHover('Parent');
			assertInDOM(parentHover, 'Parent hover should be in DOM');

			const nestedHover = createNestedHover(parentHover, 'Nested');
			assertInDOM(nestedHover, 'Nested hover should be in DOM');
			assertInDOM(parentHover, 'Parent hover should still be in DOM after nested hover created');

			assert.strictEqual(parentHover.isDisposed, false, 'Parent hover should remain visible');
			assert.strictEqual(nestedHover.isDisposed, false, 'Nested hover should be visible');

			nestedHover.dispose();
			assertNotInDOM(nestedHover, 'Nested hover should be removed from DOM after dispose');
			assertInDOM(parentHover, 'Parent hover should remain in DOM after nested is disposed');

			parentHover.dispose();
			assertNotInDOM(parentHover, 'Parent hover should be removed from DOM after dispose');
		});

		test('should dispose nested hover when parent is disposed', () => {
			const parentHover = showHover('Parent');
			const nestedHover = createNestedHover(parentHover, 'Nested');

			assertInDOM(parentHover, 'Parent hover should be in DOM');
			assertInDOM(nestedHover, 'Nested hover should be in DOM');

			parentHover.dispose();

			assert.strictEqual(nestedHover.isDisposed, true, 'Nested hover should be disposed when parent is disposed');
			assertNotInDOM(parentHover, 'Parent hover should be removed from DOM');
			assertNotInDOM(nestedHover, 'Nested hover should be removed from DOM when parent is disposed');
		});

		test('should dispose entire hover chain when root is disposed', () => {
			const hovers = createHoverChain(3);
			assert.strictEqual(hovers.length, 3, 'Should create 3 hovers');

			for (let i = 0; i < hovers.length; i++) {
				assert.ok(mainWindow.document.body.contains(hovers[i].domNode), `Hover ${i + 1} should be in DOM`);
			}

			hovers[0].dispose();

			for (let i = 0; i < hovers.length; i++) {
				assert.strictEqual(hovers[i].isDisposed, true, `Hover ${i + 1} should be disposed`);
				assert.ok(!mainWindow.document.body.contains(hovers[i].domNode), `Hover ${i + 1} should be removed from DOM`);
			}
		});

		test('should dispose only nested hovers when middle hover is disposed', () => {
			const hovers = createHoverChain(3);
			assert.strictEqual(hovers.length, 3, 'Should create 3 hovers');

			for (const h of hovers) {
				assert.ok(mainWindow.document.body.contains(h.domNode), 'All hovers should be in DOM initially');
			}

			hovers[1].dispose();

			assert.strictEqual(hovers[0].isDisposed, false, 'Root hover should remain');
			assert.ok(mainWindow.document.body.contains(hovers[0].domNode), 'Root hover should remain in DOM');

			assert.strictEqual(hovers[1].isDisposed, true, 'Middle hover should be disposed');
			assert.ok(!mainWindow.document.body.contains(hovers[1].domNode), 'Middle hover should be removed from DOM');

			assert.strictEqual(hovers[2].isDisposed, true, 'Innermost hover should be disposed');
			assert.ok(!mainWindow.document.body.contains(hovers[2].domNode), 'Innermost hover should be removed from DOM');

			hovers[0].dispose();
		});

		test('should enforce maximum nesting depth', () => {
			const hovers = createHoverChain(3);
			assert.strictEqual(hovers.length, 3, 'Should create exactly 3 hovers (max depth)');

			for (const h of hovers) {
				assert.ok(mainWindow.document.body.contains(h.domNode), 'Hover should be in DOM');
			}

			const nestedTarget = document.createElement('div');
			hovers[2].domNode.appendChild(nestedTarget);
			const fourthHover = hoverService.showInstantHover({
				content: 'Hover 4',
				target: nestedTarget
			});

			assert.strictEqual(fourthHover, undefined, 'Fourth hover should not be created due to max nesting depth');

			disposeHovers(hovers);
		});

		test('should allow new hover chain after disposing previous chain', () => {
			const firstChain = createHoverChain(3);
			for (const h of firstChain) {
				assert.ok(mainWindow.document.body.contains(h.domNode), 'First chain hover should be in DOM');
			}
			disposeHovers(firstChain);
			for (const h of firstChain) {
				assert.ok(!mainWindow.document.body.contains(h.domNode), 'First chain hover should be removed from DOM');
			}

			const secondChain = createHoverChain(3);
			assert.strictEqual(secondChain.length, 3, 'Should create new chain after disposing previous');
			for (const h of secondChain) {
				assert.ok(mainWindow.document.body.contains(h.domNode), 'Second chain hover should be in DOM');
			}

			disposeHovers(secondChain);
		});

		test('hideHover should close innermost hover first', () => {
			const hovers = createHoverChain(2);

			assert.ok(mainWindow.document.body.contains(hovers[0].domNode), 'Outer hover should be in DOM');
			assert.ok(mainWindow.document.body.contains(hovers[1].domNode), 'Inner hover should be in DOM');

			hoverService.hideHover();

			assert.strictEqual(hovers[1].isDisposed, true, 'Innermost hover should be disposed');
			assert.ok(!mainWindow.document.body.contains(hovers[1].domNode), 'Innermost hover should be removed from DOM');
			assert.strictEqual(hovers[0].isDisposed, false, 'Outer hover should remain');
			assert.ok(mainWindow.document.body.contains(hovers[0].domNode), 'Outer hover should remain in DOM');

			hoverService.hideHover();

			assert.strictEqual(hovers[0].isDisposed, true, 'Outer hover should be disposed on second call');
			assert.ok(!mainWindow.document.body.contains(hovers[0].domNode), 'Outer hover should be removed from DOM');
		});
	});

	suite('setupDelayedHover', () => {
		test('should evaluate function options on mouseover', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			let callCount = 0;

			const disposable = hoverService.setupDelayedHover(target, () => {
				callCount++;
				return { content: `Call ${callCount}` };
			});

			target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(callCount, 1, 'Options function should be called on first mouseover');

			await timeout(0);
			hoverService.hideHover(true);

			target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(callCount, 2, 'Options function should be called on second mouseover');

			await timeout(0);
			disposable.dispose();
			hoverService.hideHover(true);
		}));

		test('should not call onDidHide when delayed hover is never shown', () => {
			const target = createTarget();
			let didHideCount = 0;

			const disposable = hoverService.setupDelayedHover(target, {
				content: 'Test',
				onDidHide: () => { didHideCount++; }
			});

			disposable.dispose();

			assert.strictEqual(didHideCount, 0);
		});

		test('should use reduced delay when reducedDelay is true', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();

			(instantiationService.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('workbench.hover.reducedDelay', 150);

			const disposable = hoverService.setupDelayedHover(target, { content: 'Reduced delay' }, { reducedDelay: true });

			target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

			await timeout(75);
			const hoversBefore = mainWindow.document.querySelectorAll('.monaco-hover');
			assert.strictEqual(hoversBefore.length, 0, 'Hover should not be visible before delay completes');

			await timeout(150);
			const hoversAfter = mainWindow.document.querySelectorAll('.monaco-hover');
			assert.strictEqual(hoversAfter.length, 1, 'Hover should be visible after reduced delay');

			disposable.dispose();
			hoverService.hideHover(true);
		}));
	});

	suite('setupManagedHover', () => {
		test('should use native title attribute when showNativeHover is true', () => {
			const target = createTarget();
			const hover = hoverService.setupManagedHover(
				{ showHover: () => undefined, delay: 0, showNativeHover: true },
				target,
				'Native hover content'
			);

			assert.strictEqual(target.getAttribute('title'), 'Native hover content');

			hover.dispose();

			assert.strictEqual(target.getAttribute('title'), null, 'Title should be removed on dispose');
		});

		test('should update content dynamically', async () => {
			const target = createTarget();
			const hover = hoverService.setupManagedHover(
				{ showHover: () => undefined, delay: 0, showNativeHover: true },
				target,
				'Initial'
			);

			assert.strictEqual(target.getAttribute('title'), 'Initial');

			await hover.update('Updated');
			assert.strictEqual(target.getAttribute('title'), 'Updated');

			await hover.update('Final');
			assert.strictEqual(target.getAttribute('title'), 'Final');

			hover.dispose();
		});

		test('should not re-show hover on focus when relatedTarget is from a dismissed hover', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const delegate = store.add(instantiationService.createInstance(WorkbenchHoverDelegate, 'element', undefined, {}));
			store.add(hoverService.setupManagedHover(delegate, target, 'Test'));

			target.dispatchEvent(new FocusEvent('focus', { bubbles: true, relatedTarget: document.body }));
			await timeout(500);
			const hoversBefore = fixture.querySelectorAll('.monaco-hover');
			assert.ok(hoversBefore.length > 0, 'Hover should be visible after focus');

			hoverService.hideHover(true);
			await timeout(0);

			const hoverElement = document.createElement('div');
			hoverElement.classList.add('monaco-hover');
			target.dispatchEvent(new FocusEvent('focus', { bubbles: true, relatedTarget: hoverElement }));
			await timeout(500);

			const hoversAfter = fixture.querySelectorAll('.monaco-hover');
			assert.strictEqual(hoversAfter.length, 0, 'Hover should not re-show when focus comes from dismissed hover');
		}));

		test('should not re-show hover on focus when relatedTarget is null (window reactivation)', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const delegate = store.add(instantiationService.createInstance(WorkbenchHoverDelegate, 'element', undefined, {}));
			store.add(hoverService.setupManagedHover(delegate, target, 'Test'));

			target.dispatchEvent(new FocusEvent('focus', { bubbles: true, relatedTarget: document.body }));
			await timeout(500);
			hoverService.hideHover(true);
			await timeout(0);

			target.dispatchEvent(new FocusEvent('focus', { bubbles: true, relatedTarget: null }));
			await timeout(500);

			const hovers = fixture.querySelectorAll('.monaco-hover');
			assert.strictEqual(hovers.length, 0, 'Hover should not re-show on window reactivation');
		}));
	});

	suite('showDelayedHover', () => {
		test('should reject hover when current hover is locked and target is outside', () => {
			const lockedHover = showHover('Locked', undefined, {
				persistence: { sticky: true }
			});
			assertInDOM(lockedHover, 'Locked hover should be in DOM');

			const otherTarget = createTarget();
			const rejectedHover = hoverService.showDelayedHover({
				content: 'Should not show',
				target: otherTarget
			}, {});

			assert.strictEqual(rejectedHover, undefined, 'Should reject hover when locked hover exists');
			assertInDOM(lockedHover, 'Locked hover should remain in DOM after rejection');

			lockedHover.dispose();
			assertNotInDOM(lockedHover, 'Locked hover should be removed from DOM after dispose');
		});

		test('should use reduced delay when reducedDelay is true', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const reducedDelay = 100;

			(instantiationService.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('workbench.hover.reducedDelay', reducedDelay);

			const hover = hoverService.showDelayedHover({
				content: 'Reduced delay hover',
				target
			}, { reducedDelay: true });

			assert.ok(hover, 'Hover should be created');
			assertNotInDOM(hover, 'Hover should not be visible immediately');

			await timeout(reducedDelay / 2);
			assertNotInDOM(hover, 'Hover should not be visible before delay completes');

			await timeout(reducedDelay);
			assertInDOM(hover, 'Hover should be visible after reduced delay');

			hover.dispose();
		}));

		test('should use default delay when custom delay is undefined', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const hover = hoverService.showDelayedHover({
				content: 'Default delay hover',
				target
			}, {});

			assert.ok(hover, 'Hover should be created');

			await timeout(0);
			assertInDOM(hover, 'Hover should be visible with default delay');

			hover.dispose();
		}));
	});

	suite('hover locking', () => {
		test('isLocked should be settable on hover widget', () => {
			const hover = showHover('Test');
			const widget = asHoverWidget(hover);
			assertInDOM(hover, 'Hover should be in DOM');

			assert.strictEqual(widget.isLocked, false, 'Should not be locked initially');

			widget.isLocked = true;
			assert.strictEqual(widget.isLocked, true, 'Should be locked after setting');
			assertInDOM(hover, 'Hover should remain in DOM after locking');

			widget.isLocked = false;
			assert.strictEqual(widget.isLocked, false, 'Should be unlocked after unsetting');

			hover.dispose();
			assertNotInDOM(hover, 'Hover should be removed from DOM after dispose');
		});

		test('sticky option should set isLocked to true', () => {
			const hover = showHover('Test', undefined, {
				persistence: { sticky: true }
			});
			assertInDOM(hover, 'Sticky hover should be in DOM');

			assert.strictEqual(asHoverWidget(hover).isLocked, true, 'Should be locked when sticky');

			hover.dispose();
			assertNotInDOM(hover, 'Sticky hover should be removed from DOM after dispose');
		});
	});

	suite('showAndFocusLastHover', () => {
		test('should recreate last disposed hover', () => {
			const target = createTarget();
			const hover = hoverService.showInstantHover({
				content: 'Remember me',
				target
			});
			assert.ok(hover);
			assertInDOM(hover, 'Initial hover should be in DOM');

			hover.dispose();
			assertNotInDOM(hover, 'Hover should be removed from DOM after dispose');

			hoverService.showAndFocusLastHover();

			const hoverElements = mainWindow.document.querySelectorAll('.monaco-hover');
			assert.ok(hoverElements.length > 0, 'A hover should be recreated and in the DOM');

			hoverService.hideHover(true);

			const remainingHovers = mainWindow.document.querySelectorAll('.monaco-hover');
			assert.strictEqual(remainingHovers.length, 0, 'No hovers should remain in DOM after cleanup');
		});
	});

	suite('layout and resize', () => {
		test('layout should suppress pending mouseout so content resize does not dismiss hover', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const content = document.createElement('div');
			content.textContent = 'Resizable content';

			const hover = hoverService.showInstantHover({
				content,
				target
			});
			assert.ok(hover);
			assertInDOM(hover, 'Hover should be in DOM');

			const widget = asHoverWidget(hover);

			widget.domNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

			widget.layout();

			await timeout(300);

			assertInDOM(hover, 'Hover should remain in DOM after layout suppresses mouseout');

			hover.dispose();
			assertNotInDOM(hover, 'Hover should be removed from DOM after dispose');
		}));

		test.skip('hover should still dismiss on mouseout when no layout occurs', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const content = document.createElement('div');
			content.textContent = 'Content';

			const hover = hoverService.showInstantHover({
				content,
				target
			});
			assert.ok(hover);
			assertInDOM(hover, 'Hover should be in DOM');

			const widget = asHoverWidget(hover);

			widget.domNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

			await timeout(300);

			assertNotInDOM(hover, 'Hover should be dismissed after mouseout without layout');
		}));

		test.skip('suppression clears after mouse re-enters and a new mouseleave dismisses normally', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const content = document.createElement('div');
			content.textContent = 'Resizable content';

			const hover = hoverService.showInstantHover({
				content,
				target
			});
			assert.ok(hover);
			assertInDOM(hover, 'Hover should be in DOM');

			const widget = asHoverWidget(hover);

			widget.domNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
			widget.layout();
			await timeout(300);
			assertInDOM(hover, 'Hover should remain after suppressed mouseout');

			widget.domNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

			widget.domNode.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
			await timeout(300);

			assertNotInDOM(hover, 'Hover should dismiss on normal mouseout after suppression was cleared');
		}));

		test('clicking outside should dismiss non-sticky hover', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
			const target = createTarget();
			const content = document.createElement('div');
			content.textContent = 'Content';

			const hover = hoverService.showInstantHover({
				content,
				target
			});
			assert.ok(hover);
			assertInDOM(hover, 'Hover should be in DOM');

			document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

			assertNotInDOM(hover, 'Non-sticky hover should be dismissed after clicking outside');
		}));
	});
});
