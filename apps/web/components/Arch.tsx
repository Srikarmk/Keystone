"use client";

/*
 * The arch is the analysis, not an ornament.
 *
 * A masonry arch stands because every voussoir presses against its neighbours, and
 * the keystone at the apex is what locks the whole thing in compression. Take it out
 * and the arch does not sag — it falls. That is exactly the relationship the coverage
 * analysis computes: which table the most headline claims rest on, and what would go
 * with it if that table were wrong.
 *
 * So each stone is a claim. Brass stones rest on the keystone table. Hollow stones
 * are claims we could not tie to any evidence — real gaps, in the real structure.
 * The build animation lays the stones from the springing points inward and sets the
 * keystone last, which is the order they actually go in.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type StoneKind = "keystone" | "supported" | "missing";

export interface StoneDatum {
  kind: StoneKind;
  label: string;
  detail: string;
}

const INNER_RADIUS = 1.72;
const OUTER_RADIUS = 2.5;
const DEPTH = 0.86;
const JOINT = 0.012; // mortar gap, in radians

const PALETTE: Record<StoneKind, string> = {
  keystone: "#e0ae5c",
  supported: "#d3cab7",
  missing: "#b9b0a0",
};

function voussoir(a0: number, a1: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, OUTER_RADIUS, a0, a1, false);
  shape.absarc(0, 0, INNER_RADIUS, a1, a0, true);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelSize: 0.015,
    bevelThickness: 0.015,
    bevelSegments: 2,
    curveSegments: 32,
  });
  geometry.translate(0, 0, -DEPTH / 2);
  return geometry;
}

/** Critically-damped approach — motion that settles rather than ringing or sliding. */
function approach(current: number, target: number, delta: number, rate = 9): number {
  return current + (target - current) * (1 - Math.exp(-rate * delta));
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

interface StoneProps {
  datum: StoneDatum;
  index: number;
  total: number;
  delay: number;
  collapsed: boolean;
  onHover: (datum: StoneDatum | null) => void;
  onSelect: () => void;
}

function Stone({ datum, index, total, delay, collapsed, onHover, onSelect }: StoneProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const mountedAt = useRef<number | null>(null);
  const fall = useRef(0);
  const fallFrom = useRef(0);
  const transitionAt = useRef<number | null>(null);
  const wasCollapsed = useRef(collapsed);

  const span = Math.PI / total;
  const a0 = index * span + JOINT;
  const a1 = (index + 1) * span - JOINT;
  const geometry = useMemo(() => voussoir(a0, a1), [a0, a1]);

  const mid = (a0 + a1) / 2;
  const radial = useMemo(() => new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0), [mid]);

  // Hollow stones are drawn as an outline: the gap has to read as absence of
  // evidence, not as a differently-coloured stone.
  const missing = datum.kind === "missing";

  useFrame((state, rawDelta) => {
    const node = group.current;
    if (!node) return;
    const delta = Math.min(rawDelta, 0.05);

    // The build is driven by the clock, not by accumulated frame deltas. A browser
    // that throttles requestAnimationFrame — a background tab, a pane that is not
    // being composited — delivers far fewer frames than seconds, and a delta-summed
    // animation then takes minutes of wall time to finish. Reading elapsed time means
    // the first frame drawn after the animation's duration shows it already built,
    // however few frames arrived in between.
    if (mountedAt.current === null) mountedAt.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - mountedAt.current;
    const settled = easeOut(clamp01((age - delay) / 0.9));

    // Clock-driven for the same reason as the build above: a damped approach summed
    // over frame deltas barely moves when the page is throttled, so the collapse
    // simply did not happen on a backgrounded tab.
    if (wasCollapsed.current !== collapsed) {
      wasCollapsed.current = collapsed;
      fallFrom.current = fall.current;
      transitionAt.current = state.clock.elapsedTime;
    }
    const target = collapsed && datum.kind !== "missing" ? 1 : 0;
    if (transitionAt.current === null) {
      fall.current = target;
    } else {
      const duration = target === 1 ? 1.15 : 0.6;
      const t = easeOut(clamp01((state.clock.elapsedTime - transitionAt.current) / duration));
      fall.current = fallFrom.current + (target - fallFrom.current) * t;
    }

    // Stones arrive from outside the arch, along the line they will bear on. Set
    // directly from the eased clock value so the entry cannot lag; only the
    // interactive offsets below are damped.
    const entry = (1 - settled) * 1.45;
    const lift = approach(node.userData.lift ?? 0, hovered ? 0.11 : 0, delta, 12);
    node.userData.lift = lift;
    const out = entry + lift;

    // The collapse has to stay in frame to be read as one. Stones settle onto the
    // ground line and tumble outward rather than dropping out of view.
    const spread = (index - (total - 1) / 2) / Math.max(total / 2, 1);
    node.position.x = radial.x * out + fall.current * spread * 0.85;
    node.position.y = radial.y * out - fall.current * (1.15 + Math.abs(spread) * 0.35);
    node.rotation.z = fall.current * (spread * 1.15 + 0.25);
    node.scale.setScalar(settled * (hovered ? 1.035 : 1));
  });

  return (
    <group ref={group} scale={0}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          onHover(datum);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover(null);
          document.body.style.cursor = "auto";
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <meshStandardMaterial
          color={PALETTE[datum.kind]}
          // Low metalness on purpose. A metallic surface takes almost all of its
          // colour from what it reflects, and with no environment map to reflect it
          // renders nearly black — the brass came out looking like chocolate. A
          // mostly-dielectric surface with a warm albedo reads as polished brass
          // under this lighting, and costs nothing to draw.
          roughness={datum.kind === "keystone" ? 0.38 : 0.9}
          metalness={datum.kind === "keystone" ? 0.18 : 0.03}
          emissive={datum.kind === "keystone" ? "#8a5f1d" : "#000000"}
          emissiveIntensity={datum.kind === "keystone" ? 0.12 : 0}
          transparent={missing}
          opacity={missing ? 0.14 : 1}
          flatShading={false}
        />
      </mesh>
      {missing ? (
        <lineSegments>
          <edgesGeometry args={[geometry]} />
          <lineBasicMaterial color="#a8623f" transparent opacity={0.7} />
        </lineSegments>
      ) : null}
    </group>
  );
}

