import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  Coordinate3D,
  DigitalTwinAabb,
  DigitalTwinBundle,
  DigitalTwinLabwareItem,
  DigitalTwinMotionPoint,
  DigitalTwinWarning,
} from "../../types";

interface Props {
  twin: DigitalTwinBundle | null;
  current: DigitalTwinMotionPoint | null;
  pathIndex: number;
  loading?: boolean;
  error?: string | null;
  onPathIndexChange?: (index: number) => void;
}

function cubosToThree(point: Coordinate3D): [number, number, number] {
  return [point.x, point.z, -point.y];
}

export default function DigitalTwinScene({
  twin,
  current,
  pathIndex,
  loading = false,
  error = null,
  onPathIndexChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labware = useMemo(() => flattenLabware(twin?.deck.labware ?? []), [twin]);

  useEffect(() => {
    if (!hostRef.current || !twin || !current) return;

    const host = hostRef.current;
    host.replaceChildren();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (reason) {
      const message = document.createElement("div");
      message.className = "digital-sim-canvas-status";
      message.textContent = `3D renderer unavailable: ${reason instanceof Error ? reason.message : String(reason)}`;
      host.appendChild(message);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#f4f6f8");
    renderer.domElement.setAttribute("aria-label", "3D digital twin viewport");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f4f6f8");

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
    const target = workingVolumeTarget(twin);
    const cameraDistance = workingVolumeCameraDistance(twin);
    camera.position.set(
      target.x + cameraDistance * 0.62,
      target.y + cameraDistance * 0.42,
      target.z + cameraDistance * 0.78,
    );
    camera.lookAt(target);

    scene.add(new THREE.AmbientLight("#ffffff", 1.55));
    const keyLight = new THREE.DirectionalLight("#ffffff", 1.1);
    keyLight.position.set(200, 350, 150);
    scene.add(keyLight);

    const world = new THREE.Group();
    scene.add(world);
    addVolume(world, twin);
    addAxes(world);
    for (const item of labware) {
      addLabware(world, item);
    }
    addMotionPath(world, twin.motion.path);
    addGantry(world, twin, current);

    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const width = host.clientWidth || 720;
      const height = host.clientHeight || 520;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let distanceScale = 1;

    const updateCameraDistance = (scale: number) => {
      distanceScale = Math.max(0.45, Math.min(2.6, scale));
      const offset = new THREE.Vector3().subVectors(camera.position, target).normalize();
      camera.position.copy(target).add(offset.multiplyScalar(cameraDistance * distanceScale));
      camera.lookAt(target);
      render();
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      world.rotation.y += (event.clientX - lastX) * 0.006;
      world.rotation.x += (event.clientY - lastY) * 0.004;
      world.rotation.x = Math.max(-0.9, Math.min(0.9, world.rotation.x));
      lastX = event.clientX;
      lastY = event.clientY;
      render();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      updateCameraDistance(distanceScale * (event.deltaY > 0 ? 1.08 : 0.92));
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resize);
    resize();

    return () => {
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      disposeObject(scene);
      renderer.dispose();
      host.replaceChildren();
    };
  }, [current, labware, twin]);

  if (!twin || !current) {
    return (
      <div className="digital-sim-status">
        {loading ? "Building Digital Sim motion bundle..." : "Load gantry and deck configs to view the digital twin."}
        {error ? <span>{error}</span> : null}
      </div>
    );
  }

  return (
    <main className="digital-sim-app" aria-label="CubOS Digital Twin">
      <div ref={hostRef} className="digital-sim-viewport" />
      <DigitalTwinSidebar
        twin={twin}
        current={current}
        pathIndex={pathIndex}
        loading={loading}
        error={error}
        onPathIndexChange={onPathIndexChange}
      />
    </main>
  );
}

function DigitalTwinSidebar({
  twin,
  current,
  pathIndex,
  loading,
  error,
  onPathIndexChange,
}: {
  twin: DigitalTwinBundle;
  current: DigitalTwinMotionPoint;
  pathIndex: number;
  loading: boolean;
  error: string | null;
  onPathIndexChange?: (index: number) => void;
}) {
  const pathLength = twin.motion.path.length;

  return (
    <aside className="digital-sim-sidebar">
      <div>
        <h1>CubOS Digital Twin</h1>
        <p>{twin.coordinateSystem.origin}; +X right, +Y back, +Z up.</p>
      </div>

      <label className="digital-sim-slider">
        <span>Path sample {pathLength ? pathIndex + 1 : 0} / {pathLength}</span>
        <input
          aria-label="Motion path sample"
          type="range"
          min={0}
          max={Math.max(pathLength - 1, 0)}
          value={Math.min(pathIndex, Math.max(pathLength - 1, 0))}
          disabled={!pathLength || !onPathIndexChange}
          onChange={(event) => onPathIndexChange?.(Number(event.target.value))}
        />
      </label>

      {loading ? <p className="digital-sim-info">Building Digital Sim motion bundle...</p> : null}
      {error ? <p className="digital-sim-error">{error}</p> : null}

      <section>
        <h2>Current Pose</h2>
        <dl>
          <dt>Step</dt><dd>{current.stepIndex}</dd>
          <dt>Command</dt><dd>{current.command}</dd>
          <dt>Phase</dt><dd>{current.phase}</dd>
          <dt>Target</dt><dd>{current.targetRef}</dd>
          <dt>TCP</dt>
          <dd>{current.tool.x.toFixed(1)}, {current.tool.y.toFixed(1)}, {current.tool.z.toFixed(1)}</dd>
        </dl>
      </section>

      <section>
        <h2>Protocol</h2>
        {twin.protocol.timeline.length ? (
          <ol className="digital-sim-timeline">
            {twin.protocol.timeline.map((step) => (
              <li key={step.index} className={current.stepIndex === step.index ? "active" : ""}>
                <button type="button" onClick={() => onPathIndexChange?.(step.pathStart)}>
                  <span>{step.index}</span>
                  <strong>{step.command}</strong>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>No simulated protocol timeline loaded.</p>
        )}
      </section>

      <section>
        <h2>Warnings</h2>
        <ul className="digital-sim-warnings">
          {twin.warnings.length === 0 ? <li>No first-pass AABB warnings.</li> : null}
          {twin.warnings.slice(0, 12).map((warning) => (
            <li key={warningKey(warning)}>
              <button type="button" onClick={() => onPathIndexChange?.(warning.pathIndex)}>
                <strong>{warning.type}</strong> step {warning.stepIndex}: {warning.object}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function addVolume(group: THREE.Group, twin: DigitalTwinBundle) {
  const v = twin.gantry.workingVolume;
  const center = cubosToThree({
    x: (v.x_min + v.x_max) / 2,
    y: (v.y_min + v.y_max) / 2,
    z: (v.z_min + v.z_max) / 2,
  });
  const size: [number, number, number] = [v.x_max - v.x_min, v.z_max - v.z_min, v.y_max - v.y_min];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshBasicMaterial({ color: "#96a3b7", wireframe: true, transparent: true, opacity: 0.42 }),
  );
  mesh.position.set(...center);
  group.add(mesh);
}

function addAxes(group: THREE.Group) {
  addLine(group, [0, 0, 0], [80, 0, 0], "#d13f31");
  addLine(group, [0, 0, 0], [0, 0, -80], "#247a3d");
  addLine(group, [0, 0, 0], [0, 80, 0], "#2d5fd7");
  group.add(textSprite("+X", "#d13f31", [88, 0, 0]));
  group.add(textSprite("+Y", "#247a3d", [0, 0, -88]));
  group.add(textSprite("+Z", "#2d5fd7", [0, 88, 0]));
}

function addLabware(group: THREE.Group, item: DigitalTwinLabwareItem) {
  const color = item.kind.includes("vial") ? "#bf7a30" : item.kind.includes("plate") ? "#4b87b9" : "#6f7c48";
  if (item.aabb) {
    const { center, size } = aabbCenterSize(item.aabb);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.32 }),
    );
    mesh.position.set(...center);
    group.add(mesh);
  }
  for (const well of item.wells ?? []) {
    addCylinder(group, well.center, 2.1, 1.5, "#1d4f78");
  }
  for (const tip of item.tips ?? []) {
    addCylinder(group, tip.center, 1.8, 5, tip.present ? "#75905b" : "#858585");
  }
}

function addMotionPath(group: THREE.Group, path: DigitalTwinMotionPoint[]) {
  if (path.length < 2) return;
  const points = path.map((point) => new THREE.Vector3(...cubosToThree(point.tool)));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#101827" })));
}

function addGantry(group: THREE.Group, twin: DigitalTwinBundle, point: DigitalTwinMotionPoint) {
  const volume = twin.gantry.workingVolume;
  const bridgePos = cubosToThree({ x: (volume.x_min + volume.x_max) / 2, y: point.gantry.y, z: point.gantry.z });
  const carriagePos = cubosToThree(point.gantry);
  const toolPos = cubosToThree(point.tool);

  const bridge = new THREE.Mesh(
    new THREE.BoxGeometry(volume.x_max - volume.x_min, 5, 8),
    new THREE.MeshStandardMaterial({ color: "#3b414d" }),
  );
  bridge.position.set(...bridgePos);
  group.add(bridge);

  const carriage = new THREE.Mesh(
    new THREE.BoxGeometry(24, 18, 18),
    new THREE.MeshStandardMaterial({ color: "#222a35" }),
  );
  carriage.position.set(...carriagePos);
  group.add(carriage);

  addLine(group, carriagePos, toolPos, "#ad2f2f");

  const { center, size } = aabbCenterSize(point.envelope);
  const envelope = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshBasicMaterial({ color: "#d24938", wireframe: true }),
  );
  envelope.position.set(...center);
  group.add(envelope);
}

function addCylinder(group: THREE.Group, point: Coordinate3D, radius: number, height: number, color: string) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 16),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.position.set(...cubosToThree(point));
  group.add(mesh);
}

function addLine(group: THREE.Group, start: [number, number, number], end: [number, number, number], color: string) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...start),
    new THREE.Vector3(...end),
  ]);
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
}

