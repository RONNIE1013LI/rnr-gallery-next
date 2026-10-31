"use client";

import { Mark, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState } from "react";

import { reviewEditorDocument, reviewFromEditor } from "@/domain/customer-reviews/rich-text";
import { DEFAULT_REVIEW_TEXT_STYLE, REVIEW_FONTS, reviewCharacterStyleSchema, reviewTextCss, type ReviewCharacterStyle, type ReviewTextStyle } from "@/domain/customer-reviews/text-style";
import styles from "./admin.module.css";

const ReviewStyle = Mark.create({
  name: "reviewStyle",
  addAttributes() {
    return Object.fromEntries(Object.entries(DEFAULT_REVIEW_TEXT_STYLE).map(([name, value]) => [name, { default: value, rendered: false }]));
  },
  parseHTML() {
    return [{ tag: "span[data-review-style]", getAttrs: (element) => {
      try {
        const parsed = reviewCharacterStyleSchema.safeParse(JSON.parse(element.getAttribute("data-review-style") ?? ""));
        return parsed.success ? parsed.data : false;
      } catch { return false; }
    } }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const parsed = reviewCharacterStyleSchema.safeParse(mark.attrs);
    const style = parsed.success ? parsed.data : DEFAULT_REVIEW_TEXT_STYLE;
    const css = reviewTextCss(style)!;
    return ["span", mergeAttributes(HTMLAttributes, {
      "data-review-style": JSON.stringify(style),
      style: `font-family:${css.fontFamily};font-size:${css.fontSize};font-weight:${css.fontWeight};font-style:${css.fontStyle}`,
    }), 0];
  },
  addKeyboardShortcuts() {
    const toggle = (attribute: "bold" | "italic") => {
      const current = { ...this.type.create().attrs, ...this.editor.getAttributes(this.name) };
      return this.editor.commands.setMark(this.name, { [attribute]: !current[attribute] });
    };
    return { "Mod-b": () => toggle("bold"), "Mod-i": () => toggle("italic") };
  },
});

export function reviewEditorExtensions(base: ReviewCharacterStyle = DEFAULT_REVIEW_TEXT_STYLE) {
  return [StarterKit.configure({
    bold: false, italic: false, blockquote: false, bulletList: false, orderedList: false,
    listItem: false, listKeymap: false, code: false, codeBlock: false, heading: false,
    horizontalRule: false, strike: false, underline: false, link: false,
    trailingNode: false,
  }), ReviewStyle.extend({
    addAttributes() {
      return Object.fromEntries(Object.entries(base).map(([name, value]) => [name, { default: value, rendered: false }]));
    },
  })];
}

export function ReviewRichTextEditor({ text, textStyle, onChange }: Readonly<{
  text: string;
  textStyle: ReviewTextStyle;
  onChange: (text: string, style: ReviewTextStyle) => void;
}>) {
  const [base] = useState<ReviewCharacterStyle>(() => ({ font: textStyle.font, size: textStyle.size, bold: textStyle.bold, italic: textStyle.italic }));
  const [active, setActive] = useState(base);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const editor = useEditor({
    extensions: reviewEditorExtensions(base),
    content: reviewEditorDocument(text, textStyle),
    immediatelyRender: false,
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Original review", "aria-multiline": "true", style: `font-family:${REVIEW_FONTS[base.font].family};font-size:${base.size}px;font-weight:${base.bold ? 700 : 400};font-style:${base.italic ? "italic" : "normal"}`, class: styles.reviewRichText, spellcheck: "true" },
    },
    onTransaction: ({ editor }) => {
      const parsed = reviewCharacterStyleSchema.safeParse(editor.getAttributes("reviewStyle"));
      setActive(parsed.success ? parsed.data : base);
      setCanUndo(editor.can().undo());
      setCanRedo(editor.can().redo());
    },
    onUpdate: ({ editor }) => {
      const value = reviewFromEditor(editor.getJSON(), base);
      onChange(value.text, value.textStyle);
    },
  });

  function format(patch: Partial<ReviewCharacterStyle>) {
    editor?.chain().focus().setMark("reviewStyle", patch).run();
  }

  return <div className={styles.fullField}>
    <div className={styles.reviewTextToolbar} role="group" aria-label="Review text formatting">
      <label><span>Font</span><select aria-label="Review font" disabled={!editor} value={active.font} onChange={(event) => format({ font: event.target.value as ReviewCharacterStyle["font"] })}>{Object.entries(REVIEW_FONTS).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}</select></label>
      <label><span>Size</span><select aria-label="Review font size" disabled={!editor} value={active.size} onChange={(event) => format({ size: Number(event.target.value) })}>{Array.from({ length: 21 }, (_, index) => index + 12).map((size) => <option key={size} value={size}>{size} px</option>)}</select></label>
      <button type="button" aria-label="Bold" aria-pressed={active.bold} disabled={!editor} onMouseDown={(event) => event.preventDefault()} onClick={() => format({ bold: !active.bold })}><b>B</b></button>
      <button type="button" aria-label="Italic" aria-pressed={active.italic} disabled={!editor} onMouseDown={(event) => event.preventDefault()} onClick={() => format({ italic: !active.italic })}><i>I</i></button>
      <button type="button" disabled={!editor} onMouseDown={(event) => event.preventDefault()} onClick={() => format(DEFAULT_REVIEW_TEXT_STYLE)}>Reset formatting</button>
      <button type="button" aria-label="Undo" disabled={!editor || !canUndo} onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().undo().run()}>Undo</button>
      <button type="button" aria-label="Redo" disabled={!editor || !canRedo} onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().redo().run()}>Redo</button>
    </div>
    <span className={styles.reviewEditorLabel} aria-hidden="true">Original review</span>
    <EditorContent editor={editor} />
    <small>Select text to change its formatting. With no selection, formatting applies to what you type next.</small>
    <input type="hidden" name="originalReviewText" value={text} />
  </div>;
}
