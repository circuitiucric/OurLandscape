"use client";

import React, { useCallback, useRef } from "react";

/**
 * 可见级别选择器：动作发起者在创建批注/楼层/帖子时选择 0/1/2。
 *   0 — 不出现在他人动态中
 *   1 — 仅在动态中显示关联资源（隐藏正文/批注内容）
 *   2 — 完整展示
 *
 * 交互形式：一条滑动轨道上有三个停泊位置，可点击停泊位或拖拽滑动点切换，
 * 右侧文字实时显示当前所处的可见性等级。
 */

interface Props {
  value: 0 | 1 | 2;
  onChange: (v: 0 | 1 | 2) => void;
  size?: "compact" | "normal";
  label?: string | null;
}

const NAV_COLOR = "#192D10";

const OPTIONS: { v: 0 | 1 | 2; label: string; title: string }[] = [
  { v: 0, label: "不入动态", title: "0 · 不出现在关注者动态中" },
  { v: 1, label: "仅资源", title: "1 · 关注者动态中只显示关联资源，不显示内容" },
  { v: 2, label: "完整", title: "2 · 关注者动态中完整展示" },
];

const VisibilityPicker: React.FC<Props> = ({
  value, onChange, size = "normal", label = "动态可见性",
}) => {
  const compact = size === "compact";
  const trackRef = useRef<HTMLDivElement>(null);

  // 尺寸参数
  const trackWidth = compact ? 78 : 104;
  const knobSize = compact ? 14 : 16;
  const trackHeight = compact ? 4 : 5;
  // 知识点（停泊位）的圆心相对轨道左端的偏移：留出半个滑点的边距
  const pad = knobSize / 2;
  const span = trackWidth - knobSize; // 三个停泊位分布的有效跨度
  const stopX = (i: number) => pad + (span * i) / 2; // i = 0/1/2

  const current = OPTIONS.find(o => o.v === value) ?? OPTIONS[0];

  // 依据指针 X 坐标吸附到最近的停泊位
  const snapFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (x - pad) / span));
    const nearest = Math.round(ratio * 2) as 0 | 1 | 2;
    onChange(nearest);
  }, [onChange, pad, span]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    snapFromClientX(e.clientX);
    const onMove = (ev: MouseEvent) => snapFromClientX(ev.clientX);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - 1) as 0 | 1 | 2);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(2, value + 1) as 0 | 1 | 2);
    }
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: compact ? 6 : 8,
      fontSize: compact ? 10 : 11, color: "#666",
    }}>
      {label && <span style={{ flexShrink: 0 }}>{label}：</span>}

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={value}
        aria-valuetext={current.label}
        title={current.title}
        onMouseDown={startDrag}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          width: trackWidth,
          height: knobSize,
          flexShrink: 0,
          cursor: "pointer",
          outline: "none",
        }}
      >
        {/* 轨道底线 */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: pad,
          width: span,
          height: trackHeight,
          transform: "translateY(-50%)",
          background: "#e2e5e0",
          borderRadius: trackHeight,
        }} />
        {/* 已选高亮段 */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: pad,
          width: (span * value) / 2,
          height: trackHeight,
          transform: "translateY(-50%)",
          background: NAV_COLOR,
          borderRadius: trackHeight,
        }} />
        {/* 停泊位刻点 */}
        {OPTIONS.map((opt) => (
          <div
            key={opt.v}
            onMouseDown={(e) => { e.stopPropagation(); onChange(opt.v); }}
            title={opt.title}
            style={{
              position: "absolute",
              top: "50%",
              left: stopX(opt.v),
              width: trackHeight + 2,
              height: trackHeight + 2,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background: opt.v <= value ? NAV_COLOR : "#cbd0c6",
              cursor: "pointer",
            }}
          />
        ))}
        {/* 滑动点 */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: stopX(value),
          width: knobSize,
          height: knobSize,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: "#fff",
          border: `2px solid ${NAV_COLOR}`,
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          transition: "left 0.12s ease",
        }} />
      </div>

      {/* 右侧当前等级文字 */}
      <span style={{
        flexShrink: 0,
        minWidth: compact ? 40 : 48,
        color: NAV_COLOR,
        fontWeight: 500,
      }}>{current.label}</span>
    </div>
  );
};

export default VisibilityPicker;
