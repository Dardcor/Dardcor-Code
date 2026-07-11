const markdown = window.marked || {
    parse: function (text) {
        return escapeHtml(text).replace(/\n/g, "<br>");
    },
    setOptions: function () {}
};

markdown.setOptions({
    highlight: function (code, lang) {
        if (!window.hljs) return code;
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
    },
    breaks: true,
    gfm: true
});

let backend = null;
const toolCards = new Map();
let currentWorkPanel = null;

function safeEncode(text) {
    return btoa(encodeURIComponent(String(text)).replace(/%([0-9A-F]{2})/g, function (_, p1) {
        return String.fromCharCode(parseInt(p1, 16));
    }));
}

new QWebChannel(qt.webChannelTransport, function (channel) {
    backend = channel.objects.backend;

    backend.append_user_message.connect(appendUserMessage);
    backend.append_agent_message.connect(appendAgentMessage);
    backend.append_system_message.connect(appendSystemMessage);
    backend.append_tool_call.connect(appendToolCall);
    backend.update_tool_output.connect(updateToolOutput);
    backend.show_typing.connect(showTyping);
    backend.clear_chat.connect(clearChat);
    backend.show_notification.connect(showNotification);
});

const chatContainer = document.getElementById('chat-container');
const welcomeBanner = document.getElementById('welcome-banner');

function hideWelcome() {
    if (welcomeBanner && !welcomeBanner.classList.contains('hidden')) {
        welcomeBanner.classList.add('hidden');
    }
}

function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function handleAction(action, payload) {
    if (backend) backend.handle_action(action, payload);
}

