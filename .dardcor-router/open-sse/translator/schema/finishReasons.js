
export const OPENAI_FINISH = {
  STOP: "stop",
  LENGTH: "length",
  TOOL_CALLS: "tool_calls",
  CONTENT_FILTER: "content_filter",
};

export const CLAUDE_STOP = {
  END_TURN: "end_turn",
  MAX_TOKENS: "max_tokens",
  TOOL_USE: "tool_use",
  STOP_SEQUENCE: "stop_sequence",
};

export const GEMINI_FINISH = {
  STOP: "STOP",
  MAX_TOKENS: "MAX_TOKENS",
  SAFETY: "SAFETY",
  RECITATION: "RECITATION",
  BLOCKLIST: "BLOCKLIST",
  PROHIBITED_CONTENT: "PROHIBITED_CONTENT",
};

export const RESPONSES_INCOMPLETE_REASON = {
  CONTENT_FILTER: "content_filter",
  MAX_OUTPUT_TOKENS: "max_output_tokens",
};

export const RESPONSES_STATUS = {
  INCOMPLETE: "incomplete",
  FAILED: "failed",
  COMPLETED: "completed",
};

export const NO_RETRY_EMPTY_FINISH = new Set([
  OPENAI_FINISH.CONTENT_FILTER,
  "content_filter",
  "safety",
  "blocklist",
  "prohibited_content",
]);
