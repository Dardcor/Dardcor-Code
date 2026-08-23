# OpenAI Codex CLI Integration

Integrate MiawRouter with OpenAI Codex CLI to route your OpenAI API requests through MiawRouter's intelligent routing system.

## Prerequisites

- OpenAI Codex CLI installed
- MiawRouter running locally or cloud endpoint configured
- API key from MiawRouter dashboard

## Setup

### 1. Configure Environment Variables

Set the following environment variables in your shell configuration file (`~/.bashrc`, `~/.zshrc`, or `~/.bash_profile`):

```bash
# Base URL for MiawRouter
export OPENAI_BASE_URL="http://localhost:21128/v1"

# API Key from MiawRouter dashboard
export OPENAI_API_KEY="your-miawrouter-api-key"
```

### 2. Reload Shell Configuration

```bash
source ~/.zshrc  # or ~/.bashrc
```

### 3. Verify Configuration

Check that the environment variables are set correctly:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## Available Models

MiawRouter provides the following Codex models:

| Model ID | Description |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - Latest version |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - Extended context |

## Usage Examples

### Basic Usage

```bash
# Use GPT-5.2 Codex
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# Use GPT-5.1 Codex Max
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### Code Generation

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### Code Explanation

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## Configuration File

You can also configure Codex CLI using a configuration file. Create or edit `~/.codex/config.json`:

```json
{
  "baseUrl": "http://localhost:21128/v1",
  "apiKey": "your-miawrouter-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## Troubleshooting

### Authentication Errors

If you encounter authentication errors:

1. Verify your API key is correct in MiawRouter dashboard
2. Check that `OPENAI_API_KEY` environment variable is set
3. Ensure the API key has not expired

### Connection Issues

If you encounter connection errors:

1. Verify MiawRouter is running: `curl http://localhost:21128/health`
2. Check environment variables are set correctly
3. Ensure no firewall is blocking port 21128

### Model Not Available

If you get "model not available" errors:

1. Verify the model name matches your MiawRouter configuration
2. Check that the OpenAI provider connection is active in MiawRouter dashboard
3. Ensure the model is available in your connected providers

## Cloud Endpoint

To use MiawRouter cloud endpoint instead of localhost:

```bash
export OPENAI_BASE_URL="https://miawrouter.web.id"
```

Make sure you have configured your API key in the MiawRouter cloud dashboard.

## Advanced Configuration

### Custom Timeout

```bash
export OPENAI_TIMEOUT=60  # seconds
```

### Debug Mode

Enable debug mode to see detailed request/response logs:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
