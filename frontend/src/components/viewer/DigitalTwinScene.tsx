import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import type { Coordinate3D, DigitalTwinAabb, DigitalTwinBundle, DigitalTwinLabwareItem, DigitalTwinMotionPoint } from "../../types";

interface Props {
  twin: DigitalTwinBundle | null;
  current: DigitalTwinMotionPoint | null;
}

function cubosToThree(point: Coordinate3D): [number, number, number] {
  return [point.x, point.z, -point.y];
}

export default function DigitalTwinScene({ twin, current }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const labware = useMemo(() => flattenLabware(twin?.deck.labware ?? []), [twin]);

  useEffect(() => {
    if (!hostRef.current || !twin || !current) return;

    const host = hostRef.current;
    host.replaceChildren();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
      const message = document.createElement("div");
      message.textContent = `3D renderer unavailable: ${error instanceof Error ? error.message : String(error)}`;
      Object.assign(message.style, emptyStyle);
      host.appendChild(message);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#f4f6f8");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
    camera.position.set(280, 260, 360);
    const target = new THREE.Vector3(150, 35, -145);
    camera.lookAt(target);

    scene.add(new THREE.AmbientLight("#ffffff", 1.7));
    const light = new THREE.DirectionalLight("#ffffff", 1.2);
    light.position.set(200, 350, 150);
    scene.add(light);

    const world = new THREE.Group();
    scene.add(world);
    addVolume(world, twin);
    addAxes(world);
    for (const item of labware) {
      addLabware(world, item);
    }
    addMotionPath(world, twin.motion.path);
    addGantry(world, twin, current);

    const resize = () => {
      const width = host.clientWidth || 640;
      const height = host.clientHeight || 420;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
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
      renderer.render(scene, camera);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.08 : 0.92;
      camera.position.multiplyScalar(factor);
      camera.lookAt(target);
      renderer.render(scene, camera);
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
    return <div style={emptyStyle}>Load gantry and deck configs to view the digital twin.</div>;
  }
  return <div ref={hostRef} style={sceneStyle} aria-label="3D digital twin viewer" />;
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

function aabbCenterSize(aabb: DigitalTwinAabb): { center: [number, number, number]; size: [number, number, number] } {
  return {
    center: cubosToThree(aabb.center),
    size: [aabb.size.x, aabb.size.z, aabb.size.y],
  };
}

function flattenLabware(items: DigitalTwinLabwareItem[]): DigitalTwinLabwareItem[] {
  return items.flatMap((item) => [item, ...flattenLabware(item.children ?? [])]);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

const sceneStyle: CSSProperties = {
  width: "100%",
  height: 420,
  minHeight: 320,
  border: "1px solid #d7dde5",
  borderRadius: 8,
  overflow: "hidden",
  background: "#f4f6f8",
  touchAction: "none",
};

const emptyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  height: 420,
  minHeight: 320,
  border: "1px solid #d7dde5",
  borderRadius: 8,
  background: "#f8f9fa",
  color: "#6b7280",
  fontSize: 13,
};
