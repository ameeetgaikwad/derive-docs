"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";

function hexToRgb(hex: string) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

interface Dot {
  cx: number;
  cy: number;
  xOffset: number;
  yOffset: number;
  vx: number;
  vy: number;
}

interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  returnStiffness?: number;
  returnDamping?: number;
  className?: string;
}

export default function DotGrid({
  dotSize = 16,
  gap = 32,
  baseColor = "#fb923c",
  activeColor = "#fb923c",
  proximity = 150,
  speedTrigger = 100,
  shockRadius = 250,
  shockStrength = 5,
  maxSpeed = 5000,
  returnStiffness = 0.03,
  returnDamping = 0.85,
  className = "",
}: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<Dot[]>([]);
  const pointerRef = useRef({
    x: -9999,
    y: -9999,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  });

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor]);

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    const cell = dotSize + gap;
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;

    const startX = dotSize / 2;
    const startY = dotSize / 2;

    const dots: Dot[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({
          cx: startX + x * cell,
          cy: startY + y * cell,
          xOffset: 0,
          yOffset: 0,
          vx: 0,
          vy: 0,
        });
      }
    }
    dotsRef.current = dots;
  }, [dotSize, gap]);

  // Render loop + spring physics
  useEffect(() => {
    let rafId: number;
    const proxSq = proximity * proximity;
    const r = dotSize / 2;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafId = requestAnimationFrame(draw); return; }
      const { width, height } = canvas.style;
      ctx.clearRect(0, 0, parseFloat(width) || canvas.width, parseFloat(height) || canvas.height);

      const { x: px, y: py } = pointerRef.current;

      for (const dot of dotsRef.current) {
        // Spring physics: pull back to origin
        const ax = -returnStiffness * dot.xOffset;
        const ay = -returnStiffness * dot.yOffset;
        dot.vx = (dot.vx + ax) * returnDamping;
        dot.vy = (dot.vy + ay) * returnDamping;
        dot.xOffset += dot.vx;
        dot.yOffset += dot.vy;

        // Snap to zero when close enough
        if (Math.abs(dot.xOffset) < 0.01 && Math.abs(dot.vx) < 0.01) {
          dot.xOffset = 0;
          dot.vx = 0;
        }
        if (Math.abs(dot.yOffset) < 0.01 && Math.abs(dot.vy) < 0.01) {
          dot.yOffset = 0;
          dot.vy = 0;
        }

        const ox = dot.cx + dot.xOffset;
        const oy = dot.cy + dot.yOffset;
        const dx = dot.cx - px;
        const dy = dot.cy - py;
        const dsq = dx * dx + dy * dy;

        let fillStyle = baseColor;
        if (dsq <= proxSq) {
          const dist = Math.sqrt(dsq);
          const t = 1 - dist / proximity;
          const cr = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t);
          const cg = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t);
          const cb = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t);
          fillStyle = `rgb(${cr},${cg},${cb})`;
        }

        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [proximity, baseColor, activeRgb, baseRgb, dotSize, returnStiffness, returnDamping]);

  // Resize observer
  useEffect(() => {
    buildGrid();
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(buildGrid);
    ro.observe(el);
    return () => ro.disconnect();
  }, [buildGrid]);

  // Pointer events
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      const pr = pointerRef.current;
      const dt = pr.lastTime ? now - pr.lastTime : 16;
      const dx = e.clientX - pr.lastX;
      const dy = e.clientY - pr.lastY;
      let vx = (dx / dt) * 1000;
      let vy = (dy / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        speed = maxSpeed;
      }
      pr.lastTime = now;
      pr.lastX = e.clientX;
      pr.lastY = e.clientY;
      pr.vx = vx;
      pr.vy = vy;
      pr.speed = speed;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      pr.x = e.clientX - rect.left;
      pr.y = e.clientY - rect.top;

      // Push dots away on fast mouse movement
      if (speed > speedTrigger) {
        for (const dot of dotsRef.current) {
          const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y);
          if (dist < proximity) {
            const pushX = (dot.cx - pr.x) * 0.3 + vx * 0.002;
            const pushY = (dot.cy - pr.y) * 0.3 + vy * 0.002;
            dot.vx += pushX * 0.15;
            dot.vy += pushY * 0.15;
          }
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
        if (dist < shockRadius) {
          const falloff = Math.max(0, 1 - dist / shockRadius);
          dot.vx += (dot.cx - cx) * shockStrength * falloff * 0.15;
          dot.vy += (dot.cy - cy) * shockStrength * falloff * 0.15;
        }
      }
    };

    let lastMove = 0;
    const throttledMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastMove >= 16) {
        lastMove = now;
        onMove(e);
      }
    };

    window.addEventListener("mousemove", throttledMove, { passive: true });
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("mousemove", throttledMove);
      window.removeEventListener("click", onClick);
    };
  }, [maxSpeed, speedTrigger, proximity, shockRadius, shockStrength]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={wrapperRef} className="relative h-full w-full">
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  );
}
