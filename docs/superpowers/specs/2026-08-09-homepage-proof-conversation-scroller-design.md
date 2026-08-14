# Homepage Proof Conversation Scroller Design

## Goal

Replace the placeholder artwork inside the Homepage V3 design-proof panel with the supplied real proof-and-approval conversation, presented at its original aspect ratio inside the existing proof window.

## Approved interaction

- Use `/Users/ronnieli/Desktop/Snipaste_2026-08-09_10-08-21.jpg` as the exact source image.
- Scale the complete image to the proof window width without cropping or stretching.
- Keep the existing proof panel, right-hand process steps and Approved for Print message unchanged.
- Automatically scroll from the top of the conversation to the bottom, pause, reverse to the top and repeat.
- Pause automatic movement while the pointer is over the frame, while the frame has keyboard focus, or during touch, wheel and manual scroll interaction.
- Resume after the customer stops interacting.
- Disable automatic motion when `prefers-reduced-motion: reduce` is active; manual scrolling remains available.

## Visual treatment

- Preserve the existing proof-window footprint and rounded corners.
- Use a subtle native scrollbar rather than adding arrows, overlays or additional controls.
- Keep the screenshot unaltered so the artwork and approval messages remain part of one authentic visual.

## Accessibility and constraints

- The scroll frame is keyboard focusable and has a descriptive accessible label.
- The image has concise alternative text describing the design proof and customer approval conversation.
- Homepage only; no changes to checkout, orders, gallery data or other storefront pages.
- No new dependency and no code commit.
