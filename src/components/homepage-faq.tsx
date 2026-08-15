"use client";

import { useId, useState } from "react";
import styles from "./homepage-v3.module.css";

const questions = [
  ["My photos are blurry. Can you still use them?", "Yes, please send us the original photos 😊 We’ll check the quality and enhance them where possible. Very blurry or low-resolution photos may affect the final result, so if any photo isn’t clear enough, we’ll let you know and ask for a better one."],
  ["Can you combine people from different photographs?", "Yes. People from separate photographs can be brought together in one composition."],
  ["Will I see the design before printing?", "Yes. You review the draft and approve the exact version that moves into production."],
  ["How many revisions are included?", "Two free design revisions are included. Please list requested changes together; additional revision rounds cost NZ$30."],
  ["How long do design, printing and delivery take?", "Production normally takes 5 business days from the order date. After production, delivery is usually 2–3 business days in New Zealand and approximately 5 business days for standard delivery to Australia. Urgent service must be confirmed with R&R Gallery."],
  ["Which product format should I choose?", "Choose according to the venue, purpose, orientation and source-photo quality, or browse all products for guidance."],
] as const;

export function HomepageFaq() {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className={styles.faqList}>
      {questions.map(([question, answer], index) => {
        const isOpen = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        return (
          <div className={styles.faqItem} key={question}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
            >
              <span>{question}</span>
              <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
            </button>
            <div id={panelId} hidden={!isOpen}>
              <p>{answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
