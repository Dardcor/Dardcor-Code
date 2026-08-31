# Cursor Integration

Integrate Dardcor Code with Cursor IDE to route your AI requests through Dardcor Code's intelligent routing system.

## Prerequisites

- Cursor IDE installed
- Cursor Pro account (required for custom API endpoints)
- Dardcor Code cloud endpoint configured
- API key from Dardcor Code dashboard

## ⚠️ Important Notes

> **Cloud Endpoint Required**: Cursor routes requests through its own server and does not support localhost endpoints. You must use the Dardcor Code cloud endpoint: `https://dardcor-code.web.id`

> **Cursor Pro Required**: This feature requires a Cursor Pro account to use custom API endpoints.

## Setup

### 1. Open Cursor Settings

1. Open Cursor IDE
2. Go to **Settings** (Cmd/Ctrl + ,)
3. Navigate to **Models** section

### 2. Enable OpenAI API

1. Find the **OpenAI API key** option
2. Enable the toggle to activate custom API configuration

### 3. Configure Base URL

Set the base URL to Dardcor Code cloud endpoint:

```
https://dardcor-code.web.id
```

**Steps:**
1. In the Models settings, locate the **Base URL** field
2. Enter: `https://dardcor-code.web.id`
3. Click **Save**

### 4. Add API Key

1. In the **API Key** field, enter your Dardcor Code API key
2. You can find your API key in the Dardcor Code dashboard under **Settings → API Keys**
3. Click **Save**

### 5. Add Custom Model

1. Click **View All Models** button
2. Click **Add Custom Model**
3. Enter the model name from your Dardcor Code configuration (e.g., `gpt-4`, `claude-opus-4-5`, etc.)
4. Click **Add**

### 6. Select Model

1. In the Cursor chat interface, click the model selector dropdown
2. Choose your custom model from the list
3. Start using Dardcor Code with Cursor!

## Configuration Example

Your Cursor settings should look like this:

```
OpenAI API: ✓ Enabled
Base URL: https://dardcor-code.web.id
API Key: sk-dardcor-code-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## Available Models

You can use any model configured in your Dardcor Code dashboard. Common examples:

| Model Name | Provider | Description |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Usage

### Chat Interface

1. Open Cursor chat (Cmd/Ctrl + L)
2. Select your model from the dropdown
3. Start chatting with AI through Dardcor Code

### Inline Code Generation

1. Select code in your editor
2. Press Cmd/Ctrl + K
3. Enter your prompt
4. Cursor will use Dardcor Code to generate code

### Code Explanation

1. Select code in your editor
2. Press Cmd/Ctrl + L
3. Ask "Explain this code"
4. Get AI-powered explanations through Dardcor Code

## Troubleshooting

### "Invalid API Key" Error

1. Verify your API key in Dardcor Code dashboard
2. Make sure you copied the entire key including the `sk-dardcor-code-` prefix
3. Check that the API key has not expired
4. Try regenerating a new API key

### "Model Not Found" Error

1. Verify the model name matches exactly with your Dardcor Code configuration
2. Check that the provider connection is active in Dardcor Code dashboard
3. Ensure the model is available in your connected providers
4. Try using the full model name (e.g., `openai/gpt-4` instead of `gpt-4`)

### Connection Issues

1. Verify you are using the cloud endpoint: `https://dardcor-code.web.id`
2. Check your internet connection
3. Ensure Dardcor Code cloud service is operational
4. Try disabling VPN or proxy if enabled

### Localhost Not Working

> **Remember**: Cursor does not support localhost endpoints. You must use the cloud endpoint `https://dardcor-code.web.id`. If you need to use a local Dardcor Code instance, consider using a tunneling service like ngrok to expose your local endpoint.

## Cloud Endpoint Setup

If you're running Dardcor Code locally and want to use it with Cursor:

1. Enable cloud endpoint in Dardcor Code settings
2. Configure your cloud endpoint URL in Dardcor Code dashboard
3. Use the cloud URL in Cursor settings
4. Ensure your local Dardcor Code instance is accessible from the internet

## Best Practices

1. **Use Model Aliases**: Create short aliases for frequently used models in Dardcor Code
2. **Monitor Usage**: Check Dardcor Code dashboard for usage statistics and costs
3. **Rotate API Keys**: Regularly rotate your API keys for security
4. **Test Models**: Try different models to find the best one for your use case
