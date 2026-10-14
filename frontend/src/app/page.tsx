"use client";

import React, {
  useEffect, useState, useMemo, useRef, useCallback,
} from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import TopNav from "./components/TopNav";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recommendation {
  rec_id: number;
  user_name: string;
  primary_tag: string;
  custom_name: string | null;
  evaluation: string | null;
  created_at?: string;
}
interface TagData { tag: string; vote_score: number; }
interface NotebookConnection { board_id: number; board_title: string; user_name: string; }
interface ResourceCard {
  id: number;
  type: "pdf" | "video" | "post" | "notebook" | "external_link";
  identifier: string;
  title: string;
  cover_path: string | null;
  viewer_count: number;
  comment_count: number;
  recommendations: Recommendation[];
  tags: TagData[];
  notebook_connections: NotebookConnection[];
}
type PopoverType = "viewers" | "connections" | "evaluations" | "tags";
interface PopoverState {
  type: PopoverType;
  resourceId: number;
  x: number; y: number;
  data: string[] | NotebookConnection[] | Recommendation[] | TagData[] | null;
  loading: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "全部", "科学·大类", "计算机与软件使用", "家务与健康",
  "行政与社会生活", "哲学、社会学与心理", "文学与美学",
];
// Sections rendered top-to-bottom in the content area (excludes the "全部" pseudo-category)
const DISPLAY_CATEGORIES = CATEGORIES.slice(1);

// How many resources each section shows before "加载更多"
const INITIAL_LIMIT = 12;
const LOAD_MORE_STEP = 12;

// Left sidebar geometry for the sticky/packed scroll-spy effect
const SIDEBAR_W = 150;     // reduced by 1/4 from the original 200
const SIDEBAR_INSET = 22;  // horizontal padding / divider inset (~2 Chinese chars)
const LABEL_H = 36;        // vertical slot reserved per category label

// Shelf dimensions (matching Figma SVG proportions)
const BLOCK_H = 158;  // height above the shelf line
const TITLE_H = 31;   // height of label below shelf line
const ITEM_H  = BLOCK_H + TITLE_H; // = 189

// Width by type
const TYPE_W: Record<string, number> = {
  pdf: 166, video: 210, external_link: 190, notebook: 198, post: 180,
};

const NAV_COLOR = "#192D10";
const SIDEBAR_BG = "#6B8365";   // left sidebar background
const CONTENT_BG = "#fffef7";   // right content background (also used as sidebar label text color)
const SHELF_LINE_COLOR = "#757D73";

// ── Indicator icon (compact, inside block) ────────────────────────────────────

const Indicator: React.FC<{
  icon: string; count: number; title: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}> = ({ icon, count, title, onMouseEnter, onMouseLeave }) => (
  <button
    title={title}
    style={{
      display: "flex", flexDirection: "row", alignItems: "center",
      gap: 3, background: "none", border: "none",
      cursor: onMouseEnter ? "pointer" : "default",
      padding: "2px 3px", opacity: 0.55,
      transition: "opacity 0.13s",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLButtonElement).style.opacity = "1";
      onMouseEnter?.(e);
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLButtonElement).style.opacity = "0.55";
      onMouseLeave?.();
    }}
    onClick={(e) => e.stopPropagation()}
  >
    <img src={icon} alt={title} style={{ width: 14, height: 14, objectFit: "contain" }} />
    <span style={{ fontSize: 9, color: "#888", lineHeight: 1 }}>{count}</span>
  </button>
);

// ── Shared indicator column (right side of each block) ────────────────────────