function Pier({ side }: { side: -1 | 1 }) {
  return (
    <mesh position={[side * (INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) / 2), -1.15, 0]} receiveShadow castShadow>
      <boxGeometry args={[OUTER_RADIUS - INNER_RADIUS, 2.3, DEPTH]} />
      <meshStandardMaterial color="#c6bda9" roughness={0.95} metalness={0.02} />
    </mesh>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.31, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <shadowMaterial opacity={0.14} />
    </mesh>
  );
}

/** A slow parallax drift, driven by the pointer. Enough to feel physical, not enough to distract. */
function Drift() {
  const { camera } = useThree();
  const target = useRef({ x: 0, y: 0 });

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    target.current.x = state.pointer.x * 0.55;
    target.current.y = state.pointer.y * 0.3;
    camera.position.x = approach(camera.position.x, target.current.x, delta, 2.2);
    camera.position.y = approach(camera.position.y, 0.35 + target.current.y, delta, 2.2);
    camera.lookAt(0, 0.55, 0);
  });
  return null;
}

export interface ArchProps {
  stones: StoneDatum[];
  collapsed: boolean;
  onHover: (datum: StoneDatum | null) => void;
  onSelectKeystone: () => void;
}

export function Arch({ stones, collapsed, onHover, onSelectKeystone }: ArchProps) {
  const total = Math.max(stones.length, 1);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      camera={{ position: [0, 0.35, 6.6], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
    >
      {/* Deliberately no post-processing. A warm key light and a soft fill read as
          stone; ambient occlusion and bloom cost frames and make it look rendered. */}
      <ambientLight intensity={0.62} color="#fff3e0" />
      <directionalLight
        position={[3.4, 5.2, 4.2]}
        intensity={1.5}
        color="#ffe9c9"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight position={[-4.5, 1.5, -2]} intensity={0.35} color="#cfd8e6" />

      <group position={[0, -0.45, 0]}>
        {stones.map((datum, index) => (
          <Stone
            key={`${datum.label}-${index}`}
            datum={datum}
            index={index}
            total={total}
            // Laid from the springing points inward, keystone last — the order an
            // arch is actually built in, and the reason it stands at all.
            delay={0.25 + (total / 2 - Math.abs(index - (total - 1) / 2)) * 0.075}
            collapsed={collapsed}
            onHover={onHover}
            onSelect={datum.kind === "keystone" ? onSelectKeystone : () => {}}
          />
        ))}
        <Pier side={-1} />
        <Pier side={1} />
        <Ground />
      </group>

      <Drift />
    </Canvas>
  );
}
