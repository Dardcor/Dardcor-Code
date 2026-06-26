function showNotification(message) {
    const div = document.createElement('div');
    div.className = 'top-notification';
    div.textContent = message;
    
    // Insert it directly into the body so it floats over everything
    document.body.appendChild(div);
    
    // Remove after 2 seconds
    setTimeout(() => {
        if (div.parentNode) {
            div.style.animation = 'slideUp 0.3s ease-in forwards';
            setTimeout(() => {
                if (div.parentNode) div.parentNode.removeChild(div);
            }, 300);
        }
    }, 2000);
}

// Add CSS keyframes dynamically for sliding up
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from { transform: translate(-50%, 0); opacity: 1; }
        to { transform: translate(-50%, -30px); opacity: 0; }
    }
`;
document.head.appendChild(style);
