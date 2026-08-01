"use client";

import { useRef, useState } from "react";
import { CHART_ICON_VIEWBOX, CHART_TOOL_ICONS } from "@/app/_lib/chartToolIcons";
import { TOOL_GROUPS, type ToolId } from "@/app/_lib/drawings";
import { useOutsideClick } from "@/app/_lib/useOutsideClick";

/**
 * Vertical drawing toolbar, laid out the way @klinecharts/pro's own
 * drawing bar is: one button per tool family showing the family's
 * currently-picked tool, with a flyout to switch between the variants.
 * Keeps fifteen real tools reachable without a fifteen-button rail.
 */
export default function ChartToolbar({
  activeTool,
  onSelectTool,
  onClear,
}: {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onClear: () => void;
}) {
  // Last tool picked from each group, so the rail button keeps showing it.
  const [groupSelection, setGroupSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(TOOL_GROUPS.map((group) => [group.key, group.tools[0].id]))
  );
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useOutsideClick(barRef, () => setOpenGroup(null));

  return (
    <div
      ref={barRef}
      className="w-10 shrink-0 border-r border-white/10 flex flex-col items-center py-2 gap-1 relative"
    >
      <ToolButton
        icon="cursor"
        label="Cursor"
        isActive={activeTool === "cursor"}
        onClick={() => {
          onSelectTool("cursor");
          setOpenGroup(null);
        }}
      />

      <div className="w-6 border-t border-white/10 my-1" />

      {TOOL_GROUPS.map((group) => {
        const selected = groupSelection[group.key];
        const isActive = group.tools.some((tool) => tool.id === activeTool);
        return (
          <div key={group.key} className="relative">
            <ToolButton
              icon={selected}
              label={group.label}
              isActive={isActive}
              hasFlyout={group.tools.length > 1}
              onClick={() => {
                onSelectTool(selected);
                setOpenGroup((prev) => (prev === group.key ? null : group.key));
              }}
            />

            {openGroup === group.key && group.tools.length > 1 && (
              <div className="pixel-frame pixel-panel absolute left-full top-0 ml-2 z-30 p-1 grid grid-cols-2 gap-0.5 w-[92px]">
                {group.tools.map((tool) => (
                  <button
                    key={tool.id}
                    title={tool.label}
                    aria-label={tool.label}
                    onClick={() => {
                      setGroupSelection((prev) => ({ ...prev, [group.key]: tool.id }));
                      onSelectTool(tool.id);
                      setOpenGroup(null);
                    }}
                    className={`w-10 h-10 flex items-center justify-center transition-colors ${
                      activeTool === tool.id
                        ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                        : "text-white/50 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    <ToolIcon name={tool.id} />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="w-6 border-t border-white/10 my-1" />

      <ToolButton
        icon="remove"
        label="Clear all drawings"
        isActive={false}
        onClick={() => {
          onClear();
          setOpenGroup(null);
        }}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  isActive,
  hasFlyout,
  onClick,
}: {
  icon: string;
  label: string;
  isActive: boolean;
  hasFlyout?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      className={`w-8 h-8 flex items-center justify-center transition-colors relative ${
        isActive
          ? "bg-[var(--accent-tint)] text-[var(--accent)]"
          : "text-white/45 hover:text-white hover:bg-white/5"
      }`}
    >
      <ToolIcon name={icon} />
      {hasFlyout && (
        <span className="absolute right-0.5 bottom-0.5 w-0 h-0 border-l-[3px] border-l-transparent border-b-[3px] border-b-current opacity-60" />
      )}
    </button>
  );
}

/** Renders a klinecharts icon, or a cursor arrow for the default mode. */
function ToolIcon({ name }: { name: string }) {
  if (name === "cursor") {
    return (
      <svg viewBox="0 0 22 22" className="w-[22px] h-[22px]" fill="currentColor">
        <path d="M7 4l9.5 6.6-4.1.5 2.4 4.7-1.9 1-2.4-4.7-2.6 3.1z" />
      </svg>
    );
  }

  const markup = CHART_TOOL_ICONS[name];
  if (!markup) return null;

  return (
    <svg
      viewBox={CHART_ICON_VIEWBOX}
      className="w-[22px] h-[22px]"
      fill="currentColor"
      stroke="currentColor"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