function textSprite(label: string, color: string, position: [number, number, number]) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "700 38px Inter, sans-serif";
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.position.set(...position);
  sprite.scale.set(28, 14, 1);
  return sprite;
}

function aabbCenterSize(aabb: DigitalTwinAabb): { center: [number, number, number]; size: [number, number, number] } {
  return {
    center: cubosToThree(aabb.center),
    size: [aabb.size.x, aabb.size.z, aabb.size.y],
  };
}

function workingVolumeTarget(twin: DigitalTwinBundle) {
  const v = twin.gantry.workingVolume;
  return new THREE.Vector3(...cubosToThree({
    x: (v.x_min + v.x_max) / 2,
    y: (v.y_min + v.y_max) / 2,
    z: (v.z_min + v.z_max) / 2,
  }));
}

function workingVolumeCameraDistance(twin: DigitalTwinBundle) {
  const v = twin.gantry.workingVolume;
  const diagonal = Math.hypot(v.x_max - v.x_min, v.y_max - v.y_min, v.z_max - v.z_min);
  return Math.max(420, diagonal * 1.3);
}

function flattenLabware(items: DigitalTwinLabwareItem[]): DigitalTwinLabwareItem[] {
  return items.flatMap((item) => [item, ...flattenLabware(item.children ?? [])]);
}

function warningKey(warning: DigitalTwinWarning) {
  return `${warning.stepIndex}-${warning.pathIndex}-${warning.object}-${warning.type}`;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    const disposeMaterial = (item: THREE.Material) => {
      const map = (item as THREE.SpriteMaterial).map;
      map?.dispose();
      item.dispose();
    };
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}
