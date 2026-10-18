import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES } from "../schema/index.js";

export { VALID_OPENAI_CONTENT_TYPES, VALID_OPENAI_MESSAGE_TYPES };

export function filterToOpenAIFormat(body, opts = {}) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  const keepCache = !!opts.preserveCacheControl;

  function stripBlock(block) {
    const { signature, cache_control, ...rest } = block;
    return keepCache && cache_control ? { ...rest, cache_control } : rest;
  }

  body.messages = body.messages.map(msg => {
    if (msg.role === ROLE.DEVELOPER) msg = { ...msg, role: ROLE.SYSTEM };

    if (msg.role === ROLE.TOOL) return msg;

    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) return msg;

    if (typeof msg.content === "string") return msg;

    if (Array.isArray(msg.content)) {
      const filteredContent = [];

      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING) continue;

        if (VALID_OPENAI_CONTENT_TYPES.includes(block.type)) {
          filteredContent.push(stripBlock(block));
        } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
          continue;
        } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
          filteredContent.push(stripBlock(block));
        }
      }
      
      if (filteredContent.length === 0) {
        filteredContent.push({ type: OPENAI_BLOCK.TEXT, text: "" });
      }
      
      return { ...msg, content: filteredContent };
    }
    
    return msg;
  });
  
  body.messages = body.messages.filter(msg => {
    if (msg.role === ROLE.TOOL) return true;
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) return true;
    
    if (typeof msg.content === "string") return msg.content.trim() !== "";
    if (Array.isArray(msg.content)) {
      return msg.content.some(b => 
        (b.type === OPENAI_BLOCK.TEXT && b.text?.trim()) ||
        b.type !== OPENAI_BLOCK.TEXT
      );
    }
    return true;
  });

  if (body.tools && Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
  }

  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    body.tools = body.tools.map(tool => {
      if (tool.type === OPENAI_BLOCK.FUNCTION && tool.function) return tool;
      
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: tool.name,
            description: String(tool.description || ""),
            parameters: tool.input_schema || { type: "object", properties: {} }
          }
        };
      }
      
      if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations.map(fn => ({
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: fn.name,
            description: String(fn.description || ""),
            parameters: fn.parameters || { type: "object", properties: {} }
          }
        }));
      }
      
      return tool;
    }).flat();
  }

  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = body.tool_choice;
    if (choice.type === "auto") {
      body.tool_choice = "auto";
    } else if (choice.type === "any") {
      body.tool_choice = "required";
    } else if (choice.type === "tool" && choice.name) {
      body.tool_choice = { type: OPENAI_BLOCK.FUNCTION, function: { name: choice.name } };
    }
  }

  return body;
}

