/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FLOATING_PANEL_INNER_MARGIN, FLOATING_PANEL_MARGIN, getFloatingEditorVerticalMargins, getFloatingOuterEdgeOwners, getFloatingPaneCompositeVerticalMargins, getFloatingSidebarSiblingToEditorStatus, isFloatingTopEdgeExposed, type PanelAlignment, Parts, Position } from '../../browser/layoutService.js';
import { TestLayoutService } from '../../../../test/browser/workbenchTestServices.js';

suite('LayoutService - isFloatingTopEdgeExposed', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class VisibilityLayoutService extends TestLayoutService {
		visibleParts = new Set<Parts>();
		override isVisible(part: Parts): boolean { return this.visibleParts.has(part); }
	}

	function topEdgeExposed(visible: Parts[]): boolean {
		const service = new VisibilityLayoutService();
		service.visibleParts = new Set(visible);
		return isFloatingTopEdgeExposed(service, mainWindow);
	}

	test('exposed only when both the title bar and the banner are hidden', () => {
		const actual = {
			bothHidden: topEdgeExposed([]),
			titleBarVisible: topEdgeExposed([Parts.TITLEBAR_PART]),
			bannerVisible: topEdgeExposed([Parts.BANNER_PART]),
			bothVisible: topEdgeExposed([Parts.TITLEBAR_PART, Parts.BANNER_PART]),
		};

		assert.deepStrictEqual(actual, {
			bothHidden: true,
			titleBarVisible: false,
			bannerVisible: false,
			bothVisible: false,
		});
	});
});

suite('LayoutService - floating panel spacing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses a 6px inter-card gap', () => {
		assert.deepStrictEqual({
			leadingMargin: FLOATING_PANEL_MARGIN,
			trailingMargin: FLOATING_PANEL_INNER_MARGIN,
			gap: FLOATING_PANEL_MARGIN + FLOATING_PANEL_INNER_MARGIN,
		}, {
			leadingMargin: 4,
			trailingMargin: 2,
			gap: 6,
		});
	});
});

suite('LayoutService - getFloatingOuterEdgeOwners', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class ConfigurableLayoutService extends TestLayoutService {
		floatingPanelsEnabled = true;
		sideBarPosition = Position.LEFT;
		panelPosition = Position.BOTTOM;
		visibleParts = new Set<Parts>();

		override isFloatingPanelsEnabled(): boolean { return this.floatingPanelsEnabled; }
		override getSideBarPosition(): Position { return this.sideBarPosition; }
		override getPanelPosition(): Position { return this.panelPosition; }
		override isVisible(part: Parts): boolean { return this.visibleParts.has(part); }
	}

	function owners(configure: (service: ConfigurableLayoutService) => void): { left: Parts | undefined; right: Parts | undefined } {
		const service = new ConfigurableLayoutService();
		configure(service);
		return getFloatingOuterEdgeOwners(service);
	}

	test('edge ownership across layouts', () => {
		const actual = {
			disabled: owners(s => { s.floatingPanelsEnabled = false; s.visibleParts = new Set([Parts.AUXILIARYBAR_PART]); }),

			defaultFull: owners(s => { s.visibleParts = new Set([Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.EDITOR_PART, Parts.AUXILIARYBAR_PART]); }),

			maximizedAuxWithActivityBar: owners(s => { s.visibleParts = new Set([Parts.ACTIVITYBAR_PART, Parts.AUXILIARYBAR_PART]); }),

			maximizedAuxNoActivityBar: owners(s => { s.visibleParts = new Set([Parts.AUXILIARYBAR_PART]); }),

			maximizedAuxNoActivityBarSideBarRight: owners(s => { s.sideBarPosition = Position.RIGHT; s.visibleParts = new Set([Parts.AUXILIARYBAR_PART]); }),

			editorOnly: owners(s => { s.visibleParts = new Set([Parts.EDITOR_PART]); }),

			verticalPanelFull: owners(s => { s.panelPosition = Position.LEFT; s.visibleParts = new Set([Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.PANEL_PART, Parts.EDITOR_PART, Parts.AUXILIARYBAR_PART]); }),

			maximizedVerticalPanel: owners(s => { s.panelPosition = Position.LEFT; s.visibleParts = new Set([Parts.PANEL_PART]); }),

			horizontalPanelVisible: owners(s => { s.panelPosition = Position.BOTTOM; s.visibleParts = new Set([Parts.SIDEBAR_PART, Parts.EDITOR_PART, Parts.PANEL_PART, Parts.AUXILIARYBAR_PART]); }),
		};

		assert.deepStrictEqual(actual, {
			disabled: { left: undefined, right: undefined },
			defaultFull: { left: undefined, right: Parts.AUXILIARYBAR_PART },
			maximizedAuxWithActivityBar: { left: undefined, right: Parts.AUXILIARYBAR_PART },
			maximizedAuxNoActivityBar: { left: Parts.AUXILIARYBAR_PART, right: Parts.AUXILIARYBAR_PART },
			maximizedAuxNoActivityBarSideBarRight: { left: Parts.AUXILIARYBAR_PART, right: Parts.AUXILIARYBAR_PART },
			editorOnly: { left: Parts.EDITOR_PART, right: Parts.EDITOR_PART },
			verticalPanelFull: { left: undefined, right: Parts.AUXILIARYBAR_PART },
			maximizedVerticalPanel: { left: Parts.PANEL_PART, right: Parts.PANEL_PART },
			horizontalPanelVisible: { left: Parts.SIDEBAR_PART, right: Parts.AUXILIARYBAR_PART },
		});
	});
});

