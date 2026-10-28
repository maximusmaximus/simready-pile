import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import {
  CoefficientCombineRule,
  ConvexHullCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { props, type PropAsset } from "@/data/catalog";
import { bodies, bodyIds, pileBus, emitPile } from "./bus";
import { liveLimit, onPhone } from "./device";
import { limitLoads } from "./glb-queue";
import { getPile, savePile, type PileRow } from "./store";

const CATALOG_URL = "https://raw.githubusercontent.com/maximusmaximus/simready-pile/fdb1870/catalog.json";

async function loadAssets(): Promise<PropAsset[]> {
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) return props;
    const data = (await res.json()) as PropAsset[];
    if (!Array.isArray(data) || data.length < props.length) return props;
    return data
      .filter((asset) => asset?.id && asset.url && Array.isArray(asset.hull) && asset.hull.length >= 12)
      .map((asset) => ({
        ...asset,
        url: `https://raw.githubusercontent.com/maximusmaximus/simready-pile/fdb1870/glb/${asset.id}.glb`,
      }));
  } catch {
    return props;
  }
}

type Drop = {
  key: string;
  asset: PropAsset;
  position: [number, number, number];
  rotation: [number, number, number];
  quat?: { x: number; y: number; z: number; w: number };
  settled?: boolean;
};

function Lights({ lit }: { lit: boolean }) {
  return (
    <>
      <hemisphereLight args={lit ? ["#fff6e8", "#cbbba6", 1.2] : ["#3a342c", "#090807", 0.16]} />
      <ambientLight intensity={lit ? 0.78 : 0.04} />
      <directionalLight
        position={[7, 12, 5]}
        intensity={lit ? 2.8 : 0.38}
        color={lit ? "#fffaf2" : "#ffe0b0"}
        castShadow={!onPhone()}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={2}
        shadow-camera-far={28}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.00035}
      />
      <directionalLight
        position={[-6, 6, -4]}
        intensity={lit ? 1.15 : 0.08}
        color={lit ? "#ffe7c2" : "#8a7a66"}
      />
    </>
  );
}

function Backdrop({ lit }: { lit: boolean }) {
  const { scene } = useThree();
  useEffect(() => {
    const color = new THREE.Color(lit ? "#f3ece3" : "#0e0d0b");
    scene.background = color;
    scene.fog = new THREE.Fog(color, 13, 32);
  }, [lit, scene]);
  return null;
}

const AREA = 2.85;

