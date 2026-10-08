import { describe, expect, it } from "vitest";
import { drawingSchema, MAX_POINTS, MAX_STROKES } from "@/lib/morningDrawing";

const stroke = { tool: "pen", color: "#0f172a", width: 4, points: [{ x: 0.1, y: 0.5 }] };
describe("bounded editable drawing data", () => {
  it("accepts empty canvases, pens and erasers", () => {
    expect(drawingSchema.safeParse([]).success).toBe(true);
    expect(drawingSchema.safeParse([stroke, { ...stroke, tool: "eraser", width: 20 }]).success).toBe(true);
  });
  it.each([
    { ...stroke, tool: "image" }, { ...stroke, color: "url(external)" },
    { ...stroke, width: -1 }, { ...stroke, width: 21 }, { ...stroke, points: [] },
    { ...stroke, points: [{ x: 1.1, y: 0 }] }, { ...stroke, points: [{ x: 0, y: -1 }] },
    { ...stroke, points: [{ x: Infinity, y: 0 }] },
  ])("rejects invalid or unbounded strokes %#", (value) => {
    expect(drawingSchema.safeParse([value]).success).toBe(false);
  });
  it("bounds both stroke and total point counts", () => {
    expect(drawingSchema.safeParse(Array(MAX_STROKES + 1).fill(stroke)).success).toBe(false);
    const large = { ...stroke, points: Array(2000).fill({ x: 0.2, y: 0.2 }) };
    expect(drawingSchema.safeParse(Array(MAX_POINTS / 2000 + 1).fill(large)).success).toBe(false);
  });
});
