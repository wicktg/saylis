/**
 * The chart's drawing tools.
 *
 * Every entry maps to an overlay template that klinecharts *itself*
 * implements — nothing here is a bespoke re-implementation, so each tool
 * comes with the library's real drawing, dragging, selection and deletion
 * behaviour. The grouping mirrors @klinecharts/pro's own drawing bar, and
 * the icons are lifted verbatim from it (see chartToolIcons.ts).
 *
 * Deliberately limited to overlays present in klinecharts core: pro
 * registers extras (xabcd, waves, gann, the wider fibonacci family) that
 * core does not ship, and exposing buttons for those would produce dead
 * controls.
 */
export type ToolId = "cursor" | string;

export type Tool = {
  /** klinecharts overlay template name — also the icon key. */
  id: string;
  label: string;
};

export type ToolGroup = {
  key: string;
  label: string;
  tools: Tool[];
};

export const TOOL_GROUPS: ToolGroup[] = [
  {
    key: "singleLine",
    label: "Lines",
    tools: [
      { id: "horizontalStraightLine", label: "Horizontal line" },
      { id: "horizontalRayLine", label: "Horizontal ray" },
      { id: "horizontalSegment", label: "Horizontal segment" },
      { id: "verticalStraightLine", label: "Vertical line" },
      { id: "verticalRayLine", label: "Vertical ray" },
      { id: "verticalSegment", label: "Vertical segment" },
      { id: "straightLine", label: "Straight line" },
      { id: "rayLine", label: "Ray" },
      { id: "segment", label: "Trend line" },
      { id: "priceLine", label: "Price line" },
    ],
  },
  {
    key: "moreLine",
    label: "Channels",
    tools: [
      { id: "priceChannelLine", label: "Price channel" },
      { id: "parallelStraightLine", label: "Parallel channel" },
    ],
  },
  {
    key: "fibonacci",
    label: "Fibonacci",
    tools: [{ id: "fibonacciLine", label: "Fibonacci retracement" }],
  },
];

/** Flat lookup of every selectable drawing tool. */
export const ALL_TOOLS: Tool[] = TOOL_GROUPS.flatMap((group) => group.tools);
