import { describe, it, expect } from "vitest";
import {
  isLocalConnection,
  isLocalEmbeddingModel,
} from "@/lib/privacy/privacyMode.js";

describe("isLocalConnection", () => {
  it("returns false for missing baseUrl", () => {
    expect(isLocalConnection({})).toBe(false);
    expect(isLocalConnection(null)).toBe(false);
    expect(isLocalConnection(undefined)).toBe(false);
  });

  it("accepts localhost", () => {
    expect(isLocalConnection({ baseUrl: "http://localhost:8080" })).toBe(true);
  });

  it("accepts loopback 127.x", () => {
    expect(isLocalConnection({ baseUrl: "http://127.0.0.1:11434" })).toBe(true);
    expect(isLocalConnection({ baseUrl: "http://127.1.2.3:80" })).toBe(true);
  });

  it("accepts 0.0.0.0", () => {
    expect(isLocalConnection({ baseUrl: "http://0.0.0.0:8080" })).toBe(true);
  });

  it("accepts IPv6 loopback", () => {
    expect(isLocalConnection({ baseUrl: "http://[::1]:8080" })).toBe(true);
  });

  it("accepts private 10.x", () => {
    expect(isLocalConnection({ baseUrl: "http://10.0.0.5:8080" })).toBe(true);
  });

  it("accepts private 172.16-31.x", () => {
    expect(isLocalConnection({ baseUrl: "http://172.16.0.1:8080" })).toBe(true);
    expect(isLocalConnection({ baseUrl: "http://172.31.255.255:8080" })).toBe(
      true,
    );
  });

  it("accepts private 192.168.x", () => {
    expect(isLocalConnection({ baseUrl: "http://192.168.1.1:8080" })).toBe(
      true,
    );
  });

  it("accepts .local hostname", () => {
    expect(isLocalConnection({ baseUrl: "http://mymac.local:8080" })).toBe(
      true,
    );
  });

  it("accepts .internal hostname", () => {
    expect(
      isLocalConnection({ baseUrl: "http://service.internal:8080" }),
    ).toBe(true);
  });

  it("rejects remote hosts", () => {
    expect(isLocalConnection({ baseUrl: "https://api.openai.com" })).toBe(
      false,
    );
    expect(isLocalConnection({ baseUrl: "https://8.8.8.8:443" })).toBe(false);
    expect(
      isLocalConnection({ baseUrl: "https://example.com:443" }),
    ).toBe(false);
  });

  it("rejects malformed baseUrl", () => {
    expect(isLocalConnection({ baseUrl: "not-a-url" })).toBe(false);
    expect(isLocalConnection({ baseUrl: "" })).toBe(false);
  });

  it("rejects 172.15.x (outside private range)", () => {
    expect(isLocalConnection({ baseUrl: "http://172.15.0.1:8080" })).toBe(
      false,
    );
  });

  it("rejects 172.32.x (outside private range)", () => {
    expect(isLocalConnection({ baseUrl: "http://172.32.0.1:8080" })).toBe(
      false,
    );
  });
});

describe("isLocalEmbeddingModel", () => {
  it("accepts ollama-prefixed models", () => {
    expect(isLocalEmbeddingModel("ollama/nomic-embed")).toBe(true);
    expect(isLocalEmbeddingModel("ollama")).toBe(true);
  });

  it("accepts llama.cpp models", () => {
    expect(isLocalEmbeddingModel("llama.cpp/bge-small")).toBe(true);
  });

  it("accepts vllm models", () => {
    expect(isLocalEmbeddingModel("vllm/e5-base")).toBe(true);
  });

  it("accepts whisper models", () => {
    expect(isLocalEmbeddingModel("whisper/base")).toBe(true);
  });

  it("accepts local-prefixed models", () => {
    expect(isLocalEmbeddingModel("local/custom-model")).toBe(true);
  });

  it("accepts localhost-based model names", () => {
    expect(isLocalEmbeddingModel("localhost:8080/model")).toBe(true);
    expect(isLocalEmbeddingModel("127.0.0.1/model")).toBe(true);
  });

  it("accepts private IP model names", () => {
    expect(isLocalEmbeddingModel("10.0.0.5/embed")).toBe(true);
    expect(isLocalEmbeddingModel("192.168.1.1/embed")).toBe(true);
    expect(isLocalEmbeddingModel("172.16.0.1/embed")).toBe(true);
  });

  it("rejects cloud model names", () => {
    expect(isLocalEmbeddingModel("text-embedding-3-small")).toBe(false);
    expect(isLocalEmbeddingModel("azure/openai/embedding")).toBe(false);
  });

  it("rejects null/undefined/non-string", () => {
    expect(isLocalEmbeddingModel(null)).toBe(false);
    expect(isLocalEmbeddingModel(undefined)).toBe(false);
    expect(isLocalEmbeddingModel(123)).toBe(false);
  });
});
