"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ShowroomController, ShowroomStop } from "./engine.mjs";
import { observeShowroomMode } from "./responsive-mode.mjs";
import styles from "./showroom-hero.module.css";

const stops = [["overview", "Gallery"], ["banner", "01  Wall banner"], ["canvas", "02  Canvas"], ["rollup", "03  Roll-up"]] as const;

export function ShowroomHero({ children, shopHref }: { children: ReactNode; shopHref: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ShowroomController | null>(null);
  // Server rendering and the first hydration render are always the original flat hero.
  const [desktop, setDesktop] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<ShowroomStop>("overview");

  useEffect(() => observeShowroomMode((enabled) => {
    setDesktop(enabled);
    if (!enabled) {
      setReady(false);
      setFailed(false);
      setActive("overview");
    }
  }), []);

  useEffect(() => {
    // This guard is before the dynamic import: phones download no showroom engine.
    if (!desktop) return;
    let live = true;
    let instance: ShowroomController | null = null;
    const pending = new AbortController();
    const node = canvas.current;
    if (!node) return;
    const fail = () => {
      if (!live) return;
      instance?.dispose();
      if (controller.current === instance) controller.current = null;
      setReady(false);
      setFailed(true);
    };
    // The desktop bundle is a public ESM asset so Next cannot preload its entry
    // chunk on phones before this media-query guard has run.
    const engineUrl = new URL("/media/showroom/engine.bundle.mjs?v=20260919-2329", window.location.origin).href;
    void import(/* webpackIgnore: true */ engineUrl).then(async ({ createShowroom }) => {
      if (!live) return;
      const computed = getComputedStyle(document.documentElement);
      const created = await createShowroom(node, {
        signal: pending.signal,
        artworks: { banner: "/media/showroom/banner.jpg", canvas: "/media/showroom/canvas.jpg", rollup: "/media/showroom/rollup.jpg" },
        fontFamily: computed.getPropertyValue("--font-body").trim(),
        displayFont: computed.getPropertyValue("--font-display").trim(),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        onReady: () => { if (live) setReady(true); },
        onStop: (stop: ShowroomStop) => { if (live) setActive(stop); },
        onNavigate: (destination: "shop" | "transformation") => {
          if (!live) return;
          if (destination === "shop") window.location.assign(shopHref);
          else document.getElementById("transformation")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        },
        onError: fail,
      }) as ShowroomController;
      instance = created;
      if (!live) created.dispose();
      else controller.current = created;
    }).catch(fail);
    return () => {
      live = false;
      pending.abort();
      instance?.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, [desktop, shopHref]);

  const enhanced = desktop && !failed;
  return (
    <div className={`${styles.host} ${enhanced ? styles.enhanced : ""} ${ready && desktop ? styles.ready : ""} ${failed ? styles.failed : ""}`}
      data-showroom={!desktop ? "static" : ready ? "ready" : failed ? "fallback" : "loading"}
      onKeyDown={(event) => { if (event.key === "Escape" && event.target !== canvas.current) controller.current?.go("overview"); }}>
      <div className={styles.fallback}>{children}</div>
      {enhanced && <div className={styles.stage} aria-hidden={!ready}>
        <canvas ref={canvas} className={styles.canvas} tabIndex={ready ? 0 : -1}
          aria-label="3D R&R Gallery. Click an artwork to walk closer, drag to look around, use the mouse wheel to zoom, and press Escape to return. The labelled artwork buttons are also available." />
        {ready && <>
          <div className={styles.top}>
            <div>{active !== "overview" && <button type="button" onClick={() => controller.current?.go("overview")}>← Back to gallery</button>}</div>
            <span className={styles.badge}>R&amp;R GALLERY / THE SHOWROOM</span>
          </div>
          <div className={styles.bottom}>
            <p className={styles.hint}><strong>Click a piece to walk closer.</strong><span>Drag to look around. Scroll to zoom.</span></p>
            <div className={styles.stops} role="group" aria-label="Walk to an artwork">
              {stops.map(([id, label]) => <button key={id} type="button" aria-pressed={active === id} onClick={() => controller.current?.go(id)}>{label}</button>)}
            </div>
            {active !== "overview" && <div className={styles.steps}>
              <button type="button" aria-label="Step backwards" onClick={() => controller.current?.step(-0.3)}>−</button>
              <button type="button" aria-label="Step closer" onClick={() => controller.current?.step(0.3)}>+</button>
            </div>}
          </div>
          <p className={styles.sr} role="status" aria-live="polite">{active === "overview" ? "Gallery overview" : `Viewing ${active}`}</p>
        </>}
      </div>}
      {enhanced && !ready && <p className={styles.loading} role="status">Preparing the interactive showroom…</p>}
    </div>
  );
}
