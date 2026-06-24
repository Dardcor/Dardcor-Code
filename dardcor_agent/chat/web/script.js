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

// Setup QWebChannel to connect with Python
new QWebChannel(qt.webChannelTransport, function (channel) {
    backend = channel.objects.backend;

    // Wire up signals from Python
    backend.append_user_message.connect(appendUserMessage);
    backend.append_agent_message.connect(appendAgentMessage);
    backend.append_system_message.connect(appendSystemMessage);
    backend.append_tool_call.connect(appendToolCall);
    backend.show_typing.connect(showTyping);
    backend.clear_chat.connect(clearChat);
    backend.show_notification.connect(showNotification);
});

const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');

function scrollToBottom() {
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
    });
}

function handleAction(action, payload) {
    if (backend) {
        backend.handle_action(action, payload);
    }
}

function appendUserMessage(text, retry_text) {
    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const div = document.createElement('div');
    div.className = 'message user-msg';

    div.innerHTML = `
        <div class="content">${safeText}</div>
        <div class="user-actions">
            <a onclick="handleAction('copy', '${btoa(text)}')"><img src="../../../image/copy.svg" width="14" height="14" alt="Copy"></a>
            <a onclick="handleAction('retry', '${btoa(retry_text)}')"><img src="../../../image/retry.svg" width="14" height="14" alt="Retry"></a>
            <a onclick="handleAction('revert', '${btoa(retry_text)}')"><img src="../../../image/edit.svg" width="14" height="14" alt="Edit"></a>
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
            <a onclick="handleAction('copy', '${btoa(text)}')"><img src="../../../image/copy.svg" width="14" height="14" alt="Copy"></a>
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
    setTimeout(() => {
        banner.remove();
    }, 10000);
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

function appendToolCall(toolName, args, status) {
    const colorMap = {
        "running": "#dcdcaa",
        "success": "#4ec9b0",
        "error": "#f14c4c"
    };
    const color = colorMap[status] || "#858585";

    const div = document.createElement('div');
    div.className = 'tool-call';
    div.innerHTML = `
        <div class="tool-header" onclick="toggleTool(this)">
            <span><span class="marker" style="margin-right:6px;"><img src="../../../image/chevron-down.svg" width="14" height="14" style="vertical-align: middle;"></span> <span style="font-weight:bold;">[Tool Call: ${toolName}]</span> <span style="color:${color}; font-weight:normal; margin-left:6px;">[ ${status.toUpperCase()} ]</span></span>
        </div>
        <div class="tool-body open">${args.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function showTyping(show, state) {
    if (show) {
        typingText.textContent = state === 'thinking' ? "Dardcor Agent is thinking..." : "Dardcor Agent is working...";
        chatContainer.appendChild(typingIndicator);
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
    } else {
        typingIndicator.classList.add('hidden');
    }
}

function clearChat() {
    chatContainer.innerHTML = '';
}
