"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ShowroomController, ShowroomStop } from "./engine.mjs";
import styles from "./showroom-hero.module.css";

const stops = [["overview", "Gallery"], ["banner", "01  Wall banner"], ["canvas", "02  Canvas"], ["rollup", "03  Roll-up"]] as const;

export function ShowroomHero({ children, shopHref }: { children: ReactNode; shopHref: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ShowroomController | null>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<ShowroomStop>("overview");

  useEffect(() => {
    let live = true;
    const node = canvas.current;
    if (!node) return;
    const fail = () => {
      if (!live) return;
      controller.current?.dispose();
      setReady(false);
      setFailed(true);
    };
    void import("./engine.mjs").then(async ({ createShowroom }) => {
      if (!live) return;
      const computed = getComputedStyle(document.documentElement);
      const instance = await createShowroom(node, {
        artworks: { banner: "/media/showroom/banner.jpg", canvas: "/media/showroom/canvas.jpg", rollup: "/media/showroom/rollup.jpg" },
        fontFamily: computed.getPropertyValue("--font-body").trim(),
        displayFont: computed.getPropertyValue("--font-display").trim(),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        onReady: () => { if (live) setReady(true); },
        onStop: (stop) => { if (live) setActive(stop); },
        onNavigate: (destination) => {
          if (!live) return;
          if (destination === "shop") router.push(shopHref);
          else document.getElementById("transformation")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        },
        onError: fail,
      });
      if (!live) instance.dispose();
      else controller.current = instance;
    }).catch(fail);
    return () => { live = false; controller.current?.dispose(); controller.current = null; };
  }, [router, shopHref]);

  return (
    <div className={`${styles.host} ${ready ? styles.ready : ""} ${failed ? styles.failed : ""}`} data-showroom={ready ? "ready" : failed ? "fallback" : "loading"}
      onKeyDown={(event) => { if (event.key === "Escape" && event.target !== canvas.current) controller.current?.go("overview"); }}>
      <div className={styles.fallback}>{children}</div>
      {!failed && <div className={styles.stage} aria-hidden={!ready}>
        <canvas ref={canvas} className={styles.canvas} tabIndex={ready ? 0 : -1}
          aria-label="3D R&R Gallery. Click an artwork to walk closer, drag to look around, and press Escape to return. The labelled artwork buttons are also available." />
        {ready && <>
          <div className={styles.top}>
            <div>{active !== "overview" && <button type="button" onClick={() => controller.current?.go("overview")}>← Back to gallery</button>}</div>
            <span className={styles.badge}>R&amp;R GALLERY / THE SHOWROOM</span>
          </div>
          <div className={styles.bottom}>
            <p className={styles.hint}><strong>Click a piece to walk closer.</strong><span>Drag to look around. Scroll to continue.</span></p>
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
      {!ready && !failed && <p className={styles.loading} role="status">Preparing the interactive showroom…</p>}
    </div>
  );
}
