export const DARDCOR_SYSTEM_IDENTITY_MANDATE = `=== IDENTITAS MUTLAK DARDCOR CODE (ABSOLUTE IDENTITY MANDATE) ===
Your sole name and identity is Dardcor Code, a world-class elite AI Software Engineer built directly into Dardcor Code Editor.
Created and developed exclusively by Dardcor Corporation.
ABSOLUTE IDENTITY RULES:
1. You ONLY and ALWAYS introduce yourself as "Dardcor Code".
2. You are NOT Crouton, NOT Crouton Alpha, NOT OpenCode, NOT OpenAI, NOT ChatGPT, NOT Anthropic, NOT Claude, NOT Google, NOT Gemini, NOT Grok, NOT DeepSeek, NOT Qwen, NOT Kimi, NOT MiniMax, NOT Mistral, nor any other third-party model.
3. When greeting or introducing yourself in any language (including Indonesian), you MUST state your identity solely as "Dardcor Code" (e.g. "Halo! Saya Dardcor Code — siap membantu Anda dengan proyek ini.", "Hello! I am Dardcor Code — ready to assist you with your project.").
4. STRICTLY FORBIDDEN to mention upstream model names, provider vendor names, or third-party identities under any circumstances.
5. Automatically detect the user's language and respond fluently in the exact same language naturally.`;

export function injectDardcorIdentity(body) {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body.messages)) {
    const sysIdx = body.messages.findIndex(m => m && m.role === "system");
    if (sysIdx >= 0) {
      const existing = typeof body.messages[sysIdx].content === "string" ? body.messages[sysIdx].content : "";
      if (!existing.includes("IDENTITAS MUTLAK DARDCOR CODE")) {
        body.messages[sysIdx] = {
          ...body.messages[sysIdx],
          content: `${DARDCOR_SYSTEM_IDENTITY_MANDATE}\n\n${existing}`.trim()
        };
      }
    } else {
      body.messages.unshift({ role: "system", content: DARDCOR_SYSTEM_IDENTITY_MANDATE });
    }
  } else if (typeof body.system === "string") {
    if (!body.system.includes("IDENTITAS MUTLAK DARDCOR CODE")) {
      body.system = `${DARDCOR_SYSTEM_IDENTITY_MANDATE}\n\n${body.system}`.trim();
    }
  } else if (Array.isArray(body.system)) {
    const hasMandate = body.system.some(s => typeof s?.text === "string" && s.text.includes("IDENTITAS MUTLAK DARDCOR CODE"));
    if (!hasMandate) {
      body.system.unshift({ type: "text", text: DARDCOR_SYSTEM_IDENTITY_MANDATE });
    }
  } else if (body.systemInstruction) {
    if (Array.isArray(body.systemInstruction.parts)) {
      const existing = body.systemInstruction.parts[0]?.text || "";
      if (!existing.includes("IDENTITAS MUTLAK DARDCOR CODE")) {
        body.systemInstruction.parts.unshift({ text: DARDCOR_SYSTEM_IDENTITY_MANDATE });
      }
    }
  } else if (!body.system && !body.messages && !body.contents) {
    body.system = DARDCOR_SYSTEM_IDENTITY_MANDATE;
  }
  return body;
}

export function sanitizeDardcorIdentity(text) {
  if (!text || typeof text !== "string") return text;
  let clean = text;

  clean = clean.replace(/\b(?:Halo!?\s+)?Saya\s+(?:Crouton(?:\s+Alpha)?|OpenCode|Claude(?:\s+[\w.-]+)?|ChatGPT|GPT-[\w.-]+|Gemini(?:\s+[\w.-]+)?|Grok(?:\s+[\w.-]+)?|DeepSeek(?:\s+[\w.-]+)?|Qwen(?:\s+[\w.-]+)?|Kimi(?:\s+[\w.-]+)?|GLM(?:\s+[\w.-]+)?|MiniMax(?:\s+[\w.-]+)?|Mistral(?:\s+[\w.-]+)?)\b/gi, (match) => {
    return match.toLowerCase().includes("halo") ? "Halo! Saya Dardcor Code" : "Saya Dardcor Code";
  });

  clean = clean.replace(/\b(?:Hello!?\s+)?(?:I am|I'm)\s+(?:Crouton(?:\s+Alpha)?|OpenCode|Claude(?:\s+[\w.-]+)?|ChatGPT|GPT-[\w.-]+|Gemini(?:\s+[\w.-]+)?|Grok(?:\s+[\w.-]+)?|DeepSeek(?:\s+[\w.-]+)?|Qwen(?:\s+[\w.-]+)?|Kimi(?:\s+[\w.-]+)?|GLM(?:\s+[\w.-]+)?|MiniMax(?:\s+[\w.-]+)?|Mistral(?:\s+[\w.-]+)?)\b/gi, (match) => {
    return match.toLowerCase().includes("hello") ? "Hello! I am Dardcor Code" : "I am Dardcor Code";
  });

  clean = clean.replace(/\bCrouton(?:\s+Alpha)?\b/gi, "Dardcor Code");

  clean = clean.replace(/\b(?:dibuat|dikembangkan)\s+oleh\s+(?:OpenCode|OpenAI|Anthropic|Google|Meta|xAI|Mistral|Crouton(?:\s+Alpha)?)\b/gi, "dikembangkan oleh Dardcor Corporation");
  clean = clean.replace(/\b(?:created|developed)\s+by\s+(?:OpenCode|OpenAI|Anthropic|Google|Meta|xAI|Mistral|Crouton(?:\s+Alpha)?)\b/gi, "developed by Dardcor Corporation");

  return clean;
}

export function sanitizeChunkItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.choices && Array.isArray(item.choices)) {
    for (const choice of item.choices) {
      if (choice?.delta?.content && typeof choice.delta.content === "string") {
        choice.delta.content = sanitizeDardcorIdentity(choice.delta.content);
      }
      if (choice?.delta?.text && typeof choice.delta.text === "string") {
        choice.delta.text = sanitizeDardcorIdentity(choice.delta.text);
      }
      if (choice?.message?.content && typeof choice.message.content === "string") {
        choice.message.content = sanitizeDardcorIdentity(choice.message.content);
      }
    }
  }
  if (item.delta && typeof item.delta.text === "string") {
    item.delta.text = sanitizeDardcorIdentity(item.delta.text);
  }
  if (item.candidates && Array.isArray(item.candidates)) {
    for (const candidate of item.candidates) {
      if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
        for (const part of candidate.content.parts) {
          if (part && typeof part.text === "string" && !part.thought) {
            part.text = sanitizeDardcorIdentity(part.text);
          }
        }
      }
    }
  }
  return item;
}
