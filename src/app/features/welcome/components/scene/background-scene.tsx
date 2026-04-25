import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";

interface BackgroundSceneProps {
  theme: "light" | "dark";
  isLoading: boolean;
}

const STAR_COUNT = 400;

// Circular sprite texture so points render as round dots
function makeCircleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.8)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function StarField({
  isLoading,
  isDark,
  mouse,
}: {
  isLoading: boolean;
  isDark: boolean;
  mouse: React.RefObject<{ x: number; y: number }>;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const speedRef = useRef(1.0);
  // Smoothed mouse velocity applied as lateral drift to all stars
  const smoothMouse = useRef({ x: 0, y: 0 });
  const texture = useMemo(() => makeCircleTexture(), []);

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    const velocities = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40 - 10;
      velocities[i * 3 + 2] = 0.002 + Math.random() * 0.006;
    }
    return { positions, velocities };
  }, []);

  useFrame((_, delta) => {
    speedRef.current = THREE.MathUtils.lerp(
      speedRef.current,
      isLoading ? 5.0 : 1.0,
      delta * 2,
    );

    // Lerp smoothed mouse toward raw mouse — gives inertia feel
    const lerpFactor = 1 - Math.pow(0.01, delta);
    smoothMouse.current.x = THREE.MathUtils.lerp(
      smoothMouse.current.x,
      mouse.current?.x ?? 0,
      lerpFactor,
    );
    smoothMouse.current.y = THREE.MathUtils.lerp(
      smoothMouse.current.y,
      mouse.current?.y ?? 0,
      lerpFactor,
    );

    const geo = pointsRef.current?.geometry;
    if (!geo) return;
    const pos = geo.attributes.position.array as Float32Array;
    const s = speedRef.current;
    // Mouse pushes stars laterally — stronger effect at higher speed
    const mx = smoothMouse.current.x * 0.004 * s;
    const my = smoothMouse.current.y * 0.004 * s;

    for (let i = 0; i < STAR_COUNT; i++) {
      pos[i * 3] += mx;
      pos[i * 3 + 1] += my;
      pos[i * 3 + 2] += velocities[i * 3 + 2] * s * delta * 60;

      // Reset star to far back when it passes the camera
      if (pos[i * 3 + 2] > 6) {
        pos[i * 3] = (Math.random() - 0.5) * 30;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
        pos[i * 3 + 2] = -40;
      }
    }
    geo.attributes.position.needsUpdate = true;
  });

  const starColor = isDark ? "#ccd6ff" : "#334477";

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={starColor}
        size={0.08}
        transparent
        opacity={isDark ? 0.85 : 0.55}
        sizeAttenuation
        map={texture}
        alphaTest={0.01}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function BackgroundScene({
  theme,
  isLoading,
}: BackgroundSceneProps) {
  const isDark = theme === "dark";
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <>
      <PerformanceMonitor>
        <AdaptiveDpr pixelated />
        <StarField isLoading={isLoading} isDark={isDark} mouse={mouse} />
      </PerformanceMonitor>
    </>
  );
}
