"use client";

import Image from "next/image";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./homepage-v3.module.css";

type GalleryFocus = "room" | "wall-banner" | "canvas" | "roll-up";

type Viewpoint = Readonly<{
  label: string;
  scale: number;
  originX: number;
  originY: number;
  shiftX: number;
  shiftY: number;
}>;

const VIEWPOINTS: Readonly<Record<GalleryFocus, Viewpoint>> = {
  room: {
    label: "Gallery",
    scale: 1,
    originX: 50,
    originY: 50,
    shiftX: 0,
    shiftY: 0,
  },
  "wall-banner": {
    label: "Wall Banner",
    scale: 1.72,
    originX: 27.5,
    originY: 39.5,
    shiftX: 22.5,
    shiftY: 10.5,
  },
  canvas: {
    label: "Canvas",
    scale: 2.3,
    originX: 67.6,
    originY: 43.4,
    shiftX: -17.6,
    shiftY: 6.6,
  },
  "roll-up": {
    label: "Roll-up Banner",
    scale: 2.05,
    originX: 89.4,
    originY: 52.5,
    shiftX: -39.4,
    shiftY: -2.5,
  },
};

type CameraVariables = CSSProperties & {
  "--camera-scale": number;
  "--camera-origin-x": string;
  "--camera-origin-y": string;
  "--camera-shift-x": string;
  "--camera-shift-y": string;
};

type HeroGalleryExperienceProps = Readonly<{
  src: string;
  alt: string;
}>;

export function HeroGalleryExperience({
  src,
  alt,
}: HeroGalleryExperienceProps) {
  const [focus, setFocus] = useState<GalleryFocus>("room");
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const viewpoint = VIEWPOINTS[focus];
  const cameraStyle = useMemo<CameraVariables>(() => ({
    "--camera-scale": viewpoint.scale,
    "--camera-origin-x": `${viewpoint.originX}%`,
    "--camera-origin-y": `${viewpoint.originY}%`,
    "--camera-shift-x": `${viewpoint.shiftX}%`,
    "--camera-shift-y": `${viewpoint.shiftY}%`,
  }), [viewpoint]);

  const resetLook = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--look-x", "0px");
    stage.style.setProperty("--look-y", "0px");
    stage.style.setProperty("--look-rotate-x", "0deg");
    stage.style.setProperty("--look-rotate-y", "0deg");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;

    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;

    const bounds = viewport.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const nx = Math.max(
      -1,
      Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1),
    );
    const ny = Math.max(
      -1,
      Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1),
    );

    if (focus === "room") {
      stage.style.setProperty("--look-x", `${(nx * 5).toFixed(2)}px`);
      stage.style.setProperty("--look-y", `${(ny * 3.5).toFixed(2)}px`);
      stage.style.setProperty("--look-rotate-x", `${(-ny * 0.6).toFixed(2)}deg`);
      stage.style.setProperty("--look-rotate-y", `${(nx * 0.85).toFixed(2)}deg`);
      return;
    }

    stage.style.setProperty("--look-x", `${(-nx * 12).toFixed(2)}px`);
    stage.style.setProperty("--look-y", `${(-ny * 9).toFixed(2)}px`);
    stage.style.setProperty("--look-rotate-x", "0deg");
    stage.style.setProperty("--look-rotate-y", "0deg");
  };

  const selectFocus = (nextFocus: GalleryFocus) => {
    resetLook();
    setFocus(nextFocus);
  };

  const returnToRoom = () => selectFocus("room");

  return (
    <div
      ref={viewportRef}
      className={styles.heroExperience}
      data-gallery-focus={focus}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetLook}
      onKeyDown={(event) => {
        if (event.key === "Escape" && focus !== "room") {
          event.preventDefault();
          returnToRoom();
        }
      }}
      aria-label="Interactive R&R Gallery showroom"
    >
      <div
        ref={stageRef}
        className={styles.heroExperienceStage}
        style={cameraStyle}
      >
        <Image
          className={styles.heroExperienceImage}
          src={src}
          alt={alt}
          width={4608}
          height={2592}
          sizes="(max-width: 760px) 100vw, (max-width: 1080px) calc(100vw - 4rem), (max-width: 1352px) calc(67vw + 1.17125rem), (max-width: 1427px) calc(17vw + 43.42125rem), (max-width: 1440px) calc(50vw + 14rem), 944px"
          quality={70}
          loading="eager"
          fetchPriority="high"
        />
      </div>

      {focus === "room" ? (
        <>
          <button
            type="button"
            className={`${styles.heroHotspot} ${styles.heroHotspotWall}`}
            onClick={() => selectFocus("wall-banner")}
            aria-label="Walk closer to the wall banner"
          >
            <span>View Wall Banner</span>
          </button>
          <button
            type="button"
            className={`${styles.heroHotspot} ${styles.heroHotspotCanvas}`}
            onClick={() => selectFocus("canvas")}
            aria-label="Walk closer to the canvas"
          >
            <span>View Canvas</span>
          </button>
          <button
            type="button"
            className={`${styles.heroHotspot} ${styles.heroHotspotRollup}`}
            onClick={() => selectFocus("roll-up")}
            aria-label="Walk closer to the roll-up banner"
          >
            <span>View Roll-up Banner</span>
          </button>
          <div className={styles.heroExperienceHint} aria-hidden="true">
            <span className={styles.heroExperienceHintDesktop}>
              Move to look around · select an artwork to walk closer
            </span>
            <span className={styles.heroExperienceHintMobile}>
              Tap an artwork to view it closer
            </span>
          </div>
        </>
      ) : (
        <div className={styles.heroExperienceToolbar}>
          <span>{viewpoint.label}</span>
          <button type="button" onClick={returnToRoom}>
            Back to gallery
          </button>
        </div>
      )}
    </div>
  );
}