function discGeometry(radius: number, rings: number, segs: number) {
  const positions = [0, 0, 0];
  const indices: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    const rad = (ring / rings) * radius;
    for (let seg = 0; seg < segs; seg++) {
      const angle = (seg / segs) * Math.PI * 2;
      positions.push(Math.cos(angle) * rad, Math.sin(angle) * rad, 0);
    }
  }
  for (let seg = 0; seg < segs; seg++) {
    indices.push(0, 1 + seg, 1 + ((seg + 1) % segs));
  }
  for (let ring = 1; ring < rings; ring++) {
    const row = 1 + (ring - 1) * segs;
    const next = row + segs;
    for (let seg = 0; seg < segs; seg++) {
      const a = row + seg;
      const b = row + ((seg + 1) % segs);
      const c = next + seg;
      const d = next + ((seg + 1) % segs);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Membrane({ lit }: { lit: boolean }) {
  const rings = 16;
  const segs = 32;
  const geometry = useMemo(() => discGeometry(AREA, rings, segs), []);
  const rest = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  const velocity = useMemo(() => new Float32Array(geometry.attributes.position.count), [geometry]);
  const edgeStart = 1 + (rings - 1) * segs;

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.033);
    const position = geometry.attributes.position;
    const array = position.array as Float32Array;
    const presses: { x: number; y: number; depth: number }[] = [];
    for (const body of bodies) {
      if (body === pileBus.held) continue;
      const t = body.translation();
      const speed = body.linvel();
      if (t.y > 0.85) continue;
      const localX = t.x;
      const localY = -t.z;
      if (Math.hypot(localX, localY) > AREA) continue;
      const depth = Math.min(0.46, Math.max(0, -speed.y) * 0.045 + Math.max(0, 0.42 - t.y) * 0.55);
      if (depth > 0.012) presses.push({ x: localX, y: localY, depth });
    }
    for (let i = 0; i < position.count; i++) {
      const o = i * 3;
      if (i >= edgeStart) {
        array[o + 2] = 0;
        velocity[i] = 0;
        continue;
      }
      const x = rest[o] ?? 0;
      const y = rest[o + 1] ?? 0;
      let target = 0;
      for (const press of presses) {
        const dist = Math.hypot(x - press.x, y - press.y);
        const reach = 0.72;
        if (dist >= reach) continue;
        target -= press.depth * Math.cos((dist / reach) * Math.PI * 0.5);
      }
      target = Math.max(target, -0.4);
      const z = array[o + 2] ?? 0;
      const next = (velocity[i] ?? 0) + ((target - z) * 78 - (velocity[i] ?? 0) * 8.5) * step;
      velocity[i] = next;
      array[o + 2] = z + next * step;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
      <meshStandardMaterial
        color={lit ? "#d7c2ae" : "#241c16"}
        roughness={0.48}
        metalness={0}
      />
    </mesh>
  );
}

function Floor({ lit }: { lit: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[22, 64]} />
        <meshStandardMaterial color={lit ? "#e6ded2" : "#12100c"} roughness={1} metalness={0} />
      </mesh>
      <Membrane lit={lit} />
      <RigidBody type="fixed" colliders={false} friction={0.48} restitution={0.86}>
        <CuboidCollider
          args={[24, 4, 24]}
          position={[0, -4, 0]}
          friction={0.48}
          restitution={0.86}
          restitutionCombineRule={CoefficientCombineRule.Max}
        />
        {Array.from({ length: 18 }, (_, i) => {
          const a = (i / 18) * Math.PI * 2;
          return (
            <CuboidCollider
              key={i}
              args={[0.16, 1.7, 0.58]}
              position={[Math.sin(a) * (AREA + 0.2), 1.6, Math.cos(a) * (AREA + 0.2)]}
              rotation={[0, a - Math.PI / 2, 0]}
              friction={0.7}
              restitution={0.18}
            />
          );
        })}
      </RigidBody>
    </group>
  );
}

function pickBox(hull: number[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < hull.length; i += 3) {
    const x = hull[i] ?? 0;
    const y = hull[i + 1] ?? 0;
    const z = hull[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const pad = 0.12;
  return {
    position: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as [number, number, number],
    args: [
      Math.max(0.32, maxX - minX + pad),
      Math.max(0.32, maxY - minY + pad),
      Math.max(0.32, maxZ - minZ + pad),
    ] as [number, number, number],
  };
}

class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

const prepared = new WeakSet<THREE.Object3D>();

// A clone shares geometry and materials with its source, so the source needs
// this work once for all copies of an asset.
function prepareScene(source: THREE.Object3D) {
  if (prepared.has(source)) return source;
  prepared.add(source);
  source.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = !onPhone();
    mesh.receiveShadow = !onPhone();
    mesh.geometry.computeVertexNormals();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const standard = mat as THREE.MeshStandardMaterial;
      standard.side = THREE.DoubleSide;
      standard.transparent = false;
      standard.opacity = 1;
      standard.depthWrite = true;
      standard.metalness = 0;
      standard.roughness = 0.62;
      if (standard.color) standard.color.set(0xffffff);
    }
  });
  return source;
}