function appendUserMessage(text, retry_text) {
    hideWelcome();
    // Each user message ends the previous agent turn.
    settleCurrentWorkPanel();

    const safeText = escapeHtml(text);
    const div = document.createElement('div');
    div.className = 'message user-msg';
    div.innerHTML = `
        <div class="content">${safeText}</div>
        <div class="user-actions">
            <a onclick="handleAction('copy', '${safeEncode(text)}')"><img src="../../image/copy.svg" width="14" height="14" alt="Copy"></a>
            <a onclick="handleAction('retry', '${safeEncode(retry_text)}')"><img src="../../image/retry.svg" width="14" height="14" alt="Retry"></a>
            <a onclick="handleAction('revert', '${safeEncode(retry_text)}')"><img src="../../image/edit.svg" width="14" height="14" alt="Edit"></a>
        </div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function appendAgentMessage(text, isHtml) {
    hideWelcome();
    // Render <thought>...</thought> tags as collapsed reasoning blocks.
    let processedText = text;
    if (!isHtml) {
        processedText = processedText.replace(/<thought>([\s\S]*?)<\/thought>/gi, function(match, innerContent) {
            return `\n<div class="thought-block"><div class="thought-header" onclick="toggleThought(this)"><span class="marker">\u25B8</span><span>Thoughts</span></div><div class="thought-content">\n\n${innerContent}\n\n</div></div>\n`;
        });
        processedText = processedText.replace(/<thought>([\s\S]*)$/gi, function(match, innerContent) {
            return `\n<div class="thought-block"><div class="thought-header" onclick="toggleThought(this)"><span class="marker">\u25BE</span><span>Thoughts</span></div><div class="thought-content open">\n\n${innerContent}\n\n</div></div>\n`;
        });
    }

    const div = document.createElement('div');
    div.className = 'message agent-msg';
    let contentHtml = isHtml ? processedText : markdown.parse(processedText);
    div.innerHTML = `
        <div class="content">${contentHtml}</div>
        <div class="agent-actions">
            <a onclick="handleAction('copy', '${safeEncode(text)}')"><img src="../../image/copy.svg" width="14" height="14" alt="Copy"></a>
        </div>
    `;
    chatContainer.appendChild(div);
    if (currentWorkPanel) {
        chatContainer.appendChild(currentWorkPanel);
    }
    scrollToBottom();
}

function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = text;
    chatContainer.appendChild(div);
    if (currentWorkPanel) {
        chatContainer.appendChild(currentWorkPanel);
    }
    scrollToBottom();
}

function showNotification(text) {
    const banner = document.createElement('div');
    banner.className = 'top-notification';
    banner.innerHTML = markdown.parse(text);
    document.body.insertBefore(banner, document.body.firstChild);
    setTimeout(() => banner.remove(), 10000);
}

function setCollapseMarker(markerEl, expanded) {
    if (!markerEl) return;
    markerEl.textContent = expanded ? '\u25BE' : '\u25B8';
}

function toggleExpandable(headerEl, bodyEl) {
    const isExpanded = bodyEl.classList.contains('open');
    if (!isExpanded) {
        closeOtherExpandables(bodyEl);
        bodyEl.classList.add('open');
        setCollapseMarker(headerEl.querySelector('.marker'), true);
        if (window.gsap) {
            gsap.fromTo(bodyEl, {height: 0, opacity: 0}, {height: "auto", opacity: 1, duration: 0.3, ease: "power2.out"});
        }
    } else {
        setCollapseMarker(headerEl.querySelector('.marker'), false);
        if (window.gsap) {
            gsap.to(bodyEl, {height: 0, opacity: 0, duration: 0.3, ease: "power2.in", onComplete: () => {
                bodyEl.classList.remove('open');
                bodyEl.style.height = "";
                bodyEl.style.opacity = "";
            }});
        } else {
            bodyEl.classList.remove('open');
        }
    }
}

function toggleThought(headerEl) {
    toggleExpandable(headerEl, headerEl.nextElementSibling);
}

function toggleTool(headerEl) {
    toggleExpandable(headerEl, headerEl.nextElementSibling);
}

function toggleToolList(headerEl) {
    const panel = headerEl.closest('.agent-work-msg');
    const list = panel.querySelector('.tool-list');
    const isCollapsed = list.classList.contains('collapsed');
    list.classList.toggle('collapsed', !isCollapsed);
    setCollapseMarker(headerEl.querySelector('.work-marker'), !isCollapsed);
    headerEl.title = isCollapsed ? 'Hide tool calls' : 'Show tool calls';
}

function closeOtherExpandables(exceptElement) {
    document.querySelectorAll('.thought-content.open, .tool-body.open').forEach(body => {
        if (body !== exceptElement) {
            const header = body.previousElementSibling;
            if (header) {
                setCollapseMarker(header.querySelector('.marker'), false);
            }
            if (window.gsap) {
                gsap.to(body, {height: 0, opacity: 0, duration: 0.3, ease: "power2.in", onComplete: () => {
                    body.classList.remove('open');
                    body.style.height = "";
                    body.style.opacity = "";
                }});
            } else {
                body.classList.remove('open');
            }
        }
    });
}

function settleCurrentWorkPanel() {
    if (currentWorkPanel && !currentWorkPanel.classList.contains('settled')) {
        currentWorkPanel.classList.add('settled');
        const textEl = currentWorkPanel.querySelector('.work-text');
        if (textEl) {
            if (window.gsap) gsap.killTweensOf(textEl);
            textEl.style.opacity = 1;
            if (!currentWorkPanel.querySelector('.tool-call')) {
                textEl.textContent = 'Done';
            } else {
                textEl.textContent = textEl.textContent.replace('Dardcor Agent Working...', 'Dardcor Agent Finished');
            }
        }
        const bubble = currentWorkPanel.querySelector('.typing-bubble');
        if (bubble) bubble.classList.add('done');
    }
    currentWorkPanel = null;
}

function createWorkPanel(state) {
    const div = document.createElement('div');
    div.className = 'agent-work-msg';
    const text = state === 'thinking' ? 'Dardcor Agent Thinking...' : 'Dardcor Agent Working...';
    div.innerHTML = `
        <div class="work-header" onclick="toggleToolList(this)" title="Show tool calls">
            <span class="work-marker">\u25B8</span>
            <span class="work-text">${text}</span>
        </div>
        <div class="tool-list collapsed"></div>
    `;
    chatContainer.appendChild(div);
    
    const textEl = div.querySelector('.work-text');
    if (window.gsap) {
        gsap.to(textEl, { opacity: 0.4, yoyo: true, repeat: -1, duration: 0.8, ease: "power1.inOut" });
    }
    return div;
}

function ensureWorkPanel(state) {
    if (!currentWorkPanel || currentWorkPanel.classList.contains('settled')) {
        currentWorkPanel = createWorkPanel(state);
    }
    const textEl = currentWorkPanel.querySelector('.work-text');
    if (textEl && state === 'thinking' && !textEl.textContent.includes('Working')) {
        textEl.textContent = 'Dardcor Agent Thinking...';
    }
    currentWorkPanel.classList.remove('hidden', 'settled');
    return currentWorkPanel;
}

function toolStatusLabel(status) {
    if (status === 'running') return 'Running';
    if (status === 'success') return 'Done';
    if (status === 'error') return 'Error';
    return status || 'Unknown';
}

function toolAction(toolName) {
    const name = String(toolName || '');
    if (['read_file', 'list_files', 'glob_files', 'grep', 'search_files', 'semantic_search', 'detect_project'].includes(name)) return 'Read';
    if (['write_file', 'append_to_file', 'replace_file_content', 'multi_replace_file_content', 'apply_patch'].includes(name)) return 'Edit';
    if (name === 'delete_file') return 'Delete';
    if (name === 'move_file') return 'Move';
    if (name.startsWith('git_')) return 'Git';
    if (['run_command', 'check_syntax', 'manage_task'].includes(name)) return 'Run';
    if (['search_web', 'read_url'].includes(name)) return 'Fetch';
    if (name === 'update_core_memory') return 'Memory';
    return 'Tool';
}

function compactToolTarget(toolName, args) {
    try {
        const parsed = JSON.parse(args || '{}');
        const target = parsed.path || parsed.pattern || parsed.query || parsed.command || parsed.title || '';
        if (target) return String(target).split(/[\\/]/).pop() || String(target);
    } catch (_) {}
    return String(toolName || '').replace(/_/g, ' ');
}

function updateWorkSummary(panel) {
    const textEl = panel.querySelector('.work-text');
    if (!textEl) return;
    const calls = Array.from(panel.querySelectorAll('.tool-call'));
    const exploredFiles = new Set();
    let changed = 0;
    for (const call of calls) {
        const action = call.dataset.action;
        const tool = call.dataset.toolName;
        if (action === 'Read') {
            if (!['grep', 'search_files', 'semantic_search', 'glob_files', 'detect_project'].includes(tool)) {
                if (call.dataset.target) exploredFiles.add(call.dataset.target);
            }
        } else if (['Edit', 'Move', 'Delete'].includes(action)) {
            changed += 1;
        }
    }
    
    let summary = '';
    if (changed > 0) {
        summary = ` (Changed ${changed} ${changed === 1 ? 'file' : 'files'})`;
    } else if (exploredFiles.size > 0) {
        const n = exploredFiles.size;
        summary = ` (Explored ${n} ${n === 1 ? 'file' : 'files'})`;
    } else if (calls.length > 0) {
        const n = calls.length;
        summary = ` (Explored ${n} ${n === 1 ? 'file' : 'files'})`;
    }
    
    textEl.textContent = `Dardcor Agent Working...${summary}`;
}

// Queue for status updates that arrive before the card is created
const pendingStatusUpdates = new Map();

function applyStatusUpdate(card, status) {
    card.className = `tool-call ${status}`;
    const statusEl = card.querySelector('.tool-status');
    if (statusEl) {
        statusEl.textContent = toolStatusLabel(status);
        statusEl.className = `tool-status ${status}`;
    }
}

function appendToolCall(toolId, toolName, args, status) {
    if (status === undefined) {
        status = args;
        args = toolName;
        toolName = toolId;
        toolId = `${toolName}:${args}`;
    }

    const existing = toolCards.get(toolId);
    if (existing) {
        // UPDATE existing card's status
        applyStatusUpdate(existing, status);
        scrollToBottom();
        return;
    }

    // If this is a status update but the card doesn't exist yet (race condition),
    // store it and retry after a short delay
    if (status !== 'running') {
        pendingStatusUpdates.set(toolId, status);
        setTimeout(() => {
            const card = toolCards.get(toolId);
            const pending = pendingStatusUpdates.get(toolId);
            if (card && pending) {
                applyStatusUpdate(card, pending);
                pendingStatusUpdates.delete(toolId);
            }
        }, 150);
        return;
    }

    // CREATE new card
    const div = document.createElement('div');
    div.className = `tool-call ${status}`;
    const action = toolAction(toolName);
    const target = compactToolTarget(toolName, args);
    div.dataset.action = action;
    div.dataset.toolName = toolName;
    div.dataset.target = target;
    div.innerHTML = `
        <div class="tool-header" onclick="toggleTool(this)">
            <span class="tool-title"><span class="marker">\u25BE</span><span class="tool-name"><span class="tool-action">${escapeHtml(action)}</span> ${escapeHtml(target)}</span></span>
            <span class="tool-status ${status}">${toolStatusLabel(status)}</span>
        </div>
        <div class="tool-body open">${escapeHtml(args)}</div>
    `;

    // Automatically close other expandables when a new one appears
    closeOtherExpandables(div.querySelector('.tool-body'));
    toolCards.set(toolId, div);
    const panel = ensureWorkPanel('working');
    panel.querySelector('.tool-list').appendChild(div);
    updateWorkSummary(panel);
    scrollToBottom();

    // Check if there's a pending status update for this card (arrived before creation)
    const pendingStatus = pendingStatusUpdates.get(toolId);
    if (pendingStatus) {
        setTimeout(() => {
            applyStatusUpdate(div, pendingStatus);
            pendingStatusUpdates.delete(toolId);
        }, 30);
    }
}

function updateToolOutput(toolId, chunk) {
    const card = toolCards.get(toolId);
    if (!card) return;
    const body = card.querySelector('.tool-body');
    if (!body) return;

    // Find or create the live-output area inside the card body
    let outEl = body.querySelector('.tool-output');
    if (!outEl) {
        outEl = document.createElement('div');
        outEl.className = 'tool-output';
        body.appendChild(outEl);
    }

    outEl.textContent = chunk;
    scrollToBottom();
}

function showTyping(show, state) {
    const indicator = document.getElementById('typing-indicator');
    if (show) {
        ensureWorkPanel(state);
        if (indicator) {
            indicator.classList.remove('hidden');
            const textEl = document.getElementById('typing-text');
            if (textEl) {
                textEl.textContent = state === 'working' ? 'Working' : 'Thinking';
            }
        }
        scrollToBottom();
    } else {
        if (indicator) {
            indicator.classList.add('hidden');
        }
        // Mark all still-running tool cards as error/stopped
        for (const [toolId, card] of toolCards.entries()) {
            if (card.classList.contains('running')) {
                applyStatusUpdate(card, 'error');
            }
        }
        if (currentWorkPanel) {
            currentWorkPanel.classList.add('settled');
            const textEl = currentWorkPanel.querySelector('.work-text');
            if (textEl && !currentWorkPanel.querySelector('.tool-call')) textEl.textContent = 'Done';
            const bubble = currentWorkPanel.querySelector('.typing-bubble');
            if (bubble) bubble.classList.add('done');
            currentWorkPanel = null;
        }
    }
}

function clearChat() {
    chatContainer.innerHTML = '';
    toolCards.clear();
    currentWorkPanel = null;
    // Restore welcome banner on new chat
    if (welcomeBanner) {
        welcomeBanner.classList.remove('hidden');
    }
}
