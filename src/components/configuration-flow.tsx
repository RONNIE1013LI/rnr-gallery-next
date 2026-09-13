"use client";

import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import css from "./configuration-flow.module.css";

type Flow = { current: number; total: number; open: number[]; completed: number[]; toggle: (step: number) => void; move: (step: number, completedStep?: number) => void };
const Context = createContext<Flow | null>(null);

export function ConfigurationFlow({ children, total }: { children: ReactNode; total: number }) {
  const [current, setCurrent] = useState(1);
  const [open, setOpen] = useState([1]);
  const [completed, setCompleted] = useState<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  function move(step: number, completedStep?: number) {
    if (completedStep) setCompleted((values) => [...new Set([...values, completedStep])]);
    setCurrent(step);
    setOpen([step]);
    root.current?.querySelector<HTMLButtonElement>(`[data-configuration-step="${step}"]`)?.focus();
  }
  return <Context.Provider value={{ current, total, open, completed, move, toggle(step) {
    setCurrent(step);
    setOpen((values) => values.includes(step) ? values.filter((value) => value !== step) : [...values, step]);
  } }}><div ref={root} className={css.flow}>{children}</div></Context.Provider>;
}

export function ConfigurationReviewButton() {
  const flow = useContext(Context);
  return flow ? <button type="button" className={css.reviewButton} onClick={() => flow.move(flow.total)}>Review your order</button> : null;
}

export function ConfigurationStep({ children, number, title, error, continueDisabled }: { children: ReactNode; number: number; title: string; error?: string; continueDisabled?: boolean }) {
  const flow = useContext(Context);
  const id = useId();
  if (!flow) return <>{children}</>;
  const expanded = flow.open.includes(number);
  return <section className={css.step}>
    <h2 className={css.heading}><button type="button" id={`${id}-heading`} data-configuration-step={number} aria-expanded={expanded} aria-controls={`${id}-panel`} aria-current={flow.current === number ? "step" : undefined} onClick={() => flow.toggle(number)}>
      <span>{number}. {title}</span><small>{flow.current === number ? "Current" : flow.completed.includes(number) && !error && !continueDisabled ? "Completed" : "Edit"} <span aria-hidden="true">{expanded ? "−" : "+"}</span></small>
    </button></h2>
    <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-heading`} hidden={!expanded} className={css.panel}>
      {children}
      {error ? <p role="alert" className={css.warning}>{error}</p> : null}
      <div className={css.actions}>
        {number > 1 ? <button type="button" aria-label={`Back: step ${number - 1}`} onClick={() => flow.move(number - 1)}>Back</button> : <span />}
        {number < flow.total ? <button type="button" aria-label={`Next: step ${number + 1}`} disabled={Boolean(error) || continueDisabled} onClick={() => flow.move(number + 1, number)}>Next</button> : null}
      </div>
    </div>
  </section>;
}