function Prop({
  asset,
  position,
  rotation,
  quat,
  settled,
}: {
  asset: PropAsset;
  position: [number, number, number];
  rotation: [number, number, number];
  quat?: { x: number; y: number; z: number; w: number };
  settled?: boolean;
}) {
  // The GLBs have no Draco or Meshopt data, so skip those decoders.
  const gltf = useGLTF(asset.url, false, false, limitLoads);
  const body = useRef<RapierRigidBody>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const held = useRef(false);
  const ndc = useRef(new THREE.Vector2());
  const raycaster = useRef(new THREE.Raycaster());
  const plane = useRef(new THREE.Plane());
  const hit = useRef(new THREE.Vector3());
  const grabOffset = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const normal = useRef(new THREE.Vector3());
  const scene = useMemo(() => prepareScene(gltf.scene).clone(true), [gltf.scene]);
  const pick = useMemo(() => pickBox(asset.hull), [asset.hull]);

  useEffect(() => {
    const current = body.current;
    if (current) {
      bodies.add(current);
      bodyIds.set(current, asset.id);
      if (quat) current.setRotation(quat, true);
      if (settled) {
        current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        current.sleep();
      } else if (pileBus.rush > 0.05) {
        current.setLinvel({ x: 0, y: -(4 + pileBus.rush * 9 + pileBus.rush * pileBus.rush * 20), z: 0 }, true);
      }
    }
    return () => {
      if (current) {
        bodies.delete(current);
        bodyIds.delete(current);
      }
      if (pileBus.held === current) pileBus.held = null;
    };
  }, []);

  const release = () => {
    if (!held.current) return;
    held.current = false;
    pileBus.dragging = false;
    if (pileBus.held === body.current) pileBus.held = null;
    if (controls) controls.enabled = true;
    const current = body.current;
    if (!current) return;
    const v = velocity.current;
    const speed = v.length();
    if (speed > 7) v.multiplyScalar(7 / speed);
    current.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!held.current || pileBus.held !== body.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const up = () => release();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, controls]);

  useFrame((_, delta) => {
    const current = body.current;
    if (!held.current || !current || pileBus.held !== current) return;
    raycaster.current.setFromCamera(ndc.current, camera);
    const point = raycaster.current.ray.intersectPlane(plane.current, hit.current);
    if (!point) return;
    point.add(grabOffset.current);
    point.y = Math.max(0.06, point.y);
    const p = current.translation();
    const dt = Math.max(delta, 0.016);
    velocity.current.set((point.x - p.x) / dt, (point.y - p.y) / dt, (point.z - p.z) / dt);
    current.setTranslation({ x: point.x, y: point.y, z: point.z }, true);
    current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    current.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const current = body.current;
    if (!current) return;
    held.current = true;
    pileBus.dragging = true;
    pileBus.heat = Math.min(1, pileBus.heat + 0.16);
    pileBus.held = current;
    if (controls) controls.enabled = false;
    const rect = gl.domElement.getBoundingClientRect();
    ndc.current.set(
      ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.getWorldDirection(normal.current);
    plane.current.setFromNormalAndCoplanarPoint(normal.current, e.point);
    const p = current.translation();
    grabOffset.current.set(p.x - e.point.x, p.y - e.point.y, p.z - e.point.z);
    velocity.current.set(0, 0, 0);
    current.wakeUp();
    current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    current.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };

  return (
    <RigidBody
      ref={body}
      position={position}
      rotation={rotation}
      colliders={false}
      linearDamping={0.08}
      angularDamping={0.35}
      ccd
      canSleep
    >
      <group onPointerDown={onDown}>
        <primitive object={scene} />
        <mesh position={pick.position} castShadow={false} receiveShadow={false}>
          <boxGeometry args={pick.args} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <ConvexHullCollider args={[asset.hull]} mass={asset.mass} friction={0.94} restitution={0.04} />
    </RigidBody>
  );
}

function Spawner() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const queue = useRef<PropAsset[] | null>(null);
  const ready = useRef(false);
  const batch = useRef(1);
  const limit = useRef(Number.POSITIVE_INFINITY);
  const live = useRef(0);
  const waveLeft = useRef(0);
  const falling = useRef(false);
  const landAt = useRef(0);
  const moreSeen = useRef(0);
  const nextDrop = useRef(0);

  const beginWave = (remaining: number) => {
    const count = Math.min(remaining, batch.current, limit.current - live.current);
    if (count <= 0) {
      falling.current = false;
      pileBus.moreReady = false;
      emitPile();
      return;
    }
    waveLeft.current = count;
    falling.current = true;
    nextDrop.current = performance.now();
    landAt.current = Number.POSITIVE_INFINITY;
    pileBus.moreReady = false;
    emitPile();
  };

  useEffect(() => {
    let stop = false;
    void (async () => {
      let rows: PileRow[] = [];
      try {
        rows = await getPile();
      } catch {
        rows = [];
      }
      if (stop) return;
      const library = await loadAssets();
      if (stop) return;
      const saved = new Map(rows.filter((row) => row.settled).map((row) => [row.id, row]));
      limit.current = liveLimit();
      const resting: Drop[] = [];
      const pending: PropAsset[] = [];
      for (const asset of library) {
        const row = saved.get(asset.id);
        if (row) {
          if (resting.length >= limit.current) continue;
          resting.push({
            key: asset.id,
            asset,
            position: [row.x, row.y, row.z],
            rotation: [0, 0, 0],
            quat: { x: row.rx, y: row.ry, z: row.rz, w: row.rw },
            settled: true,
          });
        } else {
          pending.push(asset);
        }
      }
      for (let i = pending.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = pending[i]!;
        pending[i] = pending[j]!;
        pending[j] = swap;
      }
      queue.current = pending;
      live.current = resting.length;
      ready.current = true;
      batch.current = Math.max(1, Math.round((resting.length + pending.length) * 0.01));
      setDrops(resting);
      beginWave(pending.length);
    })();
    return () => {
      stop = true;
    };
  }, []);

  useFrame(() => {
    const pending = queue.current;
    if (!ready.current || !pending) return;
    if (pileBus.moreTick !== moreSeen.current && !falling.current && pending.length > 0) {
      moreSeen.current = pileBus.moreTick;
      beginWave(pending.length);
    }
    if (waveLeft.current > 0) {
      const now = performance.now();
      const next: Drop[] = [];
      while (waveLeft.current > 0 && pending.length > 0 && now >= nextDrop.current) {
        const asset = pending.pop()!;
        waveLeft.current -= 1;
        nextDrop.current += 110;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * (AREA - 1.05);
        next.push({
          key: asset.id,
          asset,
          position: [
            Math.cos(angle) * radius,
            2.4 + Math.random() * 1.4,
            Math.sin(angle) * radius,
          ],
          rotation: [Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI],
        });
      }
      if (next.length) {
        live.current += next.length;
        setDrops((prev) => [...prev, ...next]);
      }
      if (waveLeft.current === 0) landAt.current = performance.now() + 1400;
    }
    if (!falling.current || waveLeft.current > 0 || performance.now() < landAt.current) return;
    falling.current = false;
    pileBus.moreReady = pending.length > 0 && live.current < limit.current;
    emitPile();
  });

  return (
    <>
      {drops.map((drop) => (
        <QuietBoundary key={drop.key}>
          <Suspense fallback={null}>
            <Prop
              asset={drop.asset}
              position={drop.position}
              rotation={drop.rotation}
              quat={drop.quat}
              settled={drop.settled}
            />
          </Suspense>
        </QuietBoundary>
      ))}
    </>
  );
}