const IndicatorCol: React.FC<{
  resource: ResourceCard;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => (
  <div style={{
    width: 44, flexShrink: 0, height: "100%",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "flex-end",
    paddingBottom: 0, gap: 2,
  }}>
    <Indicator icon="/MainPage-style/view.png" count={resource.viewer_count} title="看过"
      onMouseEnter={(e) => onViewersHover(e, resource.id)} onMouseLeave={onLeave} />
    <Indicator icon="/MainPage-style/comment.png" count={resource.comment_count} title="评价"
      onMouseEnter={(e) => onEvaluationsHover(e, resource)} onMouseLeave={onLeave} />
    <Indicator icon="/MainPage-style/mark.png" count={resource.tags.length} title="标签"
      onMouseEnter={(e) => onTagsHover(e, resource)} onMouseLeave={onLeave} />
    <Indicator icon="/MainPage-style/relation.png" count={resource.notebook_connections.length} title="收录于笔记板"
      onMouseEnter={(e) => onConnectionsHover(e, resource)} onMouseLeave={onLeave} />
  </div>
);

// ── PDF shelf item ────────────────────────────────────────────────────────────

const PdfItem: React.FC<{
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onNavigate, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => {
  const [hovered, setHovered] = useState(false);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  const coverUrl = resource.cover_path ? `http://localhost:3001${resource.cover_path}` : null;
  const bookW = TYPE_W.pdf - 44 - 2; // minus indicator col and gap
  const spineW = 9;
  const coverAreaW = bookW - spineW;
  // derive height from cover's natural aspect ratio; cap at shelf headroom
  const bookH = coverAspect !== null
    ? Math.min(BLOCK_H - 10, Math.round(coverAreaW * coverAspect))
    : 118;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: TYPE_W.pdf, height: ITEM_H, display: "flex", flexDirection: "column",
        cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      {/* Block area above shelf line */}
      <div style={{
        height: BLOCK_H, position: "relative",
        display: "flex", alignItems: "flex-end",
        paddingBottom: 10,
        filter: hovered ? "brightness(1.06)" : "none",
        transition: "filter 0.15s",
      }}>
        {/* Book body: spine + cover */}
        <div style={{
          width: bookW, height: bookH,
          display: "flex", flexShrink: 0,
          boxShadow: hovered ? "2px 4px 14px rgba(0,0,0,0.28)" : "1px 2px 8px rgba(0,0,0,0.16)",
          transition: "box-shadow 0.15s, transform 0.15s",
          transform: hovered ? "translateY(-3px)" : "none",
        }}>
          {/* Spine */}
          <div style={{
            width: 9, flexShrink: 0, height: "100%",
            background: "linear-gradient(to right, #6b6b64 0%, #bbb8b0 60%, #9a9890 100%)",
          }} />
          {/* Cover */}
          <div style={{
            flex: 1, height: "100%", overflow: "hidden",
            background: coverUrl ? "transparent" : "#d8d5cc",
          }}>
            {coverUrl ? (
              <img src={coverUrl} alt="封面"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0) {
                    setCoverAspect(img.naturalHeight / img.naturalWidth);
                  }
                }}
                style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }} />
            ) : (
              <div style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="22" height="28" viewBox="0 0 22 28" fill="none" stroke="#aaa8a0" strokeWidth="1">
                  <rect x="1" y="1" width="20" height="26" rx="1"/>
                  <line x1="4" y1="7" x2="18" y2="7"/>
                  <line x1="4" y1="11" x2="18" y2="11"/>
                  <line x1="4" y1="15" x2="13" y2="15"/>
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Indicators */}
        <IndicatorCol resource={resource}
          onViewersHover={onViewersHover} onEvaluationsHover={onEvaluationsHover}
          onTagsHover={onTagsHover} onConnectionsHover={onConnectionsHover} onLeave={onLeave} />
      </div>

      {/* Title below shelf line */}
      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 2,
        fontSize: 11, color: hovered ? "#192D10" : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {resource.title || resource.identifier}
      </div>
    </div>
  );
};

// ── Video shelf item ──────────────────────────────────────────────────────────

