/**
 * AddMemoryModal — form modal for creating a new memory entry.
 *
 * Uses the project's Modal, Input, Button, and Badge components.
 * Sends `content` (not `text`) to match the backend contract.
 */

"use client";

import { useState } from "react";
import { Button, Input, Modal } from "@/shared/components";

export default function AddMemoryModal({ isOpen, onClose, onAdd, loading }) {
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState([]);
  const [error, setError] = useState("");

  const reset = () => {
    setContent("");
    setTagInput("");
    setTags([]);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  };

  const removeTag = (tag) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
    if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Memory content is required");
      return;
    }
    setError("");
    const metadata = tags.length > 0 ? { tags } : {};
    const result = await onAdd({ content: trimmed, metadata });
    if (result.ok) {
      handleClose();
    } else {
      setError(result.error || "Failed to add memory");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Memory"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            icon="add"
          >
            Add Memory
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-main">
            Content <span className="text-red-500 ml-1">*</span>
          </label>
          <textarea
            placeholder="Enter a memory to store…"
            value={content}
            onChange={(e) => { setContent(e.target.value); if (error) setError(""); }}
            rows={4}
            className="w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed resize-y text-[16px] sm:text-sm"
          />
          {error && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-main">Tags</label>
          <div className="flex flex-wrap items-center gap-1.5 p-2 min-h-[42px] bg-surface-2 rounded-[10px] border border-transparent focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500/40 transition-all">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="hover:opacity-70 transition-opacity cursor-pointer"
                  aria-label={`Remove tag ${tag}`}
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder={tags.length === 0 ? "Add tags (press Enter)…" : ""}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addTag}
              className="flex-1 min-w-[120px] bg-transparent text-sm text-text-main placeholder-text-muted/70 outline-none text-[16px] sm:text-sm"
            />
          </div>
          <p className="text-xs text-text-muted">
            Press Enter to add a tag. Tags are stored in metadata.
          </p>
        </div>
      </div>
    </Modal>
  );
}