function PersistPile() {
  const acc = useRef(1.5);
  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current < 2 || pileBus.dragging || bodies.size === 0) return;
    acc.current = 0;
    const items: PileRow[] = [];
    for (const body of bodies) {
      const id = bodyIds.get(body);
      if (!id) continue;
      const t = body.translation();
      const r = body.rotation();
      const v = body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      items.push({
        id,
        x: t.x,
        y: t.y,
        z: t.z,
        rx: r.x,
        ry: r.y,
        rz: r.z,
        rw: r.w,
        settled: speed < 0.4 && t.y < 2,
      });
    }
    if (items.length === 0 || items.length > 80) return;
    void savePile({ data: { items } }).catch(() => {});
  });
  return null;
}

function WorldForces() {
  const { world } = useRapier();
  const camera = useThree((s) => s.camera);
  const seen = useRef(0);
  const right = useRef(new THREE.Vector3());
  const screenUp = useRef(new THREE.Vector3());
  const gravity = useRef(new THREE.Vector3(0, -22, 0));
  const target = useRef(new THREE.Vector3(0, -22, 0));

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    pileBus.rush *= Math.exp(-dt * 1.35);
    pileBus.heat = Math.max(0, pileBus.heat - dt * 0.035);
    const rush = pileBus.rush;
    const G = 24 + rush * 10;
    right.current.setFromMatrixColumn(camera.matrixWorld, 0);
    right.current.y = 0;
    if (right.current.lengthSq() < 1e-6) right.current.set(1, 0, 0);
    else right.current.normalize();
    screenUp.current.setFromMatrixColumn(camera.matrixWorld, 1);
    screenUp.current.y = 0;
    if (screenUp.current.lengthSq() < 1e-6) screenUp.current.set(0, 0, -1);
    else screenUp.current.normalize();

    if (pileBus.orient.active) {
      const orientAngle =
        ((window.screen.orientation?.angle ??
          (window as Window & { orientation?: number }).orientation ??
          0) *
          Math.PI) /
        180;
      const beta = (pileBus.orient.beta * Math.PI) / 180;
      const gamma = (pileBus.orient.gamma * Math.PI) / 180;
      const dx = Math.sin(gamma);
      const dy = -Math.cos(gamma) * Math.sin(beta);
      const dz = -Math.cos(gamma) * Math.cos(beta);
      const cos = Math.cos(-orientAngle);
      const sin = Math.sin(-orientAngle);
      const sx = dx * cos - dy * sin;
      const sy = dx * sin + dy * cos;
      target.current.set(0, dz * G, 0);
      target.current.addScaledVector(right.current, sx * G);
      target.current.addScaledVector(screenUp.current, sy * G);
      if (target.current.lengthSq() > 1e-6) target.current.normalize().multiplyScalar(G);
    } else {
      target.current.set(0, -G, 0);
    }
    const blend = 1 - Math.exp(-dt * 9);
    gravity.current.lerp(target.current, blend);
    world.gravity.x = gravity.current.x;
    world.gravity.y = gravity.current.y;
    world.gravity.z = gravity.current.z;

    const decay = Math.exp(-dt * 7);
    pileBus.jolt.x *= decay;
    pileBus.jolt.y *= decay;
    pileBus.jolt.z *= decay;
    pileBus.jolt.mag *= decay;
    const jmag = pileBus.jolt.mag;
    if (pileBus.orient.active || jmag > 2) {
      for (const body of bodies) {
        if (body !== pileBus.held) body.wakeUp();
      }
    }

    for (const body of bodies) {
      const mass = body.mass();
      if (!Number.isFinite(mass) || mass <= 0 || body === pileBus.held) continue;
      const t = body.translation();
      const dist = Math.hypot(t.x, t.z);
      if (t.y < -0.02) {
        const v = body.linvel();
        body.setTranslation({ x: t.x, y: 0.06, z: t.z }, true);
        body.setLinvel(
          { x: v.x * 0.9, y: Math.max(2.4, -v.y * 0.8), z: v.z * 0.9 },
          true,
        );
        continue;
      }
      const edge = AREA - 0.35;
      if (dist < edge) continue;
      const pull = Math.min(28, Math.max(0, dist - edge) * 6 + Math.max(0, -t.y) * 12);
      const scale = pull * mass * dt;
      const basis = Math.max(dist, 0.2);
      body.applyImpulse(
        { x: (-t.x / basis) * scale, y: t.y < 0 ? scale : 0, z: (-t.z / basis) * scale },
        true,
      );
    }

    if (pileBus.shakeSeq === seen.current) return;
    seen.current = pileBus.shakeSeq;
    const power = pileBus.shakePower;
    const jx = pileBus.jolt.x;
    const jy = pileBus.jolt.y;
    const denom = Math.max(Math.hypot(jx, jy), 0.001);
    const ix = jx / denom;
    const iy = jy / denom;
    for (const body of bodies) {
      const mass = body.mass();
      if (!Number.isFinite(mass) || mass <= 0 || body === pileBus.held) continue;
      body.wakeUp();
      body.applyImpulse(
        {
          x: (right.current.x * ix + screenUp.current.x * iy) * mass * 1.15 * power,
          y: -mass * (1.1 + power * 1.35),
          z: (right.current.z * ix + screenUp.current.z * iy) * mass * 1.15 * power,
        },
        true,
      );
      body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * mass * 0.7 * power,
          y: (Math.random() - 0.5) * mass * 0.45 * power,
          z: (Math.random() - 0.5) * mass * 0.7 * power,
        },
        true,
      );
    }
  });

  return null;
}

