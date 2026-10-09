import { z } from "zod";

export const drawingColors = ["#0f172a", "#92400e", "#356859", "#315b96", "#a63256"] as const;
export const MAX_STROKES = 300;
export const MAX_POINTS = 40000;
export const MAX_STROKE_POINTS = 2000;
export const drawingSchema = z.array(z.object({
  tool: z.enum(["pen", "eraser"]),
  color: z.enum(drawingColors),
  width: z.number().finite().min(1).max(20),
  points: z.array(z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })).min(1).max(MAX_STROKE_POINTS),
})).max(MAX_STROKES).refine((strokes) => strokes.reduce((total, stroke) => total + stroke.points.length, 0) <= MAX_POINTS);

export type DrawingStroke = z.infer<typeof drawingSchema>[number];

export function renderDrawing(context: CanvasRenderingContext2D, strokes: DrawingStroke[], width: number, height: number) {
  context.clearRect(0, 0, width, height);
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width * width / 1000;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
      context.arc(first.x * width, first.y * height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x * width, first.y * height);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height);
      context.stroke();
    }
  }
  context.globalCompositeOperation = "source-over";
}
