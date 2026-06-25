// Configure marked.js to use highlight.js
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

// UTF-8 safe base64 encode (replaces btoa which crashes on Unicode)
function safeEncode(text) {
    return btoa(encodeURIComponent(String(text)).replace(/%([0-9A-F]{2})/g, function (_, p1) {
        return String.fromCharCode(parseInt(p1, 16));
    }));
}

// Setup QWebChannel to connect with Python
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
    const div = document.createElement('div');
    div.className = 'message agent-msg';
    let contentHtml = isHtml ? text : marked.parse(text);
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
    if (!currentWorkPanel || currentWorkPanel.classList.contains('settled')) {
        currentWorkPanel = createWorkPanel(state);
    }
    currentWorkPanel.querySelector('.work-text').textContent = state === 'thinking' ? 'Dardcor Agent is thinking...' : 'Dardcor Agent is working...';
    currentWorkPanel.classList.remove('hidden', 'settled');
    return currentWorkPanel;
}

function toolStatusLabel(status) {
    if (status === 'running') return 'Running';
    if (status === 'success') return 'Done';
    if (status === 'error') return 'Error';
    return status || 'Unknown';
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
        existing.className = `tool-call ${status}`;
        existing.querySelector('.tool-status').textContent = toolStatusLabel(status);
        existing.querySelector('.tool-status').className = `tool-status ${status}`;
        scrollToBottom();
        return;
    }

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
