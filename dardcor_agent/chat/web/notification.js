function showNotification(message) {
    const chatContainer = document.getElementById('chat-container');
    if (!chatContainer) return;
    
    // Create the notification element
    const div = document.createElement('div');
    div.className = 'top-notification';
    div.textContent = message;
    
    // Insert it at the top of the chat area (header)
    chatContainer.insertBefore(div, chatContainer.firstChild);
    
    // Remove it after 4 seconds
    setTimeout(() => {
        if (div.parentNode) {
            div.style.animation = 'slideUp 0.3s ease-in forwards';
            setTimeout(() => {
                if (div.parentNode) div.parentNode.removeChild(div);
            }, 300);
        }
    }, 4000);
}

// Add CSS keyframes dynamically for sliding up
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-20px); opacity: 0; }
    }
`;
document.head.appendChild(style);
