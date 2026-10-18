/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { raceCancellationError } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../../base/common/errors.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { formatAgentToolError } from '../../../../../platform/agentHost/common/agentToolRuntime.js';
import type { AgentToolExecutionStatus } from '../../../../../platform/agentHost/common/agentToolRuntime.js';
import { getDardcorBrowserSnapshotChanges, performDardcorBrowserClick } from './dardcorBrowserActions.js';

/** Service instances resolved during invokeFunction and safe to retain across asynchronous browser work. */
export interface IDardcorBrowserAgentServices {
	readonly browserService: IBrowserViewWorkbenchService;
	readonly editorService: IEditorService;
	readonly commandService: ICommandService;
	readonly playwrightService: IPlaywrightService;
}

export interface IDardcorBrowserAgentToolResult {
	readonly output: string;
	readonly executionStatus?: AgentToolExecutionStatus;
	readonly image?: { mimeType: 'image/png'; base64: string };
}

const BROWSER_VIEW_OPEN_TIMEOUT_MS = 15000;

function getAllBrowserViews(browserService: IBrowserViewWorkbenchService): BrowserEditorInput[] {
	const viewsById = new Map<string, BrowserEditorInput>();
	for (const view of browserService.getContextualBrowserViews().values()) {
		viewsById.set(view.id, view);
	}
	for (const view of browserService.getKnownBrowserViews().values()) {
		viewsById.set(view.id, view);
	}
	return [...viewsById.values()];
}

function normalizeBrowserAgentUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = '';
		return url.href.replace(/\/$/, '');
	} catch {
		return value.trim().replace(/\/$/, '');
	}
}

