"use client";

import { Suspense, lazy, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";

const BackgroundScene = lazy(() => import("./background-scene"));

interface SceneCanvasProps {
  theme: "light" | "dark";
  isLoading: boolean;
}

export function SceneCanvas({ theme, isLoading }: SceneCanvasProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-[0]">
      <Canvas
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5], fov: 60 }}
      >
        <Suspense fallback={null}>
          <BackgroundScene theme={theme} isLoading={isLoading} />
        </Suspense>
      </Canvas>
    </div>
  );
}