function OrbitRig() {
  const ref = useRef<OrbitControlsImpl>(null);
  useFrame(() => {
    if (ref.current) ref.current.enabled = !pileBus.dragging;
  });
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan
      screenSpacePanning
      panSpeed={1.35}
      rotateSpeed={1.75}
      zoomSpeed={1.2}
      enableDamping
      dampingFactor={0.07}
      minDistance={2.4}
      maxDistance={28}
      minPolarAngle={0.08}
      maxPolarAngle={1.42}
      target={[0, 0.15, 0]}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

const PLANE_TILT = Math.PI / 6;

function FrameView() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
    const fov = 40;
    camera.fov = fov;
    const vFov = THREE.MathUtils.degToRad(fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const span = AREA * 2 + 0.7;
    const dist = span / 2 / Math.tan(hFov / 2);
    const look = new THREE.Vector3(0, 0.12, 0);
    camera.position.set(0, look.y + Math.sin(PLANE_TILT) * dist, look.z + Math.cos(PLANE_TILT) * dist);
    camera.near = 0.08;
    camera.far = Math.max(80, dist * 4);
    camera.lookAt(look);
    const fullH = size.height * 1.06;
    camera.setViewOffset(size.width, fullH, 0, 0, size.width, size.height);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(look);
      controls.update();
    }
  }, [camera, controls, size.height, size.width]);

  return null;
}

function Stage({ lit }: { lit: boolean }) {
  return (
    <Physics gravity={[0, -18, 0]} timeStep={1 / 60} maxCcdSubsteps={6} contactNaturalFrequency={90}>
      <Backdrop lit={lit} />
      <Lights lit={lit} />
      <Floor lit={lit} />
      <Spawner />
      <PersistPile />
      <WorldForces />
      <OrbitRig />
      <FrameView />
    </Physics>
  );
}

export function PileCanvas({ lit }: { lit: boolean }) {
  // A phone draws no shadows, no antialiasing and one pixel per CSS pixel.
  const phone = onPhone();
  return (
    <Canvas
      className="h-full w-full touch-none"
      shadows={!phone}
      dpr={phone ? 1 : [1, 1.5]}
      camera={{ position: [0, 6.2, 10.8], fov: 40, near: 0.08, far: 80 }}
      gl={{ antialias: !phone, alpha: false, powerPreference: "high-performance" }}
      onPointerMissed={() => {
        pileBus.dragging = false;
      }}
    >
      <Suspense fallback={null}>
        <Stage lit={lit} />
      </Suspense>
    </Canvas>
  );
}
