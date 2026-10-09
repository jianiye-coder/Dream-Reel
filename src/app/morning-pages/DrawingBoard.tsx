"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eraser, PenLine, Redo2, Trash2, Undo2 } from "lucide-react";
import { drawingColors, MAX_POINTS, MAX_STROKE_POINTS, MAX_STROKES, renderDrawing, type DrawingStroke } from "@/lib/morningDrawing";
import styles from "./page.module.css";
import type { translations } from "@/lib/i18n";

type DrawLabels = (typeof translations)["en"]["morningPages"]["draw"];

export function DrawingBoard({ strokes, onChange, disabled, date, labels: L }: {
  strokes: DrawingStroke[];
  onChange: (strokes: DrawingStroke[]) => void;
  disabled: boolean;
  date: string;
  labels: DrawLabels;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<{ pointer: number; prior: DrawingStroke[]; stroke: DrawingStroke; pointCount: number } | null>(null);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState<DrawingStroke["color"]>(drawingColors[0]);
  const [width, setWidth] = useState(4);
  const [redo, setRedo] = useState<DrawingStroke[][]>([]);
  const [undo, setUndo] = useState<DrawingStroke[][]>([]);
  const [limit, setLimit] = useState(false);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) renderDrawing(context, strokes, 1000, 700);
  }, [strokes]);

  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || active.current || !event.isPrimary || event.button !== 0) return;
    const pointCount = strokes.reduce((count, stroke) => count + stroke.points.length, 0);
    if (strokes.length >= MAX_STROKES || pointCount >= MAX_POINTS) { setLimit(true); return; }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: DrawingStroke = { tool, color, width: tool === "eraser" ? width * 2 : width, points: [position(event)] };
    active.current = { pointer: event.pointerId, prior: strokes, stroke, pointCount };
    setUndo((history) => [...history.slice(-49), strokes]);
    setRedo([]);
    setLimit(false);
    onChange([...strokes, stroke]);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = active.current;
    if (!current || event.pointerId !== current.pointer || disabled) return;
    if (current.stroke.points.length >= MAX_STROKE_POINTS || current.pointCount + current.stroke.points.length >= MAX_POINTS) {
      setLimit(true);
      return;
    }
    const point = position(event);
    const last = current.stroke.points.at(-1)!;
    if (Math.hypot(point.x - last.x, point.y - last.y) < .001) return;
    current.stroke = { ...current.stroke, points: [...current.stroke.points, point] };
    onChange([...current.prior, current.stroke]);
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointer !== event.pointerId) return;
    active.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function undoDrawing() {
    const previous = undo.at(-1);
    if (!previous) return;
    setRedo((history) => [...history, strokes]);
    setUndo((history) => history.slice(0, -1));
    setLimit(false);
    onChange(previous);
  }

  function redoDrawing() {
    const next = redo.at(-1);
    if (!next) return;
    setUndo((history) => [...history, strokes]);
    setRedo((history) => history.slice(0, -1));
    onChange(next);
  }

  function clear() {
    if (!window.confirm(L.clearConfirm)) return;
    setUndo((history) => [...history.slice(-49), strokes]);
    setRedo([]);
    setLimit(false);
    onChange([]);
  }

  function download() {
    const output = document.createElement("canvas");
    output.width = 1600;
    output.height = 1120;
    const context = output.getContext("2d");
    if (!context) return;
    renderDrawing(context, strokes, output.width, output.height);
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    output.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `morning-pages-${date}.png`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  const colors = L.colors;
  return (
    <div className={styles.drawing}>
      <div className={styles.drawTools} role="group" aria-label={L.tools}>
        <button type="button" className={styles.iconButton} title={L.pen} aria-label={L.pen} aria-pressed={tool === "pen"} disabled={disabled} onClick={() => setTool("pen")}><PenLine size={19} aria-hidden /></button>
        <button type="button" className={styles.iconButton} title={L.eraser} aria-label={L.eraser} aria-pressed={tool === "eraser"} disabled={disabled} onClick={() => setTool("eraser")}><Eraser size={19} aria-hidden /></button>
        <div className={styles.swatches} role="group" aria-label={L.color}>{drawingColors.map((value, index) => <button key={value} type="button" className={styles.swatch} title={colors[index]} aria-label={colors[index]} aria-pressed={color === value} disabled={disabled} onClick={() => { setColor(value); setTool("pen"); }}><span style={{ background: value }} /></button>)}</div>
        <label className={styles.brushSize}>{L.size}<input type="range" min="1" max="10" value={width} disabled={disabled} onChange={(e) => setWidth(Number(e.target.value))} /><output>{width}</output></label>
        <div className={styles.drawActions}>
          <button type="button" className={styles.iconButton} title={L.undo} aria-label={L.undo} disabled={disabled || !undo.length} onClick={undoDrawing}><Undo2 size={19} aria-hidden /></button>
          <button type="button" className={styles.iconButton} title={L.redo} aria-label={L.redo} disabled={disabled || !redo.length} onClick={redoDrawing}><Redo2 size={19} aria-hidden /></button>
          <button type="button" className={styles.iconButton} title={L.clear} aria-label={L.clear} disabled={disabled || !strokes.length} onClick={clear}><Trash2 size={19} aria-hidden /></button>
          <button type="button" className={styles.iconButton} title={L.download} aria-label={L.download} disabled={!strokes.length} onClick={download}><Download size={19} aria-hidden /></button>
        </div>
      </div>
      <canvas ref={canvas} width={1000} height={700} className={styles.canvas} aria-label={L.canvas} role="img" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        {L.canvas}
      </canvas>
      {limit && <p className={styles.drawingLimit} role="status">{L.limit}</p>}
    </div>
  );
}