const VideoItem: React.FC<{
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onNavigate, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => {
  const [hovered, setHovered] = useState(false);
  const coverUrl = resource.cover_path ? `http://localhost:3001${resource.cover_path}` : null;
  const frameW = TYPE_W.video - 44 - 2;
  const frameH = Math.round((frameW * 9) / 16);

  return (
    <div
      role="button" tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: TYPE_W.video, height: ITEM_H, display: "flex", flexDirection: "column",
        cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      <div style={{ height: BLOCK_H, position: "relative", display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
        {/* Video frame: cover + play overlay */}
        <div style={{
          width: frameW, height: frameH, flexShrink: 0, position: "relative",
          background: coverUrl ? "#000" : "#1a1a2e",
          borderRadius: 4, overflow: "hidden",
          boxShadow: hovered ? "2px 4px 14px rgba(0,0,0,0.28)" : "1px 2px 8px rgba(0,0,0,0.16)",
          transition: "box-shadow 0.15s, transform 0.15s",
          transform: hovered ? "translateY(-3px)" : "none",
        }}>
          {coverUrl && (
            <img src={coverUrl} alt="封面"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: hovered ? 1 : 0.92 }} />
          )}
          {/* Play badge */}
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: "50%",
              background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s", ...(hovered ? { background: "rgba(23,55,8,0.85)" } : {}),
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><polygon points="6 4 20 12 6 20 6 4" /></svg>
            </div>
          </div>
        </div>

        {/* Indicators */}
        <IndicatorCol resource={resource}
          onViewersHover={onViewersHover} onEvaluationsHover={onEvaluationsHover}
          onTagsHover={onTagsHover} onConnectionsHover={onConnectionsHover} onLeave={onLeave} />
      </div>

      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 2,
        fontSize: 11, color: hovered ? "#192D10" : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {resource.title || resource.identifier}
      </div>
    </div>
  );
};

// ── Link shelf item ───────────────────────────────────────────────────────────

const LinkItem: React.FC<{
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onNavigate, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => {
  const [hovered, setHovered] = useState(false);
  const bestName = resource.recommendations.find((r) => r.custom_name)?.custom_name ?? resource.title ?? resource.identifier;

  // Split URL into two lines: scheme+host / path
  let urlLine1 = resource.identifier;
  let urlLine2 = "";
  try {
    const u = new URL(resource.identifier);
    urlLine1 = u.protocol + "//" + u.host;
    urlLine2 = u.pathname + u.search + u.hash;
    if (urlLine2 === "/") urlLine2 = "";
  } catch { /* not a valid URL, show as-is */ }

  return (
    <div
      role="button" tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: TYPE_W.external_link, height: ITEM_H, display: "flex",
        flexDirection: "column", cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      {/* Block area: transparent, no border, no shadow */}
      <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>

          {/* Row: page.png + URL in 2 lines */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
            <img src="/MainPage-style/page.png" alt="网页"
              style={{
                width: 26, height: 26, objectFit: "contain", flexShrink: 0,
                opacity: hovered ? 1 : 0.75, transition: "opacity 0.13s",
                marginTop: 1,
              }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, color: "#555",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                lineHeight: 1.5,
              }}>
                {urlLine1}
              </div>
              {urlLine2 && (
                <div style={{
                  fontSize: 11, color: "#999",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  lineHeight: 1.5,
                }}>
                  {urlLine2}
                </div>
              )}
            </div>
          </div>

          {/* Indicators row: icon + count side by side, 4 in a row */}
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { icon: "/MainPage-style/view.png",     count: resource.viewer_count,             title: "看过",        onEnter: (e: React.MouseEvent) => onViewersHover(e, resource.id) },
              { icon: "/MainPage-style/comment.png",  count: resource.comment_count,            title: "评价",        onEnter: (e: React.MouseEvent) => onEvaluationsHover(e, resource) },
              { icon: "/MainPage-style/mark.png",     count: resource.tags.length,              title: "标签",        onEnter: (e: React.MouseEvent) => onTagsHover(e, resource) },
              { icon: "/MainPage-style/relation.png", count: resource.notebook_connections.length, title: "收录于笔记板", onEnter: (e: React.MouseEvent) => onConnectionsHover(e, resource) },
            ].map(({ icon, count, title, onEnter }) => (
              <button key={title} title={title}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  background: "none", border: "none", cursor: "pointer",
                  padding: 0, opacity: hovered ? 0.85 : 0.5,
                  transition: "opacity 0.13s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; onEnter(e); }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = hovered ? "0.85" : "0.5"; onLeave(); }}
                onClick={(ev) => ev.stopPropagation()}
              >
                <img src={icon} alt={title} style={{ width: 13, height: 13, objectFit: "contain" }} />
                <span style={{ fontSize: 10, color: "#888", lineHeight: 1 }}>{count}</span>
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Name below shelf line */}
      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 0,
        fontSize: 11, color: hovered ? "#192D10" : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {bestName}
      </div>
    </div>
  );
};

// ── Notebook shelf item ───────────────────────────────────────────────────────

const NotebookItem: React.FC<{
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onNavigate, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => {
  const [hovered, setHovered] = useState(false);
  const nbW = TYPE_W.notebook - 44 - 6;
  const nbH = 92;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: TYPE_W.notebook, height: ITEM_H, display: "flex",
        flexDirection: "column", cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
        {/* Notebook visual */}
        <div style={{
          width: nbW, height: nbH, flexShrink: 0,
          display: "flex", overflow: "hidden",
          boxShadow: hovered ? "2px 4px 14px rgba(0,0,0,0.18)" : "1px 2px 6px rgba(0,0,0,0.10)",
          transition: "box-shadow 0.15s, transform 0.15s",
          transform: hovered ? "translateY(-2px)" : "none",
          borderRadius: "0 3px 3px 0",
        }}>
          {/* Notebook spine */}
          <div style={{
            width: 10, flexShrink: 0, height: "100%",
            background: "linear-gradient(to right, #b5a84a 0%, #f0dc6e 60%, #c9b850 100%)",
          }} />
          {/* Notebook body */}
          <div style={{
            flex: 1, height: "100%",
            background: "#f9f2d0",
            borderLeft: "1px solid #ddd098",
            display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center", gap: 4, padding: "0 8px",
          }}>
            <img src="/Topframe_style/笔记板页面.png" alt="笔记板"
              style={{ width: 22, height: 22, objectFit: "contain", opacity: 0.5 }} />
            <div style={{ width: "80%", height: 1, background: "#ddd098" }} />
            <div style={{ width: "60%", height: 1, background: "#ddd098" }} />
          </div>
        </div>

        {/* Indicators */}
        <IndicatorCol resource={resource}
          onViewersHover={onViewersHover} onEvaluationsHover={onEvaluationsHover}
          onTagsHover={onTagsHover} onConnectionsHover={onConnectionsHover} onLeave={onLeave} />
      </div>

      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 2,
        fontSize: 11, color: hovered ? "#192D10" : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {resource.title || "未命名笔记板"}
      </div>
    </div>
  );
};

// ── Post shelf item ───────────────────────────────────────────────────────────

const PostItem: React.FC<{
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}> = ({ resource, onNavigate, onViewersHover, onEvaluationsHover, onTagsHover, onConnectionsHover, onLeave }) => {
  const [hovered, setHovered] = useState(false);
  const cardW = TYPE_W.post - 44 - 6;
  const cardH = 72;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: TYPE_W.post, height: ITEM_H, display: "flex",
        flexDirection: "column", cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
        {/* Post card visual */}
        <div style={{
          width: cardW, height: cardH, flexShrink: 0,
          border: `1px solid ${hovered ? "rgba(23,55,8,0.22)" : "rgba(0,0,0,0.10)"}`,
          borderRadius: 5, background: "rgba(255,255,255,0.8)",
          padding: "8px 10px",
          boxShadow: hovered ? "1px 3px 10px rgba(0,0,0,0.10)" : "0 1px 4px rgba(0,0,0,0.06)",
          transition: "border-color 0.13s, box-shadow 0.13s",
          transform: hovered ? "translateY(-2px)" : "none",
          overflow: "hidden",
          display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 4,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#1a1a1a",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          } as React.CSSProperties}>
            {resource.title || "未命名帖子"}
          </div>
          <div style={{ fontSize: 9, color: "#ccc", marginTop: "auto" }}>帖子</div>
        </div>

        {/* Indicators */}
        <IndicatorCol resource={resource}
          onViewersHover={onViewersHover} onEvaluationsHover={onEvaluationsHover}
          onTagsHover={onTagsHover} onConnectionsHover={onConnectionsHover} onLeave={onLeave} />
      </div>

      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 2,
        fontSize: 11, color: hovered ? "#192D10" : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {resource.title || "未命名帖子"}
      </div>
    </div>
  );
};

// ── Item dispatcher ───────────────────────────────────────────────────────────

interface ItemProps {
  resource: ResourceCard;
  onNavigate: () => void;
  onViewersHover: (e: React.MouseEvent, id: number) => void;
  onConnectionsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onEvaluationsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onTagsHover: (e: React.MouseEvent, r: ResourceCard) => void;
  onLeave: () => void;
}

const ShelfItem: React.FC<ItemProps> = (props) => {
  const p = { ...props, resource: props.resource };
  switch (props.resource.type) {
    case "pdf":           return <PdfItem      {...p} />;
    case "video":         return <VideoItem    {...p} />;
    case "notebook":      return <NotebookItem {...p} />;
    case "post":          return <PostItem     {...p} />;
    default:              return <LinkItem     {...p} />;
  }
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

const SkeletonItem = () => (
  <div style={{ width: 158, height: ITEM_H, flexShrink: 0 }}>
    <div style={{
      height: BLOCK_H, display: "flex", alignItems: "flex-end",
    }}>
      <div style={{
        width: 118, height: 110, flexShrink: 0,
        background: "linear-gradient(90deg, #eee 25%, #e0e0e0 50%, #eee 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s infinite",
        borderRadius: 2,
      }} />
    </div>
    <div style={{ height: TITLE_H, paddingTop: 6 }}>
      <div style={{ height: 10, width: "70%", borderRadius: 3, background: "#eee" }} />
    </div>
    <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DiscoveryPage() {
  const router = useRouter();
  const [allResources, setAllResources] = useState<ResourceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-section visible count ("加载更多" increases these)
  const [limits, setLimits] = useState<Record<string, number>>(
    () => Object.fromEntries(DISPLAY_CATEGORIES.map((c) => [c, INITIAL_LIMIT]))
  );

  // Scroll-spy state for the dynamic sidebar
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [sectionTops, setSectionTops] = useState<Record<string, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    axios.get("http://localhost:3001/api/resources/discover")
      .then((r) => setAllResources(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [router]);

  // Group resources by category (a resource can appear under each tag it carries)
  const resourcesByCategory = useMemo(() => {
    const map: Record<string, ResourceCard[]> = {};
    DISPLAY_CATEGORIES.forEach((cat) => {
      map[cat] = allResources.filter((r) =>
        r.recommendations.some((rec) => rec.primary_tag === cat)
      );
    });
    return map;
  }, [allResources]);

  // Measure each section's offset within the scroll container + the viewport height
  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const tops: Record<string, number> = {};
    DISPLAY_CATEGORIES.forEach((cat) => {
      const s = sectionRefs.current[cat];
      if (s) tops[cat] = s.offsetTop;
    });
    setSectionTops(tops);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, allResources, limits, loading]);

  // Compute packed label positions. Each label's divider sits exactly at its
  // section's top (sectionTop - scrollTop), so it lines up with the right-side
  // section divider; labels then pack against the top/bottom once scrolled away.
  const labelTops = useMemo(() => {
    const ideal = DISPLAY_CATEGORIES.map(
      (cat) => (sectionTops[cat] ?? 0) - scrollTop
    );
    const tops = [...ideal];
    // forward pass: stack down from the top
    let topStack = 0;
    for (let i = 0; i < tops.length; i++) {
      tops[i] = Math.max(tops[i], topStack);
      topStack = tops[i] + LABEL_H;
    }
    // backward pass: stack up from the bottom
    let bottomStack = Math.max(viewportH - LABEL_H, 0);
    for (let i = tops.length - 1; i >= 0; i--) {
      tops[i] = Math.min(tops[i], bottomStack);
      bottomStack = tops[i] - LABEL_H;
    }
    return tops;
  }, [sectionTops, scrollTop, viewportH]);

  const scrollToCategory = useCallback((cat: string) => {
    const el = contentRef.current;
    const top = sectionTops[cat];
    if (el && top != null) el.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
  }, [sectionTops]);

  const loadMore = useCallback((cat: string) => {
    setLimits((prev) => ({ ...prev, [cat]: (prev[cat] ?? INITIAL_LIMIT) + LOAD_MORE_STEP }));
  }, []);

  const navigateToResource = useCallback((resource: ResourceCard) => {
    switch (resource.type) {
      case "pdf":
        window.open(`/pdf-viewer?file=${encodeURIComponent(resource.identifier)}`, "_blank"); break;
      case "video":
        window.open(`/video-viewer?file=${encodeURIComponent(resource.identifier)}`, "_blank"); break;
      case "post":
        router.push(`/threads/${resource.identifier}`); break;
      case "external_link":
        window.open(resource.identifier, "_blank", "noopener,noreferrer"); break;
      case "notebook":
        router.push(`/noteboard/${resource.id}`); break;
    }
  }, [router]);

  const clearPopover = useCallback(() => {
    popoverTimer.current = setTimeout(() => setPopover(null), 220);
  }, []);

  const handleViewersHover = useCallback(async (e: React.MouseEvent, resourceId: number) => {
    if (popoverTimer.current) clearTimeout(popoverTimer.current);
    const x = e.clientX, y = e.clientY;
    setPopover({ type: "viewers", resourceId, x, y, data: null, loading: true });
    try {
      const r = await axios.get(`http://localhost:3001/api/resources/${resourceId}/viewers`);
      setPopover((prev) => prev?.resourceId === resourceId
        ? { ...prev, data: r.data as string[], loading: false } : prev);
    } catch {
      setPopover((prev) => prev?.resourceId === resourceId ? { ...prev, data: [], loading: false } : prev);
    }
  }, []);

  const handleConnectionsHover = useCallback((e: React.MouseEvent, resource: ResourceCard) => {
    if (popoverTimer.current) clearTimeout(popoverTimer.current);
    setPopover({ type: "connections", resourceId: resource.id, x: e.clientX, y: e.clientY,
      data: resource.notebook_connections, loading: false });
  }, []);

  const handleEvaluationsHover = useCallback((e: React.MouseEvent, resource: ResourceCard) => {
    if (popoverTimer.current) clearTimeout(popoverTimer.current);
    setPopover({ type: "evaluations", resourceId: resource.id, x: e.clientX, y: e.clientY,
      data: resource.recommendations.filter((r) => r.evaluation), loading: false });
  }, []);

  const handleTagsHover = useCallback((e: React.MouseEvent, resource: ResourceCard) => {
    if (popoverTimer.current) clearTimeout(popoverTimer.current);
    setPopover({ type: "tags", resourceId: resource.id, x: e.clientX, y: e.clientY,
      data: resource.tags, loading: false });
  }, []);

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: CONTENT_BG,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#1a1a1a",
    }}>
      <TopNav />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", marginTop: 78 }}>

        {/* ── Left Sidebar (labels track their section, then pack at top/bottom) ── */}
        <div style={{
          width: SIDEBAR_W, flexShrink: 0, position: "relative", overflow: "hidden",
          background: SIDEBAR_BG,
        }}>
          {DISPLAY_CATEGORIES.map((cat, i) => (
            <button key={cat} onClick={() => scrollToCategory(cat)}
              style={{
                position: "absolute", top: labelTops[i], left: 0,
                boxSizing: "border-box",
                display: "flex", alignItems: "center", width: "100%",
                height: LABEL_H, padding: `0 ${SIDEBAR_INSET}px`,
                background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left",
                color: CONTENT_BG,
                fontSize: 12, fontFamily: "inherit",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                transition: "top 0.18s cubic-bezier(.25,.8,.35,1), background 0.13s",
                lineHeight: 1.4,
              } as React.CSSProperties}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {/* Divider belongs to the boundary above each section; skip it on the first
                  one so lines only appear between/below categories, inset from both edges. */}
              {i > 0 && (
                <span style={{
                  position: "absolute", top: 0, left: SIDEBAR_INSET, right: SIDEBAR_INSET,
                  height: 1, background: "rgba(255,254,247,0.3)",
                }} />
              )}
              {cat}
            </button>
          ))}
        </div>

        {/* ── Main Content: all sections stacked, single continuous scroll ── */}
        <div
          ref={contentRef}
          onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
          style={{ flex: 1, position: "relative", overflowY: "auto", padding: "24px 28px 60px" }}
        >
          {loading && (
            <div style={{
              display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0 6px", rowGap: 0,
              backgroundImage: `linear-gradient(transparent ${BLOCK_H - 1}px, ${SHELF_LINE_COLOR} ${BLOCK_H - 1}px, ${SHELF_LINE_COLOR} ${BLOCK_H}px, transparent ${BLOCK_H}px)`,
              backgroundSize: `100% ${ITEM_H}px`, backgroundRepeat: "repeat-y",
            }}>
              {Array.from({ length: 8 }).map((_, i) => <SkeletonItem key={i} />)}
            </div>
          )}

          {!loading && DISPLAY_CATEGORIES.map((cat, i) => {
            const items = resourcesByCategory[cat] ?? [];
            const limit = limits[cat] ?? INITIAL_LIMIT;
            const visible = items.slice(0, limit);
            const hasMore = items.length > limit;
            return (
              <section
                key={cat}
                ref={(el) => { sectionRefs.current[cat] = el; }}
                style={{
                  // top divider aligns with the matching left-sidebar label divider
                  // (skipped on the first section so lines only appear between sections)
                  borderTop: i > 0 ? `1px solid ${SHELF_LINE_COLOR}` : "none",
                  paddingTop: i > 0 && items.length > 0 ? 16 : 0,
                  marginBottom: items.length === 0 ? 0 : 24,
                }}
              >
                {items.length === 0 ? (
                  // Empty section: kept at LABEL_H tall so the packed sidebar labels
                  // stay aligned with these dividers (and still reads compact).
                  <div style={{
                    height: LABEL_H, display: "flex", alignItems: "center",
                    fontSize: 11, color: "#bbb",
                  }}>该分区暂无推荐资源</div>
                ) : (
                  <>
                    <div style={{
                      display: "flex", flexWrap: "wrap", alignItems: "flex-start",
                      gap: "0 6px", rowGap: 0,
                    }}>
                      {visible.map((resource) => (
                        // wrapper carries a shelf line spanning only this item's width,
                        // so a row's line is exactly as long as the resources it holds
                        <div key={resource.id} style={{ position: "relative", flexShrink: 0 }}>
                          <span style={{
                            position: "absolute", top: BLOCK_H - 1, left: 0, right: 0,
                            height: 1, background: SHELF_LINE_COLOR,
                          }} />
                          <ShelfItem
                            resource={resource}
                            onNavigate={() => navigateToResource(resource)}
                            onViewersHover={handleViewersHover}
                            onConnectionsHover={handleConnectionsHover}
                            onEvaluationsHover={handleEvaluationsHover}
                            onTagsHover={handleTagsHover}
                            onLeave={clearPopover}
                          />
                        </div>
                      ))}
                    </div>

                    {hasMore && (
                      <button
                        onClick={() => loadMore(cat)}
                        style={{
                          marginTop: 12, padding: "7px 18px", fontSize: 12, fontFamily: "inherit",
                          color: NAV_COLOR, background: "transparent",
                          border: "1px solid rgba(23,55,8,0.2)", borderRadius: 18, cursor: "pointer",
                          transition: "background 0.13s",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(23,55,8,0.06)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        加载更多 · 还有 {items.length - limit} 个
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* ── Popover ── */}
      {popover && (
        <div style={{
          position: "fixed",
          left: Math.min(popover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
          top: Math.max(popover.y - 8, 8),
          zIndex: 9999,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          padding: "10px 14px",
          minWidth: popover.type === "evaluations" ? 240 : 170,
          maxWidth: popover.type === "evaluations" ? 300 : 240,
          fontFamily: "inherit",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            {popover.type === "viewers" ? "看过此资源" : popover.type === "tags" ? "标签" : popover.type === "connections" ? "收录于笔记板" : "评价"}
          </div>

          {popover.type === "viewers" && (
            popover.loading ? <div style={{ fontSize: 12, color: "#ddd" }}>加载中…</div>
            : !(popover.data as string[])?.length ? <div style={{ fontSize: 12, color: "#ddd" }}>暂无记录</div>
            : (popover.data as string[]).slice(0, 8).map((n, i) => (
              <div key={i} style={{ fontSize: 12, color: "#333", padding: "2px 0" }}>{n}</div>
            ))
          )}

          {popover.type === "tags" && (
            !(popover.data as TagData[])?.length ? <div style={{ fontSize: 12, color: "#ddd" }}>暂无标签</div>
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(popover.data as TagData[]).map((t, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 9,
                    background: t.vote_score > 0 ? "rgba(23,55,8,0.08)" : "rgba(0,0,0,0.04)",
                    color: t.vote_score > 0 ? NAV_COLOR : "#aaa",
                  }}>{t.tag}</span>
                ))}
              </div>
            )
          )}

          {popover.type === "connections" && (
            !(popover.data as NotebookConnection[])?.length ? <div style={{ fontSize: 12, color: "#ddd" }}>暂无记录</div>
            : (popover.data as NotebookConnection[]).map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: "#333", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: "#aaa" }}>{c.user_name}</span>{" · "}{c.board_title}
              </div>
            ))
          )}

          {popover.type === "evaluations" && (
            !(popover.data as Recommendation[])?.length ? <div style={{ fontSize: 12, color: "#ddd" }}>暂无评价</div>
            : (popover.data as Recommendation[]).map((rec, i, arr) => (
              <div key={rec.rec_id} style={{
                paddingBottom: i < arr.length - 1 ? 8 : 0,
                marginBottom: i < arr.length - 1 ? 8 : 0,
                borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a2e1a" }}>{rec.user_name}</span>
                  {rec.created_at && (
                    <span style={{ fontSize: 9, color: "#ccc", marginLeft: "auto" }}>
                      {new Date(rec.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#444", lineHeight: 1.6, wordBreak: "break-word" }}>
                  {rec.evaluation}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