suite('LayoutService - getFloatingSidebarSiblingToEditorStatus', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class SiblingStatusLayoutService extends TestLayoutService {
		sideBarPosition = Position.LEFT;
		panelAlignment: PanelAlignment = 'center';

		override getSideBarPosition(): Position { return this.sideBarPosition; }
		override getPanelAlignment(): PanelAlignment { return this.panelAlignment; }
	}

	function siblingStatus(configure: (s: SiblingStatusLayoutService) => void): { sideBar: boolean; auxBar: boolean } {
		const s = new SiblingStatusLayoutService();
		configure(s);
		return getFloatingSidebarSiblingToEditorStatus(s);
	}

	test('sibling-to-editor status across alignment and sidebar-position combinations', () => {
		const actual = {
			centerLeft: siblingStatus(s => { s.sideBarPosition = Position.LEFT; s.panelAlignment = 'center'; }),
			centerRight: siblingStatus(s => { s.sideBarPosition = Position.RIGHT; s.panelAlignment = 'center'; }),
			justifyLeft: siblingStatus(s => { s.sideBarPosition = Position.LEFT; s.panelAlignment = 'justify'; }),
			justifyRight: siblingStatus(s => { s.sideBarPosition = Position.RIGHT; s.panelAlignment = 'justify'; }),
			leftAlignSidebarLeft: siblingStatus(s => { s.sideBarPosition = Position.LEFT; s.panelAlignment = 'left'; }),
			leftAlignSidebarRight: siblingStatus(s => { s.sideBarPosition = Position.RIGHT; s.panelAlignment = 'left'; }),
			rightAlignSidebarLeft: siblingStatus(s => { s.sideBarPosition = Position.LEFT; s.panelAlignment = 'right'; }),
			rightAlignSidebarRight: siblingStatus(s => { s.sideBarPosition = Position.RIGHT; s.panelAlignment = 'right'; }),
		};

		assert.deepStrictEqual(actual, {
			centerLeft: { sideBar: false, auxBar: false },
			centerRight: { sideBar: false, auxBar: false },
			justifyLeft: { sideBar: true, auxBar: true },
			justifyRight: { sideBar: true, auxBar: true },
			leftAlignSidebarLeft: { sideBar: true, auxBar: false },
			leftAlignSidebarRight: { sideBar: false, auxBar: true },
			rightAlignSidebarLeft: { sideBar: false, auxBar: true },
			rightAlignSidebarRight: { sideBar: true, auxBar: false },
		});
	});
});

class VerticalMarginLayoutService extends TestLayoutService {
	floatingPanelsEnabled = true;
	panelPosition = Position.BOTTOM;
	panelAlignment: PanelAlignment = 'center';
	visibleParts = new Set<Parts>([Parts.TITLEBAR_PART, Parts.STATUSBAR_PART, Parts.EDITOR_PART]);

	override isFloatingPanelsEnabled(): boolean { return this.floatingPanelsEnabled; }
	override getPanelPosition(): Position { return this.panelPosition; }
	override getPanelAlignment(): PanelAlignment { return this.panelAlignment; }
	override isVisible(part: Parts): boolean { return this.visibleParts.has(part); }
}

