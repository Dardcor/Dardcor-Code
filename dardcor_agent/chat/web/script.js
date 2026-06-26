marked.setOptions({
    highlight: function (code, lang) {
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
    // ── KEY FIX: every new user message ends the previous agent turn ──
    // Settle any active work panel so the next agent response starts fresh.
    settleCurrentWorkPanel();

    const safeText = escapeHtml(text);
    const div = document.createElement('div');
    div.className = 'message user-msg';
    div.innerHTML = `
        <div class="content">${safeText}</div>
        <div class="user-actions">
            <a onclick="handleAction('copy', '${safeEncode(text)}')"><img src="../../../image/copy.svg" width="14" height="14" alt="Copy"></a>
            <a onclick="handleAction('retry', '${safeEncode(retry_text)}')"><img src="../../../image/retry.svg" width="14" height="14" alt="Retry"></a>
            <a onclick="handleAction('revert', '${safeEncode(retry_text)}')"><img src="../../../image/edit.svg" width="14" height="14" alt="Edit"></a>
        </div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function appendAgentMessage(text, isHtml) {
    // Agent message also ends (settles) the current work panel
    settleCurrentWorkPanel();

    // Preprocess <thought>...</thought> tags into collapsible details blocks
    let processedText = text;
    if (!isHtml) {
        processedText = processedText.replace(/<thought>([\s\S]*?)<\/thought>/gi, function(match, innerContent) {
            return `\n<details class="thought-block"><summary><span>🧠 Agent is thinking...</span></summary><div class="thought-content">\n\n${innerContent}\n\n</div></details>\n`;
        });
    }

    const div = document.createElement('div');
    div.className = 'message agent-msg';
    let contentHtml = isHtml ? processedText : marked.parse(processedText);
    div.innerHTML = `
        <div class="content">${contentHtml}</div>
        <div class="agent-actions">
            <a onclick="handleAction('copy', '${safeEncode(text)}')"><img src="../../../image/copy.svg" width="14" height="14" alt="Copy"></a>
        </div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = text;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function showNotification(text) {
    const banner = document.createElement('div');
    banner.className = 'top-notification';
    banner.innerHTML = marked.parse(text);
    document.body.insertBefore(banner, document.body.firstChild);
    setTimeout(() => banner.remove(), 10000);
}

function toggleTool(headerEl) {
    const bodyEl = headerEl.nextElementSibling;
    const isExpanded = bodyEl.classList.contains('open');
    if (isExpanded) {
        bodyEl.classList.remove('open');
        headerEl.querySelector('.marker').innerHTML = '<img src="../../../image/chevron-right.svg" width="14" height="14" style="vertical-align: middle;">';
    } else {
        bodyEl.classList.add('open');
        headerEl.querySelector('.marker').innerHTML = '<img src="../../../image/chevron-down.svg" width="14" height="14" style="vertical-align: middle;">';
    }
}

function toggleToolList(buttonEl) {
    const panel = buttonEl.closest('.agent-work-msg');
    const list = panel.querySelector('.tool-list');
    const isCollapsed = list.classList.contains('collapsed');
    list.classList.toggle('collapsed', !isCollapsed);
    buttonEl.innerHTML = isCollapsed
        ? '<img src="../../../image/chevron-down.svg" width="14" height="14" style="vertical-align: middle;">'
        : '<img src="../../../image/chevron-right.svg" width="14" height="14" style="vertical-align: middle;">';
    buttonEl.title = isCollapsed ? 'Hide tool calls' : 'Show tool calls';
}

// ── Settle helper: marks the current panel as done and detaches it ──
function settleCurrentWorkPanel() {
    if (currentWorkPanel && !currentWorkPanel.classList.contains('settled')) {
        currentWorkPanel.classList.add('settled');
        const textEl = currentWorkPanel.querySelector('.work-text');
        if (textEl) textEl.textContent = 'Done';
        const bubble = currentWorkPanel.querySelector('.typing-bubble');
        if (bubble) bubble.classList.add('done');
    }
    currentWorkPanel = null;
}

function createWorkPanel(state) {
    const div = document.createElement('div');
    div.className = 'agent-work-msg';
    div.innerHTML = `
        <div class="work-header">
            <div class="work-left">
                <div class="typing-bubble small">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </div>
                <span class="work-text">${state === 'thinking' ? 'Dardcor Agent is thinking...' : 'Dardcor Agent is working...'}</span>
            </div>
            <button class="tool-list-toggle" onclick="toggleToolList(this)" title="Hide tool calls">
                <img src="../../../image/chevron-down.svg" width="14" height="14" style="vertical-align: middle;">
            </button>
        </div>
        <div class="tool-list"></div>
    `;
    chatContainer.appendChild(div);
    return div;
}

function ensureWorkPanel(state) {
    // Create a fresh panel if none exists, or if the current one is already settled/done
    if (!currentWorkPanel || currentWorkPanel.classList.contains('settled')) {
        currentWorkPanel = createWorkPanel(state);
    }
    const textEl = currentWorkPanel.querySelector('.work-text');
    if (textEl) textEl.textContent = state === 'thinking' ? 'Dardcor Agent is thinking...' : 'Dardcor Agent is working...';
    currentWorkPanel.classList.remove('hidden', 'settled');
    return currentWorkPanel;
}

function toolStatusLabel(status) {
    if (status === 'running') return 'Running';
    if (status === 'success') return 'Done';
    if (status === 'error') return 'Error';
    return status || 'Unknown';
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
    // Update border-left color via inline style for immediate visual feedback
    if (status === 'success') {
        card.style.borderLeftColor = '#4ec9b0';
    } else if (status === 'error') {
        card.style.borderLeftColor = '#f14c4c';
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
    div.innerHTML = `
        <div class="tool-header" onclick="toggleTool(this)">
            <span class="tool-title"><span class="marker"><img src="../../../image/chevron-right.svg" width="14" height="14" style="vertical-align: middle;"></span><span class="tool-name">${escapeHtml(toolName)}</span></span>
            <span class="tool-status ${status}">${toolStatusLabel(status)}</span>
        </div>
        <div class="tool-body">${escapeHtml(args)}</div>
    `;
    toolCards.set(toolId, div);
    const panel = ensureWorkPanel('working');
    panel.querySelector('.tool-list').appendChild(div);
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
    if (show) {
        ensureWorkPanel(state);
        scrollToBottom();
    } else {
        // Mark all still-running tool cards as error/stopped
        for (const [toolId, card] of toolCards.entries()) {
            if (card.classList.contains('running')) {
                applyStatusUpdate(card, 'error');
            }
        }
        if (currentWorkPanel) {
            currentWorkPanel.classList.add('settled');
            currentWorkPanel.querySelector('.work-text').textContent = 'Done';
            currentWorkPanel.querySelector('.typing-bubble').classList.add('done');
            currentWorkPanel = null;
        }
    }
}

function clearChat() {
    chatContainer.innerHTML = '';
    toolCards.clear();
    currentWorkPanel = null;
}
