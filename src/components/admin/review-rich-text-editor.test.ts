import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { reviewEditorDocument, reviewFromEditor } from "@/domain/customer-reviews/rich-text";
import { reviewEditorExtensions } from "./review-rich-text-editor";

function createEditor() {
  return new Editor({ element: document.createElement("div"), extensions: reviewEditorExtensions(), content: reviewEditorDocument("Customer review\n\nFrom R&R: Thank you 😊") });
}

describe("review selection formatting", () => {
  it("formats only the selected reply, preserves mixed attributes and supports undo/redo", () => {
    const editor = createEditor();
    try {
      const text = reviewFromEditor(editor.getJSON()).text;
      const start = text.indexOf("From");
      editor.chain().setTextSelection({ from: start + 1, to: text.length + 1 }).setMark("reviewStyle", { font: "georgia", size: 22 }).run();
      editor.chain().setTextSelection({ from: 1, to: text.length + 1 }).setMark("reviewStyle", { bold: true }).run();
      const value = reviewFromEditor(editor.getJSON());
      expect(value.text).toBe(text);
      expect(value.textStyle.ranges[0]).toMatchObject({ from: 0, to: start - 2, size: 16, bold: true });
      expect(value.textStyle.ranges.at(-1)).toMatchObject({ from: start, to: text.length, font: "georgia", size: 22, bold: true });
      expect(editor.commands.undo()).toBe(true);
      expect(editor.commands.redo()).toBe(true);
      expect(reviewFromEditor(editor.getJSON())).toEqual(value);
      expect(reviewFromEditor(reviewEditorDocument(value.text, value.textStyle))).toEqual(value);
    } finally { editor.destroy(); }
  });

  it("uses a collapsed selection to style new input without changing existing text", () => {
    const editor = createEditor();
    try {
      const original = reviewFromEditor(editor.getJSON()).text;
      editor.chain().setTextSelection(original.length + 1).setMark("reviewStyle", { italic: true, size: 14 }).insertContent(" Extra").run();
      const result = reviewFromEditor(editor.getJSON());
      expect(result.text).toBe(original + " Extra");
      expect(result.textStyle.ranges).toEqual([{ from: original.length, to: result.text.length, font: "default", size: 14, bold: false, italic: true }]);
    } finally { editor.destroy(); }
  });
});