suite('LayoutService - getFloatingPaneCompositeVerticalMargins', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function margins(partId: Parts, configure: (service: VerticalMarginLayoutService) => void): { top: number; bottom: number } {
		const service = new VerticalMarginLayoutService();
		configure(service);
		return getFloatingPaneCompositeVerticalMargins(service, partId, mainWindow);
	}

	const inner = FLOATING_PANEL_INNER_MARGIN;
	const margin = FLOATING_PANEL_MARGIN;
	const outer = FLOATING_PANEL_MARGIN * 2;

	test('bottom panel top margin across editor visibility and top edge', () => {
		const bottomPanel = (configure: (s: VerticalMarginLayoutService) => void) => margins(Parts.PANEL_PART, s => { s.visibleParts.add(Parts.PANEL_PART); configure(s); });
		const actual = {
			editorVisible: bottomPanel(() => { }),

			maximizedUnderTitleBar: bottomPanel(s => { s.visibleParts.delete(Parts.EDITOR_PART); }),

			maximizedAtTopEdge: bottomPanel(s => { s.visibleParts.delete(Parts.EDITOR_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); }),

			maximizedUnderBanner: bottomPanel(s => { s.visibleParts.delete(Parts.EDITOR_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); s.visibleParts.add(Parts.BANNER_PART); }),
		};

		assert.deepStrictEqual(actual, {
			editorVisible: { top: margin, bottom: margin },
			maximizedUnderTitleBar: { top: margin, bottom: margin },
			maximizedAtTopEdge: { top: outer, bottom: margin },
			maximizedUnderBanner: { top: margin, bottom: margin },
		});
	});

	test('margins across panel positions', () => {
		const actual = {
			topPanelStatusBarHidden: margins(Parts.PANEL_PART, s => { s.panelPosition = Position.TOP; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			leftPanelAtBothEdges: margins(Parts.PANEL_PART, s => { s.panelPosition = Position.LEFT; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			sideBarTopPanelCentered: margins(Parts.SIDEBAR_PART, s => { s.panelPosition = Position.TOP; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); }),

			sideBarTopPanelJustified: margins(Parts.SIDEBAR_PART, s => { s.panelPosition = Position.TOP; s.panelAlignment = 'justify'; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); }),

			sideBarBottomPanelJustified: margins(Parts.SIDEBAR_PART, s => { s.panelAlignment = 'justify'; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			sideBarBottomPanelCentered: margins(Parts.SIDEBAR_PART, s => { s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			disabled: margins(Parts.SIDEBAR_PART, s => { s.floatingPanelsEnabled = false; s.visibleParts.clear(); }),
		};

		assert.deepStrictEqual(actual, {
			topPanelStatusBarHidden: { top: margin, bottom: inner },
			leftPanelAtBothEdges: { top: outer, bottom: outer },
			sideBarTopPanelCentered: { top: outer, bottom: margin },
			sideBarTopPanelJustified: { top: margin, bottom: margin },
			sideBarBottomPanelJustified: { top: margin, bottom: inner },
			sideBarBottomPanelCentered: { top: margin, bottom: outer },
			disabled: { top: 0, bottom: 0 },
		});
	});
});

suite('LayoutService - getFloatingEditorVerticalMargins', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function margins(configure: (service: VerticalMarginLayoutService) => void): { top: number; bottom: number } {
		const service = new VerticalMarginLayoutService();
		configure(service);
		return getFloatingEditorVerticalMargins(service, mainWindow);
	}

	const inner = FLOATING_PANEL_INNER_MARGIN;
	const margin = FLOATING_PANEL_MARGIN;
	const outer = FLOATING_PANEL_MARGIN * 2;

	test('margins across panel positions, title bar, banner and status bar', () => {
		const actual = {
			titleAndStatusBarVisible: margins(() => { }),

			titleBarHidden: margins(s => { s.visibleParts.delete(Parts.TITLEBAR_PART); }),

			bannerInsteadOfTitleBar: margins(s => { s.visibleParts.delete(Parts.TITLEBAR_PART); s.visibleParts.add(Parts.BANNER_PART); }),

			topPanelAtTopEdge: margins(s => { s.panelPosition = Position.TOP; s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.TITLEBAR_PART); }),

			statusBarHidden: margins(s => { s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			bottomPanelStatusBarHidden: margins(s => { s.visibleParts.add(Parts.PANEL_PART); s.visibleParts.delete(Parts.STATUSBAR_PART); }),

			disabled: margins(s => { s.floatingPanelsEnabled = false; s.visibleParts.clear(); }),
		};

		assert.deepStrictEqual(actual, {
			titleAndStatusBarVisible: { top: margin, bottom: margin },
			titleBarHidden: { top: outer, bottom: margin },
			bannerInsteadOfTitleBar: { top: margin, bottom: margin },
			topPanelAtTopEdge: { top: margin, bottom: margin },
			statusBarHidden: { top: margin, bottom: outer },
			bottomPanelStatusBarHidden: { top: margin, bottom: inner },
			disabled: { top: 0, bottom: 0 },
		});
	});
});
