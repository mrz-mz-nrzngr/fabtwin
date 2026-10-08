"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { useFab, simNow } from "@/store/useFab";
import { loopPos } from "@/sim/config";
import { foupPhase, vehicleS } from "@/sim/motion";
import { E10_COLOR } from "@/art/StatusGlyph";
import { buildLayout, BAY_FLOOR, PORT_Y, TRACK_Y } from "./layout3d";
import type { SceneLayout } from "./layout3d";
import { BAY_NAME } from "@/ui/format";
import type { LotView } from "@/sim/types";

const MAX_FOUPS = 200;
const tmp = new THREE.Object3D();
const col = new THREE.Color();

function setPart(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  tmp.position.set(x, y, z);
  tmp.rotation.set(0, ry, 0);
  tmp.scale.set(sx, sy, sz);
  tmp.updateMatrix();
  mesh.setMatrixAt(i, tmp.matrix);
}

/** Static scenery and tools: three instanced draw calls for every box, cylinder and status lamp in the fab. */
function Fab({ layout }: { layout: SceneLayout }) {
  const select = useFab((s) => s.select);
  const getThree = useThree((s) => s.get);
  const boxRef = useRef<THREE.InstancedMesh>(null);
  const cylRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const padRef = useRef<THREE.InstancedMesh>(null);
  const flagRef = useRef<THREE.InstancedMesh>(null);
  const [hover, setHover] = useState<string | null>(null);
  const toolIdx = useMemo(() => new Map(layout.tools.map((t, i) => [t.id, i])), [layout]);

  useLayoutEffect(() => {
    const b = boxRef.current!;
    layout.boxes.forEach((p, i) => {
      setPart(b, i, p.x, p.y, p.z, p.sx, p.sy, p.sz);
      b.setColorAt(i, col.set(p.color));
    });
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    const c = cylRef.current!;
    layout.cyls.forEach((p, i) => {
      setPart(c, i, p.x, p.y, p.z, p.sx, p.sy, p.sz);
      c.setColorAt(i, col.set(p.color));
    });
    c.instanceMatrix.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    layout.tools.forEach((t, i) => {
      setPart(lampRef.current!, i, t.x - 2.1, 5.75, t.z + t.front * -2.4, 0.8, 0.8, 0.8);
      setPart(padRef.current!, i, t.x, 0.06, t.z, 5.8, 0.12, 7.0);
      setPart(flagRef.current!, i, t.x - 2.1, 7.2, t.z + t.front * -2.4, 0, 0, 0);
      lampRef.current!.setColorAt(i, col.set("#5aa9e6"));
      padRef.current!.setColorAt(i, col.set("#1a2630"));
      flagRef.current!.setColorAt(i, col.set("#f0b429"));
    });
    for (const m of [lampRef.current!, padRef.current!, flagRef.current!]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    getThree().gl.shadowMap.needsUpdate = true;
  }, [layout, getThree]);

  const last = useRef<{ snap: unknown; states: string[]; flags: string[] }>({ snap: null, states: [], flags: [] });
  useFrame(() => {
    const snap = useFab.getState().snap;
    if (!snap || snap === last.current.snap) return;
    last.current.snap = snap;
    const lamp = lampRef.current!;
    const pad = padRef.current!;
    const flag = flagRef.current!;
    let dirtyC = false;
    let dirtyF = false;
    for (const t of snap.tools) {
      const i = toolIdx.get(t.id);
      if (i === undefined) continue;
      if (last.current.states[i] !== t.state) {
        last.current.states[i] = t.state;
        lamp.setColorAt(i, col.set(E10_COLOR[t.state]));
        pad.setColorAt(i, col.set(E10_COLOR[t.state]).multiplyScalar(t.state === "PRODUCTIVE" ? 0.32 : 0.45));
        dirtyC = true;
      }
      const f = t.warn && t.state !== "UNSCHEDULED_DOWN" ? "w" : t.pmPending ? "p" : "";
      if (last.current.flags[i] !== f) {
        last.current.flags[i] = f;
        const tl = layout.tools[i];
        const s = f ? 0.7 : 0;
        setPart(flag, i, tl.x - 2.1, 7.2, tl.z + tl.front * -2.4, s, s, s);
        flag.setColorAt(i, col.set(f === "w" ? "#f0b429" : "#7fa6c4"));
        dirtyF = true;
      }
    }
    if (dirtyC) {
      lamp.instanceColor!.needsUpdate = true;
      pad.instanceColor!.needsUpdate = true;
    }
    if (dirtyF) {
      flag.instanceMatrix.needsUpdate = true;
      flag.instanceColor!.needsUpdate = true;
    }
  });

  const pick = (e: ThreeEvent<MouseEvent>, owners: Array<string | undefined>) => {
    e.stopPropagation();
    const id = e.instanceId !== undefined ? owners[e.instanceId] : undefined;
    if (id) select({ kind: "tool", id });
  };
  const boxOwners = useMemo(() => layout.boxes.map((p) => p.owner), [layout]);
  const cylOwners = useMemo(() => layout.cyls.map((p) => p.owner), [layout]);
  const toolIds = useMemo(() => layout.tools.map((t) => t.id), [layout]);
  const over = (e: ThreeEvent<PointerEvent>, owners: Array<string | undefined>) => {
    e.stopPropagation();
    const id = e.instanceId !== undefined ? owners[e.instanceId] : undefined;
    if (id) {
      setHover(id);
      document.body.style.cursor = "pointer";
    }
  };
  const out = () => {
    setHover(null);
    document.body.style.cursor = "";
  };
  const hv = hover ? layout.tools.find((t) => t.id === hover) : undefined;

  return (
    <>
      <instancedMesh ref={boxRef} args={[undefined, undefined, layout.boxes.length]} castShadow receiveShadow frustumCulled={false} onClick={(e) => pick(e, boxOwners)} onPointerOver={(e) => over(e, boxOwners)} onPointerOut={out}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.78} metalness={0.08} />
      </instancedMesh>
      <instancedMesh ref={cylRef} args={[undefined, undefined, layout.cyls.length]} castShadow receiveShadow frustumCulled={false} onClick={(e) => pick(e, cylOwners)} onPointerOver={(e) => over(e, cylOwners)} onPointerOut={out}>
        <cylinderGeometry args={[1, 1, 1, 20]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} metalness={0.15} />
      </instancedMesh>
      <instancedMesh ref={padRef} args={[undefined, undefined, layout.tools.length]} frustumCulled={false} onClick={(e) => pick(e, toolIds)} onPointerOver={(e) => over(e, toolIds)} onPointerOut={out}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[undefined, undefined, layout.tools.length]} frustumCulled={false} onClick={(e) => pick(e, toolIds)} onPointerOver={(e) => over(e, toolIds)} onPointerOut={out}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={flagRef} args={[undefined, undefined, layout.tools.length]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      {hv && (
        <Html position={[hv.x, 11, hv.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="num whitespace-nowrap rounded-xs border border-line bg-panel px-1.5 py-0.5 text-[11px] text-ink">{hv.id}</div>
        </Html>
      )}
    </>
  );
}

function Floor({ layout }: { layout: SceneLayout }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
        <planeGeometry args={[260, 170]} />
        <meshStandardMaterial color="#10161b" roughness={0.95} />
      </mesh>
      {layout.bayPads.map((p, i) => (
        <mesh key={i} position={[p.x, 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial color={BAY_FLOOR[p.bay]} roughness={0.9} />
        </mesh>
      ))}
    </>
  );
}

function BayLabels({ layout }: { layout: SceneLayout }) {
  const focusBay = useFab((s) => s.focusBay);
  return (
    <>
      {(Object.keys(layout.bayCenters) as Array<keyof typeof layout.bayCenters>).map((b) => {
        const c = layout.bayCenters[b];
        const pad = layout.bayPads.find((p) => p.bay === b)!;
        return (
          <Html key={b} position={[pad.x, 0.2, c.z < 0 ? c.z - 6.2 : c.z + 6.2]} center zIndexRange={[10, 0]}>
            <button type="button" onClick={() => focusBay(b)} className="whitespace-nowrap rounded-xs border border-line bg-panel/90 px-1.5 py-0.5 text-[11px] text-steel hover:text-ink" title="Focus the camera on this bay">
              {BAY_NAME[b]}
            </button>
          </Html>
        );
      })}
    </>
  );
}

/** Vehicles, FOUPs and the selection marker. Positions are written straight into instance buffers every frame. */
function Movers({ layout }: { layout: SceneLayout }) {
  const select = useFab((s) => s.select);
  const vehRef = useRef<THREE.InstancedMesh>(null);
  const foupRef = useRef<THREE.InstancedMesh>(null);
  const markRef = useRef<THREE.Mesh>(null);
  const toolMap = useMemo(() => new Map(layout.tools.map((t) => [t.id, t])), [layout]);
  const stockMap = useMemo(() => new Map(layout.stockers.map((s) => [s.id, s])), [layout]);
  const ids = useRef<string[]>([]);
  const lastSnap = useRef<unknown>(null);
  const idxOf = useRef(new Map<string, number>());
  const base = useRef(new Map<string, [number, number, number]>());

  useLayoutEffect(() => {
    const f = foupRef.current!;
    for (let i = 0; i < MAX_FOUPS; i++) f.setColorAt(i, col.set("#dfe7ee"));
    f.count = 0;
    const v = vehRef.current!;
    for (let i = 0; i < 12; i++) v.setColorAt(i, col.set("#9fc0d8"));
  }, []);

  const portOf = (loc: LotView["loc"], slot: number): [number, number, number] | null => {
    if (loc.k === "tool") {
      const t = toolMap.get(loc.id);
      return t ? [t.portX, PORT_Y, t.portZ] : null;
    }
    if (loc.k === "stocker") {
      const s = stockMap.get(loc.id);
      if (!s) return null;
      const dir = s.x > 0 ? 1 : -1;
      const row = Math.floor(slot / 6) % 5;
      const colI = slot % 6;
      return [s.faceX - dir * 0.0, 1.6 + row * 1.65, (colI - 2.5) * 1.75];
    }
    return null;
  };
  const dest = (to: { k: "tool" | "stocker"; id: string }): [number, number, number] => {
    if (to.k === "tool") {
      const t = toolMap.get(to.id)!;
      return [t.portX, PORT_Y, t.portZ];
    }
    const s = stockMap.get(to.id)!;
    return [s.portX, PORT_Y, 0];
  };

  useFrame(() => {
    const st = useFab.getState();
    const snap = st.snap;
    const veh = vehRef.current!;
    const foup = foupRef.current!;
    if (!snap) {
      veh.count = 0;
      foup.count = 0;
      return;
    }
    const t = simNow();
    // Rebuild the static positions and colours whenever a new snapshot arrives.
    if (snap !== lastSnap.current) {
      lastSnap.current = snap;
      const lots = snap.lots;
      idxOf.current.clear();
      base.current.clear();
      const slots = new Map<string, number>();
      const sorted = [...lots].sort((a, b) => (a.id < b.id ? -1 : 1));
      const n = Math.min(sorted.length, MAX_FOUPS);
      ids.current = [];
      for (let i = 0; i < n; i++) {
        const l = sorted[i];
        ids.current.push(l.id);
        idxOf.current.set(l.id, i);
        let slot = 0;
        if (l.loc.k === "stocker") {
          slot = slots.get(l.loc.id) ?? 0;
          slots.set(l.loc.id, slot + 1);
        }
        const p = portOf(l.loc, slot) ?? [0, -50, 0];
        base.current.set(l.id, p);
        const rose = l.prio === 1 ? "#ff8db3" : l.hot ? "#ff5c93" : l.held ? "#f0b429" : "#dfe7ee";
        foup.setColorAt(i, col.set(rose));
        const sc = l.prio === 1 ? 1.45 : l.hot ? 1.3 : 1.15;
        setPart(foup, i, p[0], p[1], p[2], sc, sc * 1.05, sc);
      }
      foup.count = n;
      foup.instanceMatrix.needsUpdate = true;
      if (foup.instanceColor) foup.instanceColor.needsUpdate = true;
    }
    // Vehicles move every frame, and the FOUP each one is handling is lifted or lowered with it.
    veh.count = snap.vehicles.length;
    let foupDirty = false;
    snap.vehicles.forEach((v, i) => {
      const s = vehicleS(v, t);
      const pos = loopPos(s);
      setPart(veh, i, pos.x, TRACK_Y + 0.05, pos.z, 1.5, 0.7, 2.4, Math.atan2(pos.dx, pos.dz));
      if (v.jobLotId) {
        const idx = idxOf.current.get(v.jobLotId);
        if (idx === undefined) return;
        const lot = snap.lots.find((l) => l.id === v.jobLotId);
        const hang: [number, number, number] = [pos.x, TRACK_Y - 1.5, pos.z];
        const fp = foupPhase(v, t);
        let p: [number, number, number] | null = null;
        if (fp.phase === "lift") {
          const a = base.current.get(v.jobLotId);
          if (a) p = [a[0] + (hang[0] - a[0]) * fp.k, a[1] + (hang[1] - a[1]) * fp.k, a[2] + (hang[2] - a[2]) * fp.k];
        } else if (fp.phase === "carry") {
          p = hang;
        } else if (fp.phase === "lower" && v.jobTo) {
          const b = dest(v.jobTo);
          p = [hang[0] + (b[0] - hang[0]) * fp.k, hang[1] + (b[1] - hang[1]) * fp.k, hang[2] + (b[2] - hang[2]) * fp.k];
        }
        if (p && lot) {
          const sc = lot.prio === 1 ? 1.45 : lot.hot ? 1.3 : 1.15;
          setPart(foup, idx, p[0], p[1], p[2], sc, sc * 1.05, sc);
          foupDirty = true;
        }
      }
    });
    veh.instanceMatrix.needsUpdate = true;
    if (foupDirty) foup.instanceMatrix.needsUpdate = true;

    // Selection marker.
    const mark = markRef.current!;
    const sel = st.selection;
    mark.visible = false;
    if (sel?.kind === "tool") {
      const tl = toolMap.get(sel.id);
      if (tl) {
        mark.visible = true;
        mark.position.set(tl.x, 0.2, tl.z);
        mark.scale.set(6.6, 8.0, 1);
        mark.rotation.set(-Math.PI / 2, 0, 0);
      }
    } else if (sel?.kind === "lot") {
      const idx = idxOf.current.get(sel.id);
      if (idx !== undefined) {
        const m = new THREE.Matrix4();
        foup.getMatrixAt(idx, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        mark.visible = true;
        mark.position.copy(p).add(new THREE.Vector3(0, 1.4, 0));
        mark.scale.set(2.2, 2.2, 1);
        mark.rotation.set(0, 0, 0);
        mark.lookAt(useThreeCamera.current?.position ?? new THREE.Vector3(0, 80, 80));
      }
    }
  });

  return (
    <>
      <instancedMesh ref={vehRef} args={[undefined, undefined, 12]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.3} />
      </instancedMesh>
      <instancedMesh
        ref={foupRef}
        args={[undefined, undefined, MAX_FOUPS]}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation();
          const id = e.instanceId !== undefined ? ids.current[e.instanceId] : undefined;
          if (id) select({ kind: "lot", id });
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.55} metalness={0.05} emissive="#1a1f24" />
      </instancedMesh>
      <mesh ref={markRef} visible={false} renderOrder={5}>
        <ringGeometry args={[0.42, 0.5, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color="#ff5c93" side={THREE.DoubleSide} depthTest={false} transparent opacity={0.95} />
      </mesh>
    </>
  );
}

const useThreeCamera: { current: THREE.Camera | null } = { current: null };

function Rig({ layout }: { layout: SceneLayout }) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const focus = useFab((s) => s.focus);
  useEffect(() => {
    useThreeCamera.current = camera;
  }, [camera]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (!focus.bay) {
      void c.setLookAt(0, 62, 80, 0, 0, -3, focus.n > 0);
      return;
    }
    const ctr = layout.bayCenters[focus.bay];
    if (focus.bay === "METRO") void c.setLookAt(ctr.x, 44, 42, ctr.x, 0, 0, true);
    else {
      const s = ctr.z < 0 ? 1 : -1;
      void c.setLookAt(ctr.x, 24, s * 14, ctr.x, 1, ctr.z, true);
    }
  }, [focus, layout]);
  return <CameraControls ref={controls} makeDefault minDistance={14} maxDistance={190} maxPolarAngle={Math.PI * 0.47} smoothTime={0.25} dollySpeed={0.8} />;
}

function Fps({ onFps }: { onFps: (n: number) => void }) {
  const acc = useRef({ n: 0, t: 0 });
  useFrame((_, dt) => {
    acc.current.n++;
    acc.current.t += dt;
    if (acc.current.t >= 1) {
      onFps(Math.round(acc.current.n / acc.current.t));
      acc.current = { n: 0, t: 0 };
    }
  });
  return null;
}

export default function FabScene({ onFps }: { onFps?: (n: number) => void }) {
  const layout = useMemo(() => buildLayout(), []);
  const focusBay = useFab((s) => s.focusBay);
  return (
    <div className="relative h-full w-full" data-testid="scene">
      <Canvas
        dpr={[1, 1.75]}
        shadows
        camera={{ position: [0, 62, 80], fov: 38, near: 1, far: 600 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.shadowMap.autoUpdate = false;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
        onPointerMissed={() => useFab.getState().select(null)}
      >
        <color attach="background" args={["#0a0f13"]} />
        <fog attach="fog" args={["#0a0f13", 170, 330]} />
        <hemisphereLight args={["#8fb0c9", "#0d1317", 0.5]} />
        <directionalLight position={[36, 84, 40]} intensity={2.1} color="#fff4e0" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-80} shadow-camera-right={80} shadow-camera-top={60} shadow-camera-bottom={-60} shadow-camera-near={10} shadow-camera-far={220} shadow-bias={-0.0006} />
        <Floor layout={layout} />
        <Fab layout={layout} />
        <Movers layout={layout} />
        <BayLabels layout={layout} />
        <Rig layout={layout} />
        {onFps && <Fps onFps={onFps} />}
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 flex gap-1.5">
        <button type="button" className="pointer-events-auto min-h-7 rounded-xs border border-line bg-panel/90 px-2 text-[12px] text-steel hover:text-ink" onClick={() => focusBay(null)}>
          Overview
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 right-2 rounded-xs bg-panel/80 px-1.5 text-[11px] text-muted">Drag to orbit, right-drag to pan, wheel to zoom, click a tool or FOUP</p>
    </div>
  );
}