function waitForBrowserView(
	browserService: IBrowserViewWorkbenchService,
	predicate: (view: BrowserEditorInput) => boolean,
	timeoutMs: number,
	token: CancellationToken,
): Promise<BrowserEditorInput> {
	return new Promise((resolve, reject) => {
		let changeListener: { dispose(): void } | undefined;
		let cancellationListener: { dispose(): void } | undefined;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const cleanup = () => {
			changeListener?.dispose();
			cancellationListener?.dispose();
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
		};
		const finish = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			callback();
		};
		const resolveMatchingView = () => {
			try {
				const view = getAllBrowserViews(browserService).find(predicate);
				if (view) {
					finish(() => resolve(view));
				}
			} catch (error) {
				finish(() => reject(error));
			}
		};

		if (token.isCancellationRequested) {
			finish(() => reject(new CancellationError()));
			return;
		}
		changeListener = browserService.onDidChangeBrowserViews(resolveMatchingView);
		cancellationListener = token.onCancellationRequested(() => finish(() => reject(new CancellationError())));
		timeoutHandle = setTimeout(() => finish(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for the integrated browser tab to become available.`))), timeoutMs);
		resolveMatchingView();
	});
}

export interface IDardcorInteractiveElement {
	dardcorId: number;
	tag: string;
	type?: string;
	role?: string;
	text: string;
	value?: string;
	placeholder?: string;
	href?: string;
	selector: string;
	x: number;
	y: number;
	width: number;
	height: number;
	inViewport: boolean;
	disabled?: boolean;
	checked?: string;
	selected?: string;
	expanded?: string;
	pressed?: string;
}

export interface IDardcorPageSnapshot {
	title: string;
	url: string;
	viewportWidth: number;
	viewportHeight: number;
	scrollX: number;
	scrollY: number;
	scrollHeight: number;
	scrollWidth: number;
	headings: string[];
	visibleTextExcerpt: string;
	interactiveElements: IDardcorInteractiveElement[];
	dialogs: string[];
	runtimeErrors: string[];
}

const DARDCOR_BROWSER_AGENT_RUNTIME_SCRIPT = `
(function() {
	if (window.__dardcorBrowserAgentRuntime && window.__dardcorBrowserAgentRuntime.version === 4) {
		window.__dardcorBrowserAgentRuntime.ensureOverlay();
		return true;
	}
	if (window.__dardcorBrowserAgentRuntime) {
		const previousOverlay = document.getElementById('__dardcor_ai_agent_overlay__');
		if (previousOverlay) previousOverlay.remove();
	}

	const state = {
		version: 4,
		cursorX: Math.round((window.innerWidth || 1024) * 0.5),
		cursorY: Math.round((window.innerHeight || 768) * 0.35),
		logs: window.__dardcorCapturedLogs || [],
		dialogs: window.__dardcorCapturedDialogs || [],
		nextDialogAction: { accept: true, promptText: '' },
		showBadges: true
	};
	window.__dardcorCapturedLogs = state.logs;
	window.__dardcorCapturedDialogs = state.dialogs;

	// 1. Capture runtime errors & console warnings/errors
	if (!window.__dardcorErrorHooksInstalled) {
		window.__dardcorErrorHooksInstalled = true;
		const pushLog = (level, msg) => {
			try {
				const entry = '[' + level.toUpperCase() + '] ' + String(msg).slice(0, 600);
				state.logs.push(entry);
				if (state.logs.length > 80) {
					state.logs.shift();
				}
			} catch (_) {}
		};

		window.addEventListener('error', (ev) => {
			const loc = ev.filename ? ' (' + ev.filename + ':' + ev.lineno + ')' : '';
			pushLog('uncaught-error', (ev.message || 'Runtime Error') + loc);
		});

		window.addEventListener('unhandledrejection', (ev) => {
			const reason = ev.reason ? (ev.reason.stack || ev.reason.message || String(ev.reason)) : 'Unhandled Promise Rejection';
			pushLog('unhandled-rejection', reason);
		});

		const origError = console.error;
		const origWarn = console.warn;
		console.error = function(...args) {
			try {
				pushLog('console.error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
			} catch (_) {}
			return origError.apply(console, args);
		};
		console.warn = function(...args) {
			try {
				pushLog('console.warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
			} catch (_) {}
			return origWarn.apply(console, args);
		};
	}

	// 2. Non-blocking dialog interception fallback
	if (!window.__dardcorDialogHooksInstalled) {
		window.__dardcorDialogHooksInstalled = true;
		const origAlert = window.alert;
		const origConfirm = window.confirm;
		const origPrompt = window.prompt;

		window.alert = function(message) {
			const msg = String(message ?? '');
			state.dialogs.push('[alert] ' + msg);
			try {
				if (window.__dardcorBrowserAgentRuntime) {
					window.__dardcorBrowserAgentRuntime.showToast('🔔 Alert: ' + msg.slice(0, 80));
				}
			} catch (_) {
				return origAlert.call(window, message);
			}
		};

		window.confirm = function(message) {
			const msg = String(message ?? '');
			const accept = state.nextDialogAction ? state.nextDialogAction.accept !== false : true;
			state.dialogs.push('[confirm -> ' + (accept ? 'OK' : 'Cancel') + '] ' + msg);
			try {
				if (window.__dardcorBrowserAgentRuntime) {
					window.__dardcorBrowserAgentRuntime.showToast('🔔 Confirm (' + (accept ? 'Accepted' : 'Cancelled') + '): ' + msg.slice(0, 60));
				}
			} catch (_) {
				return origConfirm.call(window, message);
			}
			return accept;
		};

		window.prompt = function(message, defaultVal) {
			const msg = String(message ?? '');
			const accept = state.nextDialogAction ? state.nextDialogAction.accept !== false : true;
			const val = (state.nextDialogAction && state.nextDialogAction.promptText !== undefined && state.nextDialogAction.promptText !== '')
				? state.nextDialogAction.promptText
				: (defaultVal ?? '');
			state.dialogs.push('[prompt -> ' + (accept ? val : 'null') + '] ' + msg);
			try {
				if (window.__dardcorBrowserAgentRuntime) {
					window.__dardcorBrowserAgentRuntime.showToast('🔔 Prompt: ' + msg.slice(0, 60));
				}
			} catch (_) {
				return origPrompt.call(window, message, defaultVal);
			}
			return accept ? val : null;
		};
	}

	// 3. Dardcor cursor and HUD overlay (Shadow DOM)
	let hostEl = null;
	let shadow = null;
	let cursorEl = null;
	let badgeEl = null;
	let badgeTextEl = null;
	let typingBubbleEl = null;
	let targetBoxEl = null;
	let targetLabelEl = null;
	let rippleLayerEl = null;
	let trailLayerEl = null;
	let statusBannerEl = null;
	let fadeTimeout = null;

	function ensureOverlay() {
		if (!document.documentElement) {
			return null;
		}
		document.getElementById('__dardcor_agent_cursor_bootstrap__')?.remove();
		const bootstrapPointerListener = window.__dardcorAgentCursorFollowPointer;
		if (bootstrapPointerListener) {
			window.removeEventListener('pointermove', bootstrapPointerListener, true);
			window.removeEventListener('mousemove', bootstrapPointerListener, true);
			try { delete window.__dardcorAgentCursorFollowPointer; } catch (_) { }
		}
		try { delete window.__dardcorAgentCursorMoveTo; } catch (_) { }
		hostEl = document.getElementById('__dardcor_ai_agent_overlay__');
		if (hostEl && hostEl.shadowRoot) {
			shadow = hostEl.shadowRoot;
			cursorEl = shadow.getElementById('dc-cursor');
			badgeEl = shadow.getElementById('dc-cursor-badge');
			badgeTextEl = shadow.getElementById('dc-cursor-badge-text');
			typingBubbleEl = shadow.getElementById('dc-typing-bubble');
			targetBoxEl = shadow.getElementById('dc-target-box');
			targetLabelEl = shadow.getElementById('dc-target-label');
			rippleLayerEl = shadow.getElementById('dc-ripple-layer');
			trailLayerEl = shadow.getElementById('dc-trail-layer');
			statusBannerEl = shadow.getElementById('dc-status-banner');
			return shadow;
		}

		hostEl = document.createElement('div');
		hostEl.id = '__dardcor_ai_agent_overlay__';
		hostEl.setAttribute('data-dardcor-ignore', 'true');
		hostEl.style.cssText = 'position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;pointer-events:none !important;z-index:2147483647 !important;overflow:hidden !important;margin:0 !important;padding:0 !important;border:none !important;background:transparent !important;';
		(document.body || document.documentElement).appendChild(hostEl);

		shadow = hostEl.attachShadow({ mode: 'open' });
		shadow.innerHTML = \`
			<style>
				:host, * {
					box-sizing: border-box;
					user-select: none;
					pointer-events: none;
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
				}
				#dc-overlay-frame {
					position: fixed;
					inset: 0;
					border: 2px solid rgba(139, 92, 246, 0.42);
					box-shadow: inset 0 0 24px rgba(139, 92, 246, 0.14);
					opacity: 0;
					transition: opacity 0.25s ease;
				}
				#dc-overlay-frame.active {
					opacity: 1;
				}
				#dc-status-banner {
					position: fixed;
					top: 12px;
					right: 16px;
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 6px 13px;
					border-radius: 999px;
					background: rgba(11, 15, 25, 0.88);
					backdrop-filter: blur(10px);
					border: 1px solid rgba(167, 139, 250, 0.48);
					box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 14px rgba(139, 92, 246, 0.26);
					color: #f8fafc;
					font-size: 11.5px;
					font-weight: 600;
					letter-spacing: 0.02em;
					opacity: 0;
					transform: translateY(-8px);
					transition: opacity 0.22s ease, transform 0.22s ease;
				}
				#dc-status-banner.visible {
					opacity: 1;
					transform: translateY(0);
				}
				.dc-pulse-dot {
					width: 8px;
					height: 8px;
					border-radius: 50%;
					background: #a78bfa;
					box-shadow: 0 0 10px #8b5cf6;
					animation: dcPulse 1.2s infinite ease-in-out;
				}
				@keyframes dcPulse {
					0%, 100% { transform: scale(1); opacity: 1; }
					50% { transform: scale(1.35); opacity: 0.65; }
				}
				#dc-target-box {
					position: fixed;
					left: 0;
					top: 0;
					width: 0;
					height: 0;
					opacity: 0;
					border: 2px solid #8b5cf6;
					border-radius: 6px;
					background: rgba(139, 92, 246, 0.12);
					box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.25), 0 0 18px rgba(139, 92, 246, 0.45);
					transition: left 0.18s cubic-bezier(0.22, 1, 0.36, 1),
								top 0.18s cubic-bezier(0.22, 1, 0.36, 1),
								width 0.18s cubic-bezier(0.22, 1, 0.36, 1),
								height 0.18s cubic-bezier(0.22, 1, 0.36, 1),
								opacity 0.18s ease;
				}
				#dc-target-box.visible {
					opacity: 1;
				}
				#dc-target-label {
					position: absolute;
					top: -22px;
					left: -2px;
					padding: 2px 7px;
					border-radius: 4px;
					background: linear-gradient(135deg, #a78bfa, #6d28d9);
					color: #ffffff;
					font-size: 10px;
					font-weight: 700;
					white-space: nowrap;
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
				}
				#dc-trail-layer, #dc-ripple-layer {
					position: fixed;
					inset: 0;
					overflow: hidden;
				}
				.dc-trail-dot {
					position: fixed;
					width: 7px;
					height: 7px;
					margin-left: -3.5px;
					margin-top: -3.5px;
					border-radius: 50%;
					background: radial-gradient(circle, rgba(167, 139, 250, 0.85), rgba(109, 40, 217, 0.12));
					animation: dcTrailFade 0.42s ease-out forwards;
				}
				@keyframes dcTrailFade {
					0% { transform: scale(1); opacity: 0.75; }
					100% { transform: scale(0.2); opacity: 0; }
				}
				.dc-click-ripple {
					position: fixed;
					width: 44px;
					height: 44px;
					margin-left: -22px;
					margin-top: -22px;
					border-radius: 50%;
					border: 2.5px solid #8b5cf6;
					background: radial-gradient(circle, rgba(167, 139, 250, 0.35) 0%, rgba(109, 40, 217, 0.1) 60%, transparent 100%);
					box-shadow: 0 0 16px rgba(139, 92, 246, 0.65);
					animation: dcRippleExpand 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards;
				}
				.dc-click-ripple-inner {
					position: fixed;
					width: 12px;
					height: 12px;
					margin-left: -6px;
					margin-top: -6px;
					border-radius: 50%;
					background: #ffffff;
					box-shadow: 0 0 12px #8b5cf6, 0 0 20px #6d28d9;
					animation: dcInnerDot 0.45s ease-out forwards;
				}
				@keyframes dcRippleExpand {
					0% { transform: scale(0.2); opacity: 1; }
					100% { transform: scale(2.15); opacity: 0; }
				}
				@keyframes dcInnerDot {
					0% { transform: scale(1.2); opacity: 1; }
					100% { transform: scale(0.1); opacity: 0; }
				}
				#dc-cursor {
					position: fixed;
					left: 0;
					top: 0;
					z-index: 10;
					transform: translate3d(\${state.cursorX}px, \${state.cursorY}px, 0);
					opacity: 0;
					transition: opacity 0.2s ease;
					will-change: transform;
				}
				#dc-cursor.visible {
					opacity: 1;
				}
				#dc-cursor-svg {
					width: 28px;
					height: 28px;
					margin-left: -3px;
					margin-top: -2px;
					filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.48)) drop-shadow(0 0 8px rgba(139, 92, 246, 0.62));
					transition: transform 0.12s ease;
				}
				#dc-cursor.pressing #dc-cursor-svg {
					transform: scale(0.82) rotate(-4deg);
				}
				#dc-cursor-badge {
					position: absolute;
					left: 22px;
					top: 18px;
					display: flex;
					align-items: center;
					gap: 6px;
					padding: 5px 11px;
					border-radius: 999px;
					background: linear-gradient(135deg, rgba(25, 16, 48, 0.96), rgba(48, 28, 86, 0.96));
					border: 1.5px solid rgba(167, 139, 250, 0.78);
					box-shadow: 0 6px 18px rgba(0, 0, 0, 0.42), 0 0 12px rgba(139, 92, 246, 0.3);
					color: #ffffff;
					font-size: 11.5px;
					font-weight: 600;
					white-space: nowrap;
					max-width: 320px;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				#dc-typing-bubble {
					position: absolute;
					left: 22px;
					top: 48px;
					display: none;
					padding: 4px 10px;
					border-radius: 6px;
					background: rgba(15, 23, 42, 0.96);
					border: 1px solid #a78bfa;
					color: #c4b5fd;
					font-family: "JetBrains Mono", Consolas, monospace;
					font-size: 11.5px;
					font-weight: 600;
					white-space: nowrap;
					box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
				}
				#dc-typing-bubble.visible {
					display: block;
				}
			</style>
			<div id="dc-overlay-frame"></div>
			<div id="dc-trail-layer"></div>
			<div id="dc-target-box"><div id="dc-target-label">TARGET</div></div>
			<div id="dc-ripple-layer"></div>
			<div id="dc-status-banner">
				<span class="dc-pulse-dot"></span>
				<span id="dc-status-banner-text">Dardcor Browser Agent Active</span>
			</div>
			<div id="dc-cursor">
				<svg id="dc-cursor-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
					<defs>
						<linearGradient id="dcCursorGrad" x1="4" y1="3" x2="26" y2="27" gradientUnits="userSpaceOnUse">
							<stop offset="0%" stop-color="#c4b5fd"/>
							<stop offset="50%" stop-color="#8b5cf6"/>
							<stop offset="100%" stop-color="#6d28d9"/>
						</linearGradient>
					</defs>
					<path d="M5.5 3.2L26.8 13.4C28.3 14.1 28.1 16.3 26.5 16.8L17.2 19.5L13.6 28.4C13.0 29.9 10.8 29.8 10.3 28.2L3.5 5.3C3.1 3.8 4.2 2.6 5.5 3.2Z"
						fill="url(#dcCursorGrad)"
						stroke="#FFFFFF"
						stroke-width="2.2"
						stroke-linejoin="round"/>
					<circle cx="13.5" cy="14.5" r="2.2" fill="#FFFFFF" opacity="0.9"/>
				</svg>
				<div id="dc-cursor-badge">
					<span class="dc-pulse-dot"></span>
					<span id="dc-cursor-badge-text">Dardcor</span>
				</div>
				<div id="dc-typing-bubble"></div>
			</div>
		\`;

		cursorEl = shadow.getElementById('dc-cursor');
		badgeEl = shadow.getElementById('dc-cursor-badge');
		badgeTextEl = shadow.getElementById('dc-cursor-badge-text');
		typingBubbleEl = shadow.getElementById('dc-typing-bubble');
		targetBoxEl = shadow.getElementById('dc-target-box');
		targetLabelEl = shadow.getElementById('dc-target-label');
		rippleLayerEl = shadow.getElementById('dc-ripple-layer');
		trailLayerEl = shadow.getElementById('dc-trail-layer');
		statusBannerEl = shadow.getElementById('dc-status-banner');
		return shadow;
	}

	function wakeOverlay(actionLabel) {
		ensureOverlay();
		if (!shadow) return;
		if (fadeTimeout) {
			clearTimeout(fadeTimeout);
			fadeTimeout = null;
		}
		const frame = shadow.getElementById('dc-overlay-frame');
		if (frame) frame.classList.add('active');
		if (cursorEl) cursorEl.classList.add('visible');
		if (statusBannerEl) {
			statusBannerEl.classList.add('visible');
			const bannerTxt = shadow.getElementById('dc-status-banner-text');
			if (bannerTxt && actionLabel) {
				bannerTxt.textContent = 'Dardcor • ' + actionLabel;
			}
		}
		if (badgeTextEl) {
			badgeTextEl.textContent = 'Dardcor';
		}
		// Keep cursor visible for 6 seconds after action finishes
		fadeTimeout = setTimeout(() => {
			try {
				const f = shadow && shadow.getElementById('dc-overlay-frame');
				if (f) f.classList.remove('active');
				if (targetBoxEl) targetBoxEl.classList.remove('visible');
				if (typingBubbleEl) typingBubbleEl.classList.remove('visible');
				if (statusBannerEl) statusBannerEl.classList.remove('visible');
			} catch (_) {}
		}, 6000);
	}

	function highlightRect(rect, label) {
		ensureOverlay();
		if (!targetBoxEl || !rect) return;
		targetBoxEl.style.left = Math.max(0, Math.round(rect.left - 4)) + 'px';
		targetBoxEl.style.top = Math.max(0, Math.round(rect.top - 4)) + 'px';
		targetBoxEl.style.width = Math.round(rect.width + 8) + 'px';
		targetBoxEl.style.height = Math.round(rect.height + 8) + 'px';
		targetBoxEl.classList.add('visible');
		if (targetLabelEl) {
			targetLabelEl.textContent = (label || 'TARGET').slice(0, 36);
		}
	}

	function hideHighlight() {
		if (targetBoxEl) {
			targetBoxEl.classList.remove('visible');
		}
	}

	function spawnRipple(x, y) {
		ensureOverlay();
		if (!rippleLayerEl) return;
		const r1 = document.createElement('div');
		r1.className = 'dc-click-ripple';
		r1.style.left = Math.round(x) + 'px';
		r1.style.top = Math.round(y) + 'px';

		const r2 = document.createElement('div');
		r2.className = 'dc-click-ripple-inner';
		r2.style.left = Math.round(x) + 'px';
		r2.style.top = Math.round(y) + 'px';

		rippleLayerEl.appendChild(r1);
		rippleLayerEl.appendChild(r2);
		setTimeout(() => {
			r1.remove();
			r2.remove();
		}, 700);
	}

	function spawnTrail(x, y) {
		if (!trailLayerEl) return;
		const dot = document.createElement('div');
		dot.className = 'dc-trail-dot';
		dot.style.left = Math.round(x) + 'px';
		dot.style.top = Math.round(y) + 'px';
		trailLayerEl.appendChild(dot);
		setTimeout(() => dot.remove(), 450);
	}

	function setCursorPosition(x, y) {
		state.cursorX = x;
		state.cursorY = y;
		if (!cursorEl) return;
		cursorEl.style.transform = 'translate3d(' + Math.round(x) + 'px, ' + Math.round(y) + 'px, 0)';
		// Flip badge to left side if cursor is near right edge of viewport
		if (badgeEl) {
			const vw = window.innerWidth || 1024;
			const vh = window.innerHeight || 768;
			if (x > vw - 260) {
				badgeEl.style.left = 'auto';
				badgeEl.style.right = '14px';
			} else {
				badgeEl.style.left = '22px';
				badgeEl.style.right = 'auto';
			}
			if (y > vh - 80) {
				badgeEl.style.top = '-28px';
			} else {
				badgeEl.style.top = '18px';
			}
		}
	}

	async function animateCursorTo(targetX, targetY, actionLabel, targetRect, durationMs = 340) {
		wakeOverlay(actionLabel);
		if (targetRect) {
			highlightRect(targetRect, actionLabel);
		}
		const startX = Number.isFinite(state.cursorX) ? state.cursorX : Math.round((window.innerWidth || 1024) / 2);
		const startY = Number.isFinite(state.cursorY) ? state.cursorY : Math.round((window.innerHeight || 768) / 2);
		const dx = targetX - startX;
		const dy = targetY - startY;
		const distance = Math.hypot(dx, dy);

		if (distance < 4 || durationMs <= 0) {
			setCursorPosition(targetX, targetY);
			return;
		}

		const actualDuration = Math.min(520, Math.max(180, durationMs));
		const arcAmplitude = Math.min(42, distance * 0.12);
		const startTime = performance.now();
		let lastTrailTime = 0;

		await new Promise((resolve) => {
			function step(now) {
				const elapsed = now - startTime;
				const t = Math.min(1, elapsed / actualDuration);
				// Cubic ease-out with slight human-like arc
				const ease = 1 - Math.pow(1 - t, 3);
				const arc = Math.sin(t * Math.PI) * arcAmplitude;
				const perpX = distance > 0 ? (-dy / distance) * arc * 0.35 : 0;
				const perpY = distance > 0 ? (dx / distance) * arc * 0.35 : 0;

				const curX = startX + dx * ease + perpX;
				const curY = startY + dy * ease + perpY;
				setCursorPosition(curX, curY);

				if (now - lastTrailTime > 28 && t < 0.95) {
					lastTrailTime = now;
					spawnTrail(curX, curY);
				}

				if (t < 1) {
					requestAnimationFrame(step);
				} else {
					setCursorPosition(targetX, targetY);
					resolve();
				}
			}
			requestAnimationFrame(step);
		});
	}

	async function animatePress(x, y) {
		ensureOverlay();
		if (cursorEl) {
			cursorEl.classList.add('pressing');
		}
		spawnRipple(x, y);
		await new Promise(r => setTimeout(r, 140));
		if (cursorEl) {
			cursorEl.classList.remove('pressing');
		}
	}

	function showTypingPreview(text) {
		ensureOverlay();
		if (!typingBubbleEl) return;
		if (!text) {
			typingBubbleEl.classList.remove('visible');
			typingBubbleEl.textContent = '';
			return;
		}
		typingBubbleEl.textContent = '⌨️ "' + text.slice(-36) + '"';
		typingBubbleEl.classList.add('visible');
	}

	function showToast(message) {
		wakeOverlay(message);
	}

	// 4. Smart Element Visibility & Multi-Strategy Resolver
	function isElementVisible(el) {
		if (!el || !(el instanceof Element)) return false;
		if (el.closest('#__dardcor_ai_agent_overlay__')) return false;
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
			return false;
		}
		const rect = el.getBoundingClientRect();
		return rect.width > 1 && rect.height > 1;
	}

	function getElementLabel(el) {
		if (!el) return '';
		const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
		const inner = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
		const val = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) ? (el.value || '') : '';
		return (inner || aria || val || el.tagName.toLowerCase()).slice(0, 90);
	}

	function buildUniqueSelector(el) {
		if (!el || !(el instanceof Element)) return '';
		const isUnique = selector => {
			try { return document.querySelectorAll(selector).length === 1; } catch (_) { return false; }
		};
		const escapeAttribute = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		if (el.id) {
			const selector = '#' + CSS.escape(el.id);
			if (isUnique(selector)) return selector;
		}
		for (const attribute of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
			const value = el.getAttribute(attribute);
			if (value) {
				const selector = el.tagName.toLowerCase() + '[' + attribute + '="' + escapeAttribute(value) + '"]';
				if (isUnique(selector)) return selector;
			}
		}
		const dardcorId = el.getAttribute('data-dardcor-id');
		if (dardcorId) {
			const selector = '[data-dardcor-id="' + escapeAttribute(dardcorId) + '"]';
			if (isUnique(selector)) return selector;
		}

		// Build a structural path instead of falling back to a broad selector such
		// as a generic button selector, which can silently target the wrong control.
		const path = [];
		let current = el;
		while (current && current instanceof Element && current !== document.documentElement) {
			let segment = current.tagName.toLowerCase();
			if (current.id) {
				segment = '#' + CSS.escape(current.id);
				if (isUnique(segment)) {
					path.unshift(segment);
					const candidate = path.join(' > ');
					if (isUnique(candidate)) return candidate;
					current = current.parentElement;
					continue;
				}
				segment = current.tagName.toLowerCase();
			}
			const siblings = current.parentElement
				? Array.from(current.parentElement.children).filter(sibling => sibling.tagName === current.tagName)
				: [];
			if (siblings.length > 1) {
				segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
			}
			path.unshift(segment);
			const candidate = path.join(' > ');
			if (isUnique(candidate)) return candidate;
			current = current.parentElement;
		}
		return path.join(' > ');
	}

	function indexInteractiveElements() {
		const candidateSelector = [
			'a[href]',
			'button',
			'input:not([type="hidden"])',
			'textarea',
			'select',
			'[role="button"]',
			'[role="link"]',
			'[role="tab"]',
			'[role="menuitem"]',
			'[role="checkbox"]',
			'[role="switch"]',
			'[role="option"]',
			'[role="combobox"]',
			'[onclick]',
			'summary',
			'label[for]'
		].join(',');

		const rawNodes = Array.from(document.querySelectorAll(candidateSelector));
		// Also include cursor:pointer elements that look like buttons/cards
		const allElements = document.querySelectorAll('div, span, li');
		for (let i = 0; i < allElements.length && rawNodes.length < 220; i++) {
			const node = allElements[i];
			if (rawNodes.includes(node)) continue;
			const st = window.getComputedStyle(node);
			if (st.cursor === 'pointer') {
				const txt = (node.innerText || '').trim();
				if (txt.length > 0 && txt.length < 60 && node.children.length <= 3) {
					rawNodes.push(node);
				}
			}
		}

		const results = [];
		let nextId = 1;
		const vw = window.innerWidth || 1024;
		const vh = window.innerHeight || 768;

		for (const el of rawNodes) {
			if (!isElementVisible(el)) continue;
			const rect = el.getBoundingClientRect();
			// Skip elements ridiculously far off-screen
			if (rect.bottom < -1200 || rect.top > vh + 2800) continue;

			const idNum = nextId++;
			el.setAttribute('data-dardcor-id', String(idNum));

			const tag = el.tagName.toLowerCase();
			const type = el.getAttribute('type') || undefined;
			const role = el.getAttribute('role') || undefined;
			const placeholder = el.getAttribute('placeholder') || undefined;
			const href = tag === 'a' ? (el.getAttribute('href') || undefined) : undefined;
			const value = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
				? String(el.value || '').slice(0, 80)
				: undefined;
			const text = getElementLabel(el);
			const inViewport = rect.top >= -10 && rect.left >= -10 && rect.bottom <= vh + 10 && rect.right <= vw + 10;

			results.push({
				dardcorId: idNum,
				tag,
				type,
				role,
				text,
				value,
				placeholder,
				href,
				checked: el.getAttribute('aria-checked') ?? (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? String(el.checked) : undefined),
				selected: el.getAttribute('aria-selected') ?? (el instanceof HTMLOptionElement ? String(el.selected) : undefined),
				expanded: el.getAttribute('aria-expanded') ?? undefined,
				pressed: el.getAttribute('aria-pressed') ?? undefined,
				selector: buildUniqueSelector(el),
				x: Math.round(rect.left + rect.width / 2),
				y: Math.round(rect.top + rect.height / 2),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
				inViewport,
				disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
			});

			if (results.length >= 120) break;
		}
		return results;
	}

	function resolveTargetElement(options) {
		options = options || {};
		const rawSelector = typeof options.selector === 'string' ? options.selector.trim() : '';
		const rawElementId = options.elementId !== undefined && options.elementId !== null ? String(options.elementId).trim() : '';
		const rawText = typeof options.text === 'string' ? options.text.trim() : '';

		// Ensure interactive elements are indexed first
		indexInteractiveElements();

		// Strategy 0: Exact coordinates (x, y)
		if (typeof options.x === 'number' && typeof options.y === 'number') {
			const hit = document.elementFromPoint(options.x, options.y);
			return { element: hit, x: options.x, y: options.y, matchedBy: 'coordinates' };
		}

		// Strategy 1: Set-of-Mark ID (elementId: "5", selector: "[5]", selector: "5")
		const idCandidate = rawElementId.replace(/^\\[|\\]$/g, '') || (/^\\[?\\d+\\]?$/.test(rawSelector) ? rawSelector.replace(/^\\[|\\]$/g, '') : '');
		if (idCandidate && /^\\d+$/.test(idCandidate)) {
			const byMark = document.querySelector('[data-dardcor-id="' + idCandidate + '"]');
			if (byMark) {
				return { element: byMark, matchedBy: 'data-dardcor-id=' + idCandidate };
			}
		}

		// Direct DOM id match if elementId is non-numeric
		if (rawElementId) {
			const byDomId = document.getElementById(rawElementId) || document.querySelector('[data-dardcor-id="' + rawElementId.replace(/"/g, '') + '"]');
			if (byDomId) {
				return { element: byDomId, matchedBy: 'elementId=' + rawElementId };
			}
		}

		// Strategy 2: Playwright-style :has-text("...") or :contains("...") or text=...
		let textQuery = rawText;
		let baseCss = rawSelector;
		const hasTextMatch = /^(.*?):(?:has-text|contains)\\(\\s*['"](.*?)['"]\\s*\\)$/i.exec(rawSelector);
		if (hasTextMatch) {
			baseCss = hasTextMatch[1].trim() || '*';
			textQuery = hasTextMatch[2].trim();
		} else if (/^text=/i.test(rawSelector)) {
			baseCss = '*';
			textQuery = rawSelector.slice(5).replace(/^['"]|['"]$/g, '').trim();
		}

		// Strategy 3: Standard CSS selector
		if (baseCss && baseCss !== '*' && !hasTextMatch) {
			try {
				const nodes = Array.from(document.querySelectorAll(baseCss));
				const visibleNode = nodes.find(isElementVisible) || nodes[0];
				if (visibleNode) {
					return { element: visibleNode, matchedBy: 'css:' + baseCss };
				}
			} catch (_) {
				// Invalid CSS selector (e.g. plain button text passed as selector) -> fall through to semantic text search!
				if (!textQuery) {
					textQuery = rawSelector;
				}
			}
		}

		// Strategy 4: Fuzzy Semantic Text / Placeholder / Aria-Label / Label search
		const searchPhrase = (textQuery || rawSelector || rawElementId).toLowerCase().trim();
		if (searchPhrase) {
			let pool = [];
			try {
				pool = baseCss && baseCss !== '*' ? Array.from(document.querySelectorAll(baseCss)) : [];
			} catch (_) {}
			if (pool.length === 0) {
				pool = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], label, [data-dardcor-id], h1, h2, h3, span, div'));
			}

			let bestEl = null;
			let bestScore = 0;

			for (const el of pool) {
				if (!isElementVisible(el)) continue;
				const inner = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
				const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
				const aria = (el.getAttribute('aria-label') || '').toLowerCase();
				const title = (el.getAttribute('title') || '').toLowerCase();
				const name = (el.getAttribute('name') || '').toLowerCase();
				const id = (el.id || '').toLowerCase();
				const val = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? (el.value || '').toLowerCase() : '';

				let score = 0;
				if (inner === searchPhrase || placeholder === searchPhrase || aria === searchPhrase || val === searchPhrase || name === searchPhrase || id === searchPhrase) {
					score = 100;
				} else if (inner.startsWith(searchPhrase) || placeholder.includes(searchPhrase) || aria.includes(searchPhrase) || title.includes(searchPhrase)) {
					score = 80;
				} else if (inner.includes(searchPhrase) && inner.length <= searchPhrase.length + 65) {
					score = 65;
				} else if (id.includes(searchPhrase) || name.includes(searchPhrase)) {
					score = 55;
				}

				// Boost interactive tags
				const tag = el.tagName.toLowerCase();
				if (score > 0 && ['button', 'a', 'input', 'textarea', 'select'].includes(tag)) {
					score += 15;
				}

				if (score > bestScore) {
					bestScore = score;
					bestEl = el;
				}
			}

			// If matched a <label>, resolve its associated input if appropriate
			if (bestEl && bestEl.tagName.toLowerCase() === 'label') {
				const forId = bestEl.getAttribute('for');
				if (forId) {
					const inputEl = document.getElementById(forId);
					if (inputEl) bestEl = inputEl;
				} else {
					const nestedInput = bestEl.querySelector('input, textarea, select');
					if (nestedInput) bestEl = nestedInput;
				}
			}

			if (bestEl) {
				return { element: bestEl, matchedBy: 'semantic-text:' + searchPhrase };
			}
		}

		return { element: null, matchedBy: 'none' };
	}

	async function prepareElementForInteraction(options, actionPrefix, deferCursor = false) {
		const resolved = resolveTargetElement(options);
		if (!resolved.element && typeof resolved.x === 'number' && typeof resolved.y === 'number') {
			const label = (actionPrefix || 'Action') + ' @ (' + Math.round(resolved.x) + ', ' + Math.round(resolved.y) + ')';
			if (!deferCursor) {
				await animateCursorTo(resolved.x, resolved.y, label, {
					left: resolved.x - 16,
					top: resolved.y - 16,
					width: 32,
					height: 32
				});
			}
			return {
				found: true,
				x: Math.round(resolved.x),
				y: Math.round(resolved.y),
				label,
				tag: 'coordinate',
				matchedBy: resolved.matchedBy
			};
		}

		const el = resolved.element;
		if (!el) {
			return {
				found: false,
				error: 'Could not find target element matching ' + JSON.stringify(options)
			};
		}

		// Scroll element into viewport smoothly if needed
		let rect = el.getBoundingClientRect();
		const vw = window.innerWidth || 1024;
		const vh = window.innerHeight || 768;
		if (rect.top < 20 || rect.bottom > vh - 20 || rect.left < 10 || rect.right > vw - 10) {
			try {
				el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
				await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				rect = el.getBoundingClientRect();
			} catch (_) {}
		}

		const cx = Math.max(8, Math.min(vw - 8, Math.round(rect.left + rect.width / 2)));
		const cy = Math.max(8, Math.min(vh - 8, Math.round(rect.top + rect.height / 2)));
		const elDesc = getElementLabel(el);
		const badgeLabel = (actionPrefix || 'Interacting') + ' "' + elDesc.slice(0, 32) + '"';

		if (!deferCursor) {
			await animateCursorTo(cx, cy, badgeLabel, {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			});
		}

		return {
			found: true,
			element: el,
			x: cx,
			y: cy,
			rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			label: elDesc,
			tag: el.tagName.toLowerCase(),
			dardcorId: el.getAttribute('data-dardcor-id') || undefined,
			selector: buildUniqueSelector(el),
			matchedBy: resolved.matchedBy
		};
	}

	function setNativeElementValue(el, value) {
		if (!el) return;
		const tag = el.tagName.toLowerCase();
		if (tag === 'input' || tag === 'textarea') {
			const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
			const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
			if (descriptor && descriptor.set) {
				descriptor.set.call(el, value);
			} else {
				el.value = value;
			}
		} else if (el.isContentEditable) {
			el.textContent = value;
		}
		el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
		el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
	}

	function collectPageSnapshot() {
		ensureOverlay();
		const interactiveElements = indexInteractiveElements();
		const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
			.filter(isElementVisible)
			.map(h => '[' + h.tagName.toUpperCase() + '] ' + (h.innerText || h.textContent || '').replace(/\\s+/g, ' ').trim())
			.filter(Boolean)
			.slice(0, 25);

		const cloneBody = document.body ? document.body.innerText : '';
		const visibleTextExcerpt = String(cloneBody || '')
			.replace(/\\n{3,}/g, '\\n\\n')
			.trim()
			.slice(0, 3500);

		return {
			title: document.title || 'Untitled Page',
			url: window.location.href,
			viewportWidth: window.innerWidth || 1024,
			viewportHeight: window.innerHeight || 768,
			scrollX: Math.round(window.scrollX || 0),
			scrollY: Math.round(window.scrollY || 0),
			scrollHeight: Math.round(document.documentElement ? document.documentElement.scrollHeight : 0),
			scrollWidth: Math.round(document.documentElement ? document.documentElement.scrollWidth : 0),
			headings,
			visibleTextExcerpt,
			interactiveElements,
			dialogs: state.dialogs.slice(-10),
			runtimeErrors: state.logs.slice(-20)
		};
	}

	window.__dardcorBrowserAgentRuntime = {
		version: 4,
		state,
		ensureOverlay,
		wakeOverlay,
		highlightRect,
		hideHighlight,
		spawnRipple,
		setCursorPosition,
		animateCursorTo,
		animatePress,
		showTypingPreview,
		showToast,
		resolveTargetElement,
		prepareElementForInteraction,
		setNativeElementValue,
		collectPageSnapshot
	};
	if (!window.__dardcorAgentPointerSyncInstalled) {
		window.__dardcorAgentPointerSyncInstalled = true;
		window.addEventListener('pointermove', event => {
			const runtime = window.__dardcorBrowserAgentRuntime;
			if (runtime) runtime.setCursorPosition(event.clientX, event.clientY);
		}, { capture: true, passive: true });
	}

	ensureOverlay();
	return true;
})();
`;

export class DardcorBrowserAgentController {

	/** Must stay synchronous: ServicesAccessor expires when invokeFunction's callback returns. */
	public static resolveServices(accessor: ServicesAccessor): IDardcorBrowserAgentServices {
		return {
			browserService: accessor.get(IBrowserViewWorkbenchService),
			editorService: accessor.get(IEditorService),
			commandService: accessor.get(ICommandService),
			playwrightService: accessor.get(IPlaywrightService),
		};
	}

	public static async resolveBrowserView(
		services: IDardcorBrowserAgentServices,
		options?: { pageId?: string; url?: string; openIfMissing?: boolean; forceNew?: boolean },
		token: CancellationToken = CancellationToken.None,
	): Promise<BrowserEditorInput | undefined> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const { browserService, editorService, commandService } = services;
		const allViews = getAllBrowserViews(browserService);

		if (options?.pageId && !options?.forceNew) {
			const needle = options.pageId.trim();
			const exactIdMatch = allViews.find(view => view.id === needle);
			const candidates = exactIdMatch ? [exactIdMatch] : allViews.filter(view => view.url && (
				normalizeBrowserAgentUrl(view.url) === normalizeBrowserAgentUrl(needle) || view.url.includes(needle)
			));
			if (candidates.length === 1) {
				await editorService.openEditor(candidates[0], { preserveFocus: true, pinned: true });
				await candidates[0].resolve();
				return candidates[0];
			}
			if (candidates.length > 1) {
				throw new Error(`Browser page selector "${needle}" matches ${candidates.length} tabs. Use an exact page ID from the browser tab list.`);
			}
			throw new Error(`No integrated browser tab matches page ID or URL selector "${needle}". Refresh the browser tab list and retry with an exact page ID.`);
		}

		if (!options?.forceNew) {
			const targetUrl = options?.url ? normalizeBrowserAgentUrl(options.url) : undefined;
			const exactUrlMatch = targetUrl ? allViews.find(view => !!view.url && normalizeBrowserAgentUrl(view.url) === targetUrl) : undefined;
			if (exactUrlMatch) {
				await editorService.openEditor(exactUrlMatch, { preserveFocus: true, pinned: true });
				await exactUrlMatch.resolve();
				return exactUrlMatch;
			}
			const activePane = editorService.activeEditorPane;
			if (activePane?.input instanceof BrowserEditorInput) {
				await activePane.input.resolve();
				return activePane.input;
			}
			for (const pane of editorService.visibleEditorPanes) {
				if (pane.input instanceof BrowserEditorInput) {
					await pane.input.resolve();
					return pane.input;
				}
			}
			if (allViews.length > 0) {
				const latestView = allViews[allViews.length - 1];
				await editorService.openEditor(latestView, { preserveFocus: true, pinned: true });
				await latestView.resolve();
				return latestView;
			}
		}

		if (options?.openIfMissing || options?.url) {
			const rawUrl = (options.url || 'http://localhost:3000').trim();
			const targetUrl = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('file:') || rawUrl.startsWith('data:')
				? rawUrl
				: `http://${rawUrl}`;
			const existingViewIds = new Set(getAllBrowserViews(browserService).map(view => view.id));

			await commandService.executeCommand('workbench.action.browser.open', {
				url: targetUrl,
				openToSide: false,
				lockGroup: false
			});

			const expectedUrl = normalizeBrowserAgentUrl(targetUrl);
			const created = await waitForBrowserView(browserService, view => {
				const isNewView = !existingViewIds.has(view.id);
				return (options?.forceNew ? isNewView : true)
					&& !!view.url
					&& normalizeBrowserAgentUrl(view.url) === expectedUrl;
			}, BROWSER_VIEW_OPEN_TIMEOUT_MS, token);
			await editorService.openEditor(created, { preserveFocus: true, pinned: true });
			await created.resolve();
			return created;
		}

		return undefined;
	}

	public static async withPageCDPSession<T>(
		services: IDardcorBrowserAgentServices,
		view: BrowserEditorInput,
		fn: (helpers: {
			model: IBrowserViewModel;
			sendPageCommand: (method: string, params?: Record<string, unknown>) => Promise<any>;
			evaluate: <R = any>(expression: string, timeoutMs?: number) => Promise<R>;
		}) => Promise<T>,
		sessionId = 'dardcor-agent-session',
		token: CancellationToken = CancellationToken.None,
	): Promise<T> {
		const playwright = services.playwrightService;
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const model = await view.resolve();
		await playwright.startTrackingPage(view.id);
		if (!await playwright.isPageTracked(view.id)) {
			throw new Error(`Integrated browser page ${view.id} could not be registered with Playwright.`);
		}
		const ready = await raceCancellationError(playwright.waitForPageReady(sessionId, view.id, 15000), token);
		const evaluate = async <R = any>(expression: string, _timeoutMs = 10000): Promise<R> => {
			const result = await raceCancellationError(
				playwright.invokeFunctionRaw<R>(sessionId, view.id,
				'async (page, source) => { const normalized = source.trim().replace(/;\\s*$/, ""); const evaluator = new Function("return (" + normalized + ")")(); return page.evaluate(evaluator); }',
				expression),
				token,
			);
			return result;
		};
		const sendPageCommand = async (method: string, params?: Record<string, unknown>): Promise<any> => {
			switch (method) {
				case 'Runtime.enable':
				case 'Page.enable':
					return {};
				case 'Runtime.evaluate':
					return { result: { value: await evaluate(String(params?.expression ?? 'undefined')) } };
				case 'Page.handleJavaScriptDialog':
					return playwright.replyToDialog(sessionId, view.id, params?.accept !== false, typeof params?.promptText === 'string' ? params.promptText : undefined);
				default:
					throw new Error(`Unsupported browser agent command: ${method}`);
			}
		};

		await evaluate(DARDCOR_BROWSER_AGENT_RUNTIME_SCRIPT);
		await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('🌐 Browser page ready: ' + document.title)`);
		if (!ready.url) {
			throw new Error(`Playwright page ${view.id} reported readiness without a URL.`);
		}
		return fn({ model, sendPageCommand, evaluate });
	}

	public static async waitTillHTMLStable(
		evaluate: <R = any>(expression: string, timeoutMs?: number) => Promise<R>,
		maxWaitMs = 3200
	): Promise<boolean> {
		const pollInterval = 220;
		const startTime = Date.now();
		let lastSize = 0;
		let stableCount = 0;
		let documentReady = false;
		let documentStable = false;
		let lastError: unknown;

		while (Date.now() - startTime < maxWaitMs) {
			try {
				const status = await evaluate<{ readyState: string; size: number }>(`
					(() => ({
						readyState: document.readyState,
						size: document.documentElement ? document.documentElement.innerHTML.length : 0
					}))()
				`, 2500);

				if (status && status.readyState !== 'loading' && status.size > 0) {
					documentReady = true;
					if (status.size > 0 && Math.abs(status.size - lastSize) < 25) {
						stableCount++;
						if (stableCount >= 2) {
						documentStable = true;
							break;
						}
					} else {
						stableCount = 0;
					}
					lastSize = status.size;
				}
			} catch (error) {
				if (isCancellationError(error)) {
					throw error;
				}
				lastError = error;
			}
			await new Promise(r => setTimeout(r, Math.min(pollInterval, Math.max(0, maxWaitMs - (Date.now() - startTime)))));
		}
		if (!documentReady) {
			const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
			throw new Error(`Integrated browser document did not become ready within ${maxWaitMs} ms.${detail}`);
		}

		await evaluate(DARDCOR_BROWSER_AGENT_RUNTIME_SCRIPT);
		return documentStable;
	}

	public static formatPageSnapshot(snapshot: IDardcorPageSnapshot, actionSummary?: string, nativeConsoleLogs?: string): string {
		const lines: string[] = [];

		if (actionSummary) {
			lines.push(`### Browser Action Result\n${actionSummary}\n`);
		}

		const scrollPct = snapshot.scrollHeight > snapshot.viewportHeight
			? Math.min(100, Math.round((snapshot.scrollY / (snapshot.scrollHeight - snapshot.viewportHeight)) * 100))
			: 100;

		lines.push(`### Active Browser Page Snapshot`);
		lines.push(`- **Title**: ${snapshot.title}`);
		lines.push(`- **URL**: ${snapshot.url}`);
		lines.push(`- **Viewport**: ${snapshot.viewportWidth}x${snapshot.viewportHeight}px | **Scroll**: Y=${snapshot.scrollY}/${snapshot.scrollHeight}px (${scrollPct}%)`);

		if (snapshot.dialogs && snapshot.dialogs.length > 0) {
			lines.push(`- **Recent Dialogs**: ${snapshot.dialogs.join(' | ')}`);
		}

		if (snapshot.headings && snapshot.headings.length > 0) {
			lines.push(`\n#### Page Headings`);
			lines.push(snapshot.headings.map(h => `- ${h}`).join('\n'));
		}

		lines.push(`\n#### Interactive Elements (Use \`elementId: "N"\`, \`selector\`, \`text\`, or \`x, y\` to interact)`);
		if (!snapshot.interactiveElements || snapshot.interactiveElements.length === 0) {
			lines.push(`*(No interactive elements detected on this page)*`);
		} else {
			const elemLines = snapshot.interactiveElements.slice(0, 85).map(el => {
				const typePart = el.type ? ` type="${el.type}"` : '';
				const rolePart = el.role ? ` role="${el.role}"` : '';
				const valPart = el.value ? ` value="${el.value}"` : '';
				const phPart = el.placeholder ? ` placeholder="${el.placeholder}"` : '';
				const hrefPart = el.href ? ` href="${el.href.slice(0, 60)}"` : '';
				const stateTag = el.disabled ? ' [disabled]' : (el.inViewport ? ' [in-viewport]' : ' [scroll-to-view]');
				return `[${el.dardcorId}] <${el.tag}${typePart}${rolePart}${phPart}${valPart}${hrefPart}> "${el.text}" (selector: \`${el.selector}\`) @ (${el.x}, ${el.y})${stateTag}`;
			});
			lines.push(elemLines.join('\n'));
			if (snapshot.interactiveElements.length > 85) {
				lines.push(`... (+${snapshot.interactiveElements.length - 85} more elements below fold — use \`scroll_browser_page\` to inspect)`);
			}
		}

		if (snapshot.visibleTextExcerpt) {
			lines.push(`\n#### Visible Page Text Content`);
			lines.push(snapshot.visibleTextExcerpt);
		}

		const combinedErrors: string[] = [];
		if (snapshot.runtimeErrors && snapshot.runtimeErrors.length > 0) {
			combinedErrors.push(...snapshot.runtimeErrors);
		}
		if (nativeConsoleLogs && nativeConsoleLogs.trim().length > 0) {
			const recentNative = nativeConsoleLogs.trim().split(/\r?\n/).slice(-15);
			for (const logLine of recentNative) {
				if (!combinedErrors.includes(logLine)) {
					combinedErrors.push(logLine);
				}
			}
		}

		if (combinedErrors.length > 0) {
			lines.push(`\n#### Browser Console & Runtime Diagnostics`);
			lines.push(combinedErrors.slice(-20).join('\n'));
		}

		return lines.join('\n');
	}

	private static async captureBrowserDiagnostics(
		playwright: IPlaywrightService,
		view: BrowserEditorInput,
		sessionId: string,
		model: IBrowserViewModel,
	): Promise<string> {
		const [chromiumResult, playwrightResult] = await Promise.allSettled([
			model.getConsoleLogs(),
			playwright.getAndClearDiagnostics(sessionId, view.id),
		]);
		const lines: string[] = [];
		if (chromiumResult.status === 'fulfilled' && chromiumResult.value.trim()) {
			lines.push(chromiumResult.value.trim());
		} else if (chromiumResult.status === 'rejected') {
			lines.push(`Chromium diagnostic capture error: ${chromiumResult.reason instanceof Error ? chromiumResult.reason.message : String(chromiumResult.reason)}`);
		}
		if (playwrightResult.status === 'fulfilled' && playwrightResult.value.length > 0) {
			lines.push(...playwrightResult.value);
		} else if (playwrightResult.status === 'rejected') {
			lines.push(`Playwright diagnostic capture error: ${playwrightResult.reason instanceof Error ? playwrightResult.reason.message : String(playwrightResult.reason)}`);
		}
		return lines.join('\n');
	}

	private static async invokePlaywright<T>(
		playwright: IPlaywrightService,
		view: BrowserEditorInput,
		sessionId: string,
		fnDef: string,
		...args: unknown[]
	): Promise<T> {
		await playwright.startTrackingPage(view.id);
		if (!await playwright.isPageTracked(view.id)) {
			throw new Error(`Integrated browser page ${view.id} is not tracked by Playwright.`);
		}
		await playwright.waitForPageReady(sessionId, view.id, 15000);
		return playwright.invokeFunctionRaw<T>(sessionId, view.id, fnDef, ...args);
	}

	public static async executeBrowserTool(
		services: IDardcorBrowserAgentServices,
		toolName: string,
		args: any,
		sessionId = 'dardcor-agent-session',
		token: CancellationToken = CancellationToken.None,
	): Promise<IDardcorBrowserAgentToolResult> {
		const normalizedName = toolName.toLowerCase().trim();
		let stage = 'resolving the integrated Browser Editor tab';
		try {
			return await DardcorBrowserAgentController.executeBrowserToolInternal(services, normalizedName, args, sessionId, token, value => stage = value);
		} catch (error) {
			const errorText = formatAgentToolError(error);
			const executionStatus: AgentToolExecutionStatus = token.isCancellationRequested || isCancellationError(error)
				? 'cancelled'
				: /timed?\s*out|timeout/i.test(errorText) ? 'timedOut' : 'failed';
			return {
				executionStatus,
				output: `Browser Agent Error (${normalizedName}) while ${stage}: ${errorText}. No successful browser verification was recorded. The action may have partially completed; inspect the active browser page before retrying to avoid duplicate side effects.`
			};
		}
	}

	private static async executeBrowserToolInternal(
		services: IDardcorBrowserAgentServices,
		toolName: string,
		args: any,
		sessionId: string,
		token: CancellationToken,
		setStage: (stage: string) => void,
	): Promise<IDardcorBrowserAgentToolResult> {
		const normalizedName = toolName.toLowerCase().trim();
		const { editorService, playwrightService } = services;

		if (normalizedName === 'open_browser_page' || normalizedName === 'navigate_browser' || normalizedName === 'navigate_page') {
			const rawUrl = typeof args?.url === 'string' ? args.url.trim() : (typeof args?.uri === 'string' ? args.uri.trim() : '');
			const targetUrl = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('file:') || rawUrl.startsWith('data:')
				? rawUrl
				: (rawUrl ? `http://${rawUrl}` : 'http://localhost:3000');

			setStage('resolving or creating the integrated browser tab');
			const view = await DardcorBrowserAgentController.resolveBrowserView(services, {
				pageId: args?.pageId,
				url: targetUrl,
				openIfMissing: true,
				forceNew: !!args?.forceNew
			}, token);

			if (!view) {
				return { executionStatus: 'failed', output: `Error: Could not open integrated browser at ${targetUrl}.` };
			}

			setStage('opening the browser tab in the editor');
			await editorService.openEditor(view, { preserveFocus: false, pinned: true });
			setStage('resolving the browser page');
			const model = await view.resolve();
			if (model.url !== targetUrl) {
				setStage(`navigating the integrated browser to ${targetUrl}`);
				await model.loadURL(targetUrl);
			}
			setStage('attaching the browser page to Playwright');
			await playwrightService.startTrackingPage(view.id);
			setStage('waiting for Playwright to confirm page readiness');
			const ready = await raceCancellationError(playwrightService.waitForPageReady(sessionId, view.id, 15000), token);

			return await DardcorBrowserAgentController.withPageCDPSession(services, view, async ({ model, evaluate }) => {
				setStage('waiting for the initial page render to stabilize');
				await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 4000);
				setStage('capturing the initial browser snapshot and diagnostics');
				await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('🌐 Loaded ' + document.title)`);
				const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
				const consoleLogs = await DardcorBrowserAgentController.captureBrowserDiagnostics(playwrightService, view, sessionId, model);
				return {
					output: DardcorBrowserAgentController.formatPageSnapshot(
						snapshot,
						`Successfully opened and inspected \`${ready.url}\` in the Dardcor Code Integrated Browser with the Dardcor cursor active.`,
						consoleLogs
					)
				};
			}, sessionId, token);
		}

		setStage('resolving the active integrated browser tab');
		const view = await DardcorBrowserAgentController.resolveBrowserView(services, {
			pageId: args?.pageId,
			url: args?.url,
			openIfMissing: Boolean(args?.url)
		}, token);

		if (!view) {
			return { executionStatus: 'failed', output: 'No active browser tab found. Call `open_browser_page` with a URL first.' };
		}

		setStage('opening the active browser tab in the editor');
		await editorService.openEditor(view, { preserveFocus: false, pinned: true });
		setStage('attaching the active browser page to Playwright');
		await playwrightService.startTrackingPage(view.id);

		setStage(`performing ${normalizedName} and collecting post-action evidence`);
		return await DardcorBrowserAgentController.withPageCDPSession(services, view, async ({ model, sendPageCommand, evaluate }) => {
			const captureConsoleLogs = async (): Promise<string> => DardcorBrowserAgentController.captureBrowserDiagnostics(playwrightService, view, sessionId, model);
			const moveCursorAndMouse = async (x: number, y: number, label: string, targetRect?: { left: number; top: number; width: number; height: number }): Promise<void> => {
				const start = await evaluate<{ x: number; y: number }>(`(() => { const state = window.__dardcorBrowserAgentRuntime.state; return { x: Number.isFinite(state.cursorX) ? state.cursorX : Math.round(innerWidth / 2), y: Number.isFinite(state.cursorY) ? state.cursorY : Math.round(innerHeight / 2) }; })()`);
				const startX = start?.x ?? Math.round(1024 / 2);
				const startY = start?.y ?? Math.round(768 / 2);
				await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay(${JSON.stringify(label)}); window.__dardcorBrowserAgentRuntime.highlightRect(${JSON.stringify(targetRect ?? null)}, ${JSON.stringify(label)});`);
				await DardcorBrowserAgentController.invokePlaywright(
					playwrightService,
					view,
					sessionId,
					'async (page, sx, sy, tx, ty) => { const steps = 20; const dx = tx - sx; const dy = ty - sy; const distance = Math.hypot(dx, dy); const arc = Math.min(42, distance * 0.12); for (let i = 1; i <= steps; i++) { const t = i / steps; const ease = 1 - Math.pow(1 - t, 3); const bend = Math.sin(t * Math.PI) * arc; const px = distance > 0 ? (-dy / distance) * bend * 0.35 : 0; const py = distance > 0 ? (dx / distance) * bend * 0.35 : 0; const x = Math.round(sx + dx * ease + px); const y = Math.round(sy + dy * ease + py); await page.evaluate(({ x, y }) => { const runtime = window.__dardcorBrowserAgentRuntime; if (!runtime) throw new Error("Agent cursor overlay is unavailable."); runtime.setCursorPosition(x, y); runtime.spawnTrail(x, y); }, { x, y }); await page.mouse.move(x, y); await page.waitForTimeout(17); } return true; }',
					startX,
					startY,
					x,
					y
				);
			};
			const getActionPoint = async (prep: any, action: 'click' | 'hover' | 'input' | 'select'): Promise<{ x: number; y: number; rect?: { left: number; top: number; width: number; height: number } }> => {
				if (typeof prep?.selector !== 'string' || !prep.selector.trim()) {
					return { x: prep.x, y: prep.y, rect: prep.rect };
				}
				return DardcorBrowserAgentController.invokePlaywright(
					playwrightService,
					view,
					sessionId,
				'async (page, selector, action, expectedTag, expectedLabel) => { const locator = page.locator(selector); const count = await locator.count(); if (count !== 1) throw new Error("Expected one browser target for selector, found " + count + ". Refresh the page snapshot and choose a unique target."); await locator.waitFor({ state: "visible", timeout: 8000 }); await locator.scrollIntoViewIfNeeded({ timeout: 8000 }); const actual = await locator.evaluate(element => { const tag = element.tagName.toLowerCase(); const aria = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.getAttribute("alt") || ""; const inner = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim(); const value = typeof element.value === "string" ? element.value : ""; return { tag, label: (inner || aria || value || tag).slice(0, 90) }; }); if (expectedTag && actual.tag !== expectedTag) throw new Error("The page changed while resolving the target: expected <" + expectedTag + "> but the selector now points to <" + actual.tag + ">. Refresh the page snapshot."); if (expectedLabel && actual.label !== expectedLabel) throw new Error("The page changed while resolving the target label. Refresh the page snapshot before acting."); if (action === "select" && actual.tag !== "select") throw new Error("The selected target is not a <select> element."); if (action !== "hover" && !await locator.isEnabled()) throw new Error("The selected target is disabled."); if (action === "hover") await locator.hover({ trial: true, timeout: 8000 }); else if (action !== "select") await locator.click({ trial: true, timeout: 8000 }); const box = await locator.boundingBox(); if (!box || box.width <= 0 || box.height <= 0) throw new Error("The target has no visible bounding box."); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), rect: { left: box.x, top: box.y, width: box.width, height: box.height } }; }',
					prep.selector,
					action,
					prep.tag,
					prep.label
				);
			};
			const formatActionFailure = async (message: string): Promise<IDardcorBrowserAgentToolResult> => {
				try {
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					return {
						executionStatus: 'failed',
						output: DardcorBrowserAgentController.formatPageSnapshot(snapshot, `❌ Browser action failed: ${message}`, await captureConsoleLogs())
					};
				} catch (snapshotError) {
					const detail = formatAgentToolError(snapshotError);
					return { executionStatus: 'failed', output: `❌ Browser action failed: ${message}. Current page evidence is unavailable: ${detail}` };
				}
			};

			try {
			switch (normalizedName) {

				case 'read_browser_page':
				case 'read_page': {
					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1500);
					await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('🔍 Scanning page elements...')`);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(snapshot, undefined, consoleLogs)
					};
				}

				case 'click_element':
				case 'click_browser': {
					let x: number | undefined = typeof args?.x === 'number' ? args.x : undefined;
					let y: number | undefined = typeof args?.y === 'number' ? args.y : undefined;
					if (typeof args?.coordinate === 'string' && args.coordinate.includes(',')) {
						const parts = args.coordinate.split(',').map((n: string) => parseFloat(n.trim()));
						if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
							x = parts[0];
							y = parts[1];
						}
					}

					const targetOpts = {
						selector: args?.selector,
						elementId: args?.elementId ?? args?.id ?? args?.index,
						text: args?.text ?? args?.label,
						x,
						y
					};

					const prep = await evaluate<any>(`
						window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(targetOpts)}, '🎯 Clicking', true)
					`, 12000);

					if (!prep || !prep.found) {
						const fallbackSnapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
						const consoleLogs = await captureConsoleLogs();
						return {
							output: DardcorBrowserAgentController.formatPageSnapshot(
								fallbackSnapshot,
								`❌ Could not find element matching ${JSON.stringify(targetOpts)}. Check the Interactive Elements list below and use \`elementId\` (e.g. "1", "2") or an exact selector.`,
								consoleLogs
							)
						};
					}
					const beforeSnapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const actionPoint = await getActionPoint(prep, 'click');
					prep.x = actionPoint.x;
					prep.y = actionPoint.y;
					prep.rect = actionPoint.rect ?? prep.rect;

					await moveCursorAndMouse(prep.x, prep.y, `🎯 Clicking ${prep.label}`, prep.rect);
					const clickCount = args?.doubleClick ? 2 : 1;
					const button = args?.button === 'right' ? 'right' : args?.button === 'middle' ? 'middle' : 'left';
					await performDardcorBrowserClick(playwrightService, sessionId, view.id, prep.x, prep.y, { button, clickCount, selector: prep.selector });
					await evaluate(`window.__dardcorBrowserAgentRuntime.animatePress(${prep.x}, ${prep.y})`);

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 2600);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					const observedChanges = getDardcorBrowserSnapshotChanges(beforeSnapshot, snapshot);

					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Clicked <${prep.tag}> "${prep.label}" at (${prep.x}, ${prep.y}) [matched via ${prep.matchedBy}]. One Playwright click was sent. Post-action evidence: ${observedChanges.join(', ') || 'no observable page or interactive-control change'}.`,
							consoleLogs
						)
					};
				}

				case 'type_in_page':
				case 'type_browser': {
					const textToType = typeof args?.text === 'string' ? args.text : String(args?.value ?? '');
					const clearFirst = args?.clearFirst !== false;
					const pressEnter = Boolean(args?.pressEnter || args?.submit);

					const targetOpts = {
						selector: args?.selector,
						elementId: args?.elementId ?? args?.id ?? args?.index,
						text: args?.label ?? args?.placeholder
					};

					let prep: any;
					if (targetOpts.selector || targetOpts.elementId || targetOpts.text) {
						prep = await evaluate<any>(`
							window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(targetOpts)}, '⌨️ Typing into', true)
						`, 12000);
					} else {
						prep = await evaluate<any>(`
							(() => {
								const active = document.activeElement;
								if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
									return window.__dardcorBrowserAgentRuntime.prepareElementForInteraction({
										elementId: active.getAttribute('data-dardcor-id') || active.id || 'input'
									}, '⌨️ Typing into', true);
								}
								return window.__dardcorBrowserAgentRuntime.prepareElementForInteraction({
									selector: 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'
								}, '⌨️ Typing into', true);
							})()
						`, 12000);
					}

					if (!prep || !prep.found) {
						const fallbackSnapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
						const consoleLogs = await captureConsoleLogs();
						return {
							output: DardcorBrowserAgentController.formatPageSnapshot(
								fallbackSnapshot,
								`❌ Could not find input field matching ${JSON.stringify(targetOpts)}. Specify \`elementId\` or \`selector\` from the Interactive Elements list below.`,
								consoleLogs
							)
						};
					}
					const actionPoint = await getActionPoint(prep, 'input');
					prep.x = actionPoint.x;
					prep.y = actionPoint.y;
					prep.rect = actionPoint.rect ?? prep.rect;

					await moveCursorAndMouse(prep.x, prep.y, `⌨️ Typing into ${prep.label}`, prep.rect);
					await DardcorBrowserAgentController.invokePlaywright(
						playwrightService,
						view,
						sessionId,
						'async (page, selector, x, y, value, clear, submit) => { if (selector) { const locator = page.locator(selector); const count = await locator.count(); if (count !== 1) throw new Error("Expected one input target for selector, found " + count + ". Refresh the page snapshot and choose a unique target."); await locator.click({ timeout: 8000 }); } else { await page.mouse.click(x, y); } if (clear) await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(value); if (submit) await page.keyboard.press("Enter"); return true; }',
						prep.selector ?? '',
						prep.x,
						prep.y,
						textToType,
						clearFirst,
						pressEnter
					);
					await evaluate(`window.__dardcorBrowserAgentRuntime.animatePress(${prep.x}, ${prep.y})`);

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, pressEnter ? 3000 : 1200);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();

					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Typed \`"${textToType}"\` into <${prep.tag}> "${prep.label}"${pressEnter ? ' and pressed Enter' : ''}.`,
							consoleLogs
						)
					};
				}

				case 'scroll_browser_page':
				case 'scroll_page': {
					const direction = String(args?.direction || 'down').toLowerCase();
					const amount = typeof args?.amount === 'number' ? args.amount : 550;
					const selector = args?.selector;
					const elementId = args?.elementId;

					if (selector || elementId) {
						const prep = await evaluate<any>(`
							window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify({ selector, elementId })}, '🖱️ Scrolled to')
						`);
						if (prep?.found) {
							await DardcorBrowserAgentController.invokePlaywright(
								playwrightService,
								view,
								sessionId,
								'async (page, targetSelector) => { await page.locator(targetSelector).scrollIntoViewIfNeeded(); return true; }',
								prep.selector
							);
						}
						const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
						const consoleLogs = await captureConsoleLogs();
						return {
							output: DardcorBrowserAgentController.formatPageSnapshot(
								snapshot,
								prep?.found
									? `✅ Scrolled to element <${prep.tag}> "${prep.label}".`
									: `⚠️ Could not find element ${selector || elementId} to scroll to.`,
								consoleLogs
							)
						};
					}

					await evaluate(`window.__dardcorBrowserAgentRuntime.animateCursorTo(Math.round(innerWidth / 2), Math.round(innerHeight / 2), ${JSON.stringify(`🖱️ Scrolling ${direction}`)})`);
					await DardcorBrowserAgentController.invokePlaywright(
						playwrightService,
						view,
						sessionId,
						'async (page, direction, amount) => { const size = page.viewportSize() || { width: 1024, height: 768 }; await page.mouse.move(Math.round(size.width / 2), Math.round(size.height / 2)); if (direction === "top" || direction === "bottom") { await page.evaluate(dir => window.scrollTo(0, dir === "top" ? 0 : document.documentElement.scrollHeight), direction); } else { const x = direction === "left" ? -amount : direction === "right" ? amount : 0; const y = direction === "up" ? -amount : direction === "down" ? amount : 0; await page.mouse.wheel(x, y); } return true; }',
						direction,
						amount
					);

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1500);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						executionStatus: 'succeeded',
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Scrolled browser page **${direction}** (${amount}px). Current scroll Y=${snapshot.scrollY}/${snapshot.scrollHeight}px.`,
							consoleLogs
						)
					};
				}

				case 'hover_element':
				case 'hover_browser': {
					const targetOpts = {
						selector: args?.selector,
						elementId: args?.elementId ?? args?.id,
						text: args?.text,
						x: args?.x,
						y: args?.y
					};

					const prep = await evaluate<any>(`
						window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(targetOpts)}, '✨ Hovering', true)
					`, 10000);

					if (!prep || !prep.found) {
						const fallbackSnapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
						const consoleLogs = await captureConsoleLogs();
						return {
							output: DardcorBrowserAgentController.formatPageSnapshot(
								fallbackSnapshot,
								`❌ Could not find element to hover matching ${JSON.stringify(targetOpts)}.`,
								consoleLogs
							)
						};
					}
					const actionPoint = await getActionPoint(prep, 'hover');
					prep.x = actionPoint.x;
					prep.y = actionPoint.y;
					prep.rect = actionPoint.rect ?? prep.rect;

					await moveCursorAndMouse(prep.x, prep.y, '✨ Hovering', prep.rect);

					await new Promise(r => setTimeout(r, 300));
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Hovered Dardcor cursor over <${prep.tag}> "${prep.label}" at (${prep.x}, ${prep.y}).`,
							consoleLogs
						)
					};
				}

				case 'press_key': {
					const key = String(args?.key || 'Enter');
					await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay(${JSON.stringify(`⌨️ Key: ${key}`)})`);
					await DardcorBrowserAgentController.invokePlaywright(
						playwrightService,
						view,
						sessionId,
						'async (page, key) => { await page.keyboard.press(key); return true; }',
						key === ' ' ? 'Space' : key
					);

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1500);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Pressed keyboard key \`${key}\`.`,
							consoleLogs
						)
					};
				}

				case 'select_option': {
					const targetOpts = {
						selector: args?.selector,
						elementId: args?.elementId ?? args?.id,
						text: args?.label
					};

					const prep = await evaluate<any>(`
						window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(targetOpts)}, '📋 Selecting option in', true)
					`, 10000);

					if (!prep || !prep.found) {
						const fallbackSnapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
						const consoleLogs = await captureConsoleLogs();
						return {
							output: DardcorBrowserAgentController.formatPageSnapshot(
								fallbackSnapshot,
								`❌ Could not find <select> element matching ${JSON.stringify(targetOpts)}.`,
								consoleLogs
							)
						};
					}
					const actionPoint = await getActionPoint(prep, 'select');
					prep.x = actionPoint.x;
					prep.y = actionPoint.y;
					prep.rect = actionPoint.rect ?? prep.rect;

					await evaluate(`window.__dardcorBrowserAgentRuntime.animatePress(${prep.x}, ${prep.y})`);
					const selectResult = await evaluate<{ success: boolean; selectedText?: string; selectedValue?: string; error?: string }>(`
						(() => {
							const res = window.__dardcorBrowserAgentRuntime.resolveTargetElement(${JSON.stringify(targetOpts)});
							const el = res && res.element;
							if (!el || el.tagName.toLowerCase() !== 'select') {
								return { success: false, error: 'Target element is not a <select> dropdown.' };
							}
							const options = Array.from(el.options);
							const desiredValue = ${JSON.stringify(args?.value)};
							const desiredLabel = ${JSON.stringify(args?.optionText ?? args?.text ?? args?.value)};
							const desiredIndex = ${JSON.stringify(args?.index)};

							let matchedOpt = null;
							if (typeof desiredIndex === 'number' && options[desiredIndex]) {
								matchedOpt = options[desiredIndex];
							} else if (desiredValue !== undefined) {
								matchedOpt = options.find(o => o.value === String(desiredValue) || o.text.trim().toLowerCase() === String(desiredValue).trim().toLowerCase());
							}
							if (!matchedOpt && desiredLabel !== undefined) {
								const needle = String(desiredLabel).trim().toLowerCase();
								matchedOpt = options.find(o => o.text.trim().toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle));
							}

							if (!matchedOpt) {
								return { success: false, error: 'Option not found. Available options: ' + options.map(o => o.text.trim() + ' (' + o.value + ')').join(', ') };
							}

							return { success: true, selectedText: matchedOpt.text.trim(), selectedValue: matchedOpt.value };
						})()
					`);
					if (selectResult?.success) {
						await moveCursorAndMouse(prep.x, prep.y, `📋 Selecting ${selectResult.selectedText}`, prep.rect);
						await DardcorBrowserAgentController.invokePlaywright(
							playwrightService,
							view,
							sessionId,
							'async (page, x, y, selector, value) => { await page.mouse.click(x, y); await page.locator(selector).selectOption(value); return true; }',
							prep.x,
							prep.y,
							prep.selector,
							selectResult.selectedValue
						);
						await evaluate(`window.__dardcorBrowserAgentRuntime.animatePress(${prep.x}, ${prep.y})`);
						await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay(${JSON.stringify(`📋 Selected "${selectResult.selectedText}"`)})`);
					}

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1500);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							selectResult?.success
								? `✅ Selected option "${selectResult.selectedText}" (value=\`${selectResult.selectedValue}\`) on <${prep.tag}> "${prep.label}".`
								: `⚠️ Failed to select option: ${selectResult?.error || 'Unknown error'}`,
							consoleLogs
						)
					};
				}

				case 'drag_and_drop': {
					const sourceOpts = {
						selector: args?.sourceSelector ?? args?.fromSelector,
						elementId: args?.sourceElementId ?? args?.fromElementId,
						x: args?.sourceX,
						y: args?.sourceY
					};
					const targetOpts = {
						selector: args?.targetSelector ?? args?.toSelector,
						elementId: args?.targetElementId ?? args?.toElementId,
						x: args?.targetX,
						y: args?.targetY
					};

					const srcPrep = await evaluate<any>(`
						window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(sourceOpts)}, '✊ Grabbing', true)
					`);
					if (!srcPrep?.found) {
						return formatActionFailure(`could not find drag source matching ${JSON.stringify(sourceOpts)}`);
					}

					const dstPrep = await evaluate<any>(`
						window.__dardcorBrowserAgentRuntime.prepareElementForInteraction(${JSON.stringify(targetOpts)}, '🎯 Dropping onto', true)
					`);
					if (!dstPrep?.found) {
						return formatActionFailure(`could not find drop target matching ${JSON.stringify(targetOpts)}`);
					}

					await moveCursorAndMouse(srcPrep.x, srcPrep.y, '✊ Grabbing', srcPrep.rect);
					await DardcorBrowserAgentController.invokePlaywright(playwrightService, view, sessionId, 'async page => { await page.mouse.down(); return true; }');
					try {
						await moveCursorAndMouse(dstPrep.x, dstPrep.y, '🎯 Dropping', dstPrep.rect);
					} finally {
						await DardcorBrowserAgentController.invokePlaywright(playwrightService, view, sessionId, 'async page => { await page.mouse.up(); return true; }');
					}

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1600);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Dragged from (${srcPrep.x}, ${srcPrep.y}) and dropped onto (${dstPrep.x}, ${dstPrep.y}).`,
							consoleLogs
						)
					};
				}

				case 'wait_for_browser': {
					const timeoutMs = Math.min(15000, Math.max(500, Number(args?.timeoutMs) || 5000));
					const selector = typeof args?.selector === 'string' ? args.selector.trim() : '';
					const text = typeof args?.text === 'string' ? args.text.trim() : '';

					await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('⏳ Waiting for page condition...')`);

					const startTime = Date.now();
					let conditionMet = false;
					let readinessFailure: string | undefined;

					while (Date.now() - startTime < timeoutMs) {
						if (!selector && !text) {
							const remainingMs = timeoutMs - (Date.now() - startTime);
							try {
								conditionMet = await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, Math.min(1000, remainingMs));
							} catch (error) {
								if (isCancellationError(error)) {
									throw error;
								}
								const message = formatAgentToolError(error);
								if (!/document did not become ready within/i.test(message)) {
									throw error;
								}
								readinessFailure = message;
								break;
							}
							if (conditionMet) {
								break;
							}
							await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, timeoutMs - (Date.now() - startTime)))));
							continue;
						}
						const matched = await evaluate<boolean>(`
							(() => {
								const sel = ${JSON.stringify(selector)};
								const txt = ${JSON.stringify(text)};
								if (sel) {
									try {
										const el = document.querySelector(sel);
										if (el) return true;
									} catch (_) {}
								}
								if (txt) {
									const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
									if (bodyText.includes(txt.toLowerCase())) return true;
								}
								return false;
							})()
						`);

						if (matched) {
							conditionMet = true;
							break;
						}
						await new Promise(r => setTimeout(r, 250));
					}

					let snapshot: IDardcorPageSnapshot | undefined;
					try {
						snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					} catch (error) {
						if (!readinessFailure) {
							throw error;
						}
						return {
							executionStatus: 'timedOut',
							output: `⚠️ Timed out after ${timeoutMs}ms waiting for the integrated browser document to become ready. Snapshot unavailable: ${formatAgentToolError(error)}. Readiness detail: ${readinessFailure}`
						};
					}
					const consoleLogs = await captureConsoleLogs();
					return {
						executionStatus: conditionMet ? 'succeeded' : 'timedOut',
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							conditionMet
								? `✅ Wait condition met (${selector || text || 'DOM stable'}).`
								: `⚠️ Timeout (${timeoutMs}ms) waiting for ${selector || text || 'a stable DOM'}. Showing current page state.${readinessFailure ? ` Readiness detail: ${readinessFailure}` : ''}`,
							consoleLogs
						)
					};
				}

				case 'execute_browser_script': {
					const script = String(args?.script || args?.code || '');
					if (!script.trim()) {
						return formatActionFailure('`script` parameter is required for `execute_browser_script`');
					}

					await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('⚡ Executing script in page...')`);

					let evalOutput: string;
					let scriptFailed = false;
					try {
						const functionBody = script.includes('return ') && !script.trim().startsWith('(') ? script : `return (${script});`;
						const wrapped = `async (page) => page.evaluate(async () => { ${functionBody} })`;
						const res = await DardcorBrowserAgentController.invokePlaywright(playwrightService, view, sessionId, wrapped);
						evalOutput = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
					} catch (err: any) {
						scriptFailed = true;
						evalOutput = `❌ Script Error: ${formatAgentToolError(err)}`;
					}

					await DardcorBrowserAgentController.waitTillHTMLStable(evaluate, 1200);
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						executionStatus: scriptFailed ? 'failed' : 'succeeded',
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`**Script Execution Result:**\n\`\`\`json\n${evalOutput ?? 'undefined'}\n\`\`\``,
							consoleLogs
						)
					};
				}

				case 'get_browser_console_logs': {
					const nativeLogs = await captureConsoleLogs();
					const inPageLogs = await evaluate<{ logs: string[]; dialogs: string[] }>(`
						(() => ({
							logs: window.__dardcorCapturedLogs || [],
							dialogs: window.__dardcorCapturedDialogs || []
						}))()
					`);

					const sections: string[] = [
						`### Browser Console & Runtime Diagnostics (${view.url || 'active tab'})`
					];
					if (inPageLogs.dialogs.length > 0) {
						sections.push(`#### Captured Dialogs (alert/confirm/prompt)\n${inPageLogs.dialogs.join('\n')}`);
					}
					if (inPageLogs.logs.length > 0) {
						sections.push(`#### In-Page Runtime Exceptions & Warnings\n${inPageLogs.logs.join('\n')}`);
					}
					if (nativeLogs && nativeLogs.trim()) {
						sections.push(`#### Chromium Console Buffer\n${nativeLogs.trim()}`);
					}
					if (sections.length === 1) {
						sections.push(`✅ No console errors or warnings recorded on this page.`);
					}
					return { output: sections.join('\n\n') };
				}

				case 'handle_browser_dialog': {
					const accept = args?.accept !== false;
					const promptText = typeof args?.promptText === 'string' ? args.promptText : '';

					await evaluate(`
						(() => {
							if (window.__dardcorBrowserAgentRuntime) {
								window.__dardcorBrowserAgentRuntime.state.nextDialogAction = {
									accept: ${JSON.stringify(accept)},
									promptText: ${JSON.stringify(promptText)}
								};
								window.__dardcorBrowserAgentRuntime.wakeOverlay('🔔 Dialog policy: ' + (${JSON.stringify(accept)} ? 'Accept' : 'Dismiss'));
							}
						})()
					`);

					await sendPageCommand('Page.handleJavaScriptDialog', {
						accept,
						promptText: promptText || undefined
					});

					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`✅ Configured browser dialog handler (accept=${accept}${promptText ? `, promptText="${promptText}"` : ''}).`,
							consoleLogs
						)
					};
				}

				case 'screenshot_browser_page':
				case 'screenshot_page': {
					await evaluate(`window.__dardcorBrowserAgentRuntime.wakeOverlay('📸 Capturing page screenshot...')`);
					const buf = await model.captureScreenshot({ quality: 85, format: 'png' });
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					const byteSize = buf ? buf.byteLength : 0;
					if (byteSize === 0) {
						throw new Error('Integrated browser returned an empty screenshot.');
					}
					let binary = '';
					for (let offset = 0; offset < buf.buffer.length; offset += 0x8000) {
						binary += String.fromCharCode(...buf.buffer.subarray(offset, Math.min(offset + 0x8000, buf.buffer.length)));
					}
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(
							snapshot,
							`📸 Captured live screenshot of \`${snapshot.url}\` (${byteSize > 0 ? `${Math.round(byteSize / 1024)} KB` : 'active viewport'}) along with the complete interactive DOM snapshot below.`,
							consoleLogs
						),
						image: { mimeType: 'image/png', base64: btoa(binary) }
					};
				}

				default: {
					const snapshot = await evaluate<IDardcorPageSnapshot>(`window.__dardcorBrowserAgentRuntime.collectPageSnapshot()`);
					const consoleLogs = await captureConsoleLogs();
					return {
						output: DardcorBrowserAgentController.formatPageSnapshot(snapshot, undefined, consoleLogs)
					};
				}
			}
			} catch (error) {
				const message = formatAgentToolError(error);
				if (token.isCancellationRequested || isCancellationError(error)) {
					return { executionStatus: 'cancelled', output: `Browser action was cancelled while performing ${normalizedName}: ${message}. No successful browser verification was recorded.` };
				}
				return formatActionFailure(message);
			}
		}, sessionId, token);
	}
}
