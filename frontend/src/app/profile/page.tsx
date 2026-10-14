"use client";

import React, { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import TopNav from "../components/TopNav";
import UserAvatar from "../components/UserAvatar";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserInfo {
  id: number;
  userName: string;
  email: string | null;
  created_at: string;
  bio: string | null;
  region: string | null;
  preferences: string | null;
  avatar_path: string | null;
}

interface BoardItem {
  noteboard_id: number;
  item_type: string;
  item_title: string | null;
  resource_type: string | null;
  cover_path: string | null;
  identifier: string | null;
}

interface Noteboard {
  id: number;
  title: string;
  description: string | null;
  updated_at: string;
  created_at: string;
  items: BoardItem[];
  item_count: number;
}

interface TagData { tag: string; vote_score: number; }
interface NotebookConnection { board_id: number; board_title: string; user_name: string; }
interface HistoryCard {
  id: number;
  type: "pdf" | "post" | "notebook" | "external_link";
  identifier: string;
  title: string;
  cover_path: string | null;
  viewer_count: number;
  comment_count: number;
  tags: TagData[];
  notebook_connections: NotebookConnection[];
  recommendations: never[];
  updated_at: string;
}

interface ProfileData {
  user: UserInfo;
  stats: { recommendations: number; following: number; followers: number; likes: number; };
  noteboards: Noteboard[];
  history: HistoryCard[];
  is_self?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NAV_COLOR = "#192D10";
const BG = "#FFFEF7";
const GLASS_BG = "rgba(219, 219, 214, 0.3)";
const SHELF_LINE_COLOR = "#757D73";
const SECTION_DIVIDER = "rgba(60, 60, 50, 0.18)";

const BLOCK_H = 158;
const TITLE_H = 31;
const ITEM_H = BLOCK_H + TITLE_H;
const TYPE_W: Record<string, number> = {
  pdf: 166, external_link: 190, notebook: 198, post: 180,
};

// ── Noteboard Box ─────────────────────────────────────────────────────────────
// 三层结构：背景墙+两侧三角 → 资源封面 → 正面 Subtract 面
// 资源封面被 Subtract（最前面那个 #F4EB7E 路径）遮挡，但盖住背景与侧面。

const BOX_W = 73;
const BOX_H = 24;
// SVG 原始 viewBox 是 73x27（lid 在上方多留 3 个单位），用 preserveAspectRatio="none"
// 把它压成 73x24。Subtract 顶边（原 y=7.5）压缩后在 ~y=6.67 处。
const VIEW_W = 73;
const VIEW_H = 27;

const NoteboardBox: React.FC<{
  board: Noteboard;
  onClick: () => void;
}> = ({ board, onClick }) => {
  const [hovered, setHovered] = useState(false);
  const items = board.items.filter((i) =>
    i.item_type !== "thread" && i.item_type !== "annotation"
  ).slice(0, 4);

  const renderItemFace = (item: BoardItem) => {
    const type = item.resource_type || item.item_type;
    const coverUrl = item.cover_path ? `http://localhost:3001${item.cover_path}` : null;

    if (type === "pdf" && coverUrl) {
      return <img src={coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
    }
    if (type === "pdf") {
      return (
        <div style={{
          width: "100%", height: "100%", background: "#d8d5cc",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="24" height="33" viewBox="0 0 22 28" fill="none" stroke="#999" strokeWidth="1.6">
            <rect x="1" y="1" width="20" height="26" rx="1"/>
            <line x1="4" y1="9" x2="18" y2="9"/>
            <line x1="4" y1="15" x2="18" y2="15"/>
          </svg>
        </div>
      );
    }
    if (type === "video") {
      return (
        <div style={{
          width: "100%", height: "100%",
          background: "linear-gradient(135deg, #4a4a4a 0%, #2a2a2a 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 0, height: 0, borderLeft: "15px solid rgba(255,255,255,0.85)",
            borderTop: "9px solid transparent", borderBottom: "9px solid transparent",
            marginLeft: 3,
          }} />
        </div>
      );
    }
    if (type === "webpage" || type === "external_link") {
      return (
        <div style={{
          width: "100%", height: "100%", background: "#f5f1e8",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img src="/MainPage-style/page.png" alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />
        </div>
      );
    }
    if (type === "thread" || type === "post" || type === "annotation") {
      return (
        <div style={{
          width: "100%", height: "100%",
          background: "rgba(255,255,255,0.96)",
          padding: 6, overflow: "hidden",
          display: "flex", flexDirection: "column", gap: 3,
        }}>
          <div style={{ height: 2, background: "#ddd", width: "100%" }} />
          <div style={{ height: 2, background: "#ddd", width: "78%" }} />
          <div style={{ height: 2, background: "#ddd", width: "92%" }} />
        </div>
      );
    }
    if (type === "text_note") {
      return (
        <div style={{
          width: "100%", height: "100%",
          background: "#fff8c5", border: "1px solid #e3d97a",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: "#7a6a20",
        }}>T</div>
      );
    }
    return (
      <div style={{ width: "100%", height: "100%", background: "#e4e0d2" }} />
    );
  };

  const gradDefs = (
    <defs>
      <linearGradient id={`p0-${board.id}`} x1="36.5" y1="0" x2="36.5" y2="18" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FBE176"/>
        <stop offset="1" stopColor="#BDA956"/>
      </linearGradient>
      <linearGradient id={`p1-${board.id}`} x1="63.875" y1="0" x2="66.0946" y2="27.0051" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFEC86"/>
        <stop offset="0.5" stopColor="#81763B"/>
      </linearGradient>
      <linearGradient id={`p2-${board.id}`} x1="5.29138" y1="0" x2="9.79449" y2="27.0204" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F9E470"/>
        <stop offset="0.75" stopColor="#938742"/>
      </linearGradient>
    </defs>
  );

  // Item layout — small cards positioned to sit inside the box, mostly hidden
  // behind the Subtract front face. Item bottom near box bottom, top peeks via
  // the open top strip and the center notch.
  const ITEM_W = 33;
  const ITEM_H = 54;

  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        display: "flex", flexDirection: "column",
        cursor: "pointer", outline: "none",
        alignItems: "center",
      }}
    >
      <div style={{
        position: "relative", width: BOX_W, height: BOX_H,
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform 0.15s",
        filter: hovered ? "brightness(1.04) drop-shadow(0 2px 4px rgba(0,0,0,0.15))" : "none",
      }}>
        {/* Layer 1: back wall + two side flaps */}
        <svg
          width={BOX_W} height={BOX_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {gradDefs}
          <rect x="10.6458" width="51.7083" height="18" fill={`url(#p0-${board.id})`}/>
          <path d="M62.3542 0L73 7.5V27L62.3542 19.5V0Z" fill={`url(#p1-${board.id})`}/>
          <path d="M0 7.5L10.6458 0V19.5L0 27V7.5Z" fill={`url(#p2-${board.id})`}/>
        </svg>

        {/* Layer 2: resource items sitting inside the box */}
        {items.map((it, idx) => {
          const total = items.length;
          const center = (total - 1) / 2;
          const offset = idx - center;
          const left = BOX_W / 2 - ITEM_W / 2 + offset * 8;
          const top = -40 + Math.abs(offset) * 1.8;
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left, top,
                width: ITEM_W, height: ITEM_H,
                background: "#fff",
                boxShadow: "0 3px 4.5px rgba(0,0,0,0.25)",
                overflow: "hidden",
              }}
            >
              {renderItemFace(it)}
            </div>
          );
        })}

        {/* Layer 3: front face (the "Subtract" path) — covers items below front edge */}
        <svg
          width={BOX_W} height={BOX_H} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none"
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        >
          <path
            d="M73 26.9998H0V7.49976H30.417C30.417 10.8135 33.1403 13.4998 36.5 13.4998C39.7549 13.4998 42.4125 10.9788 42.5752 7.80835L42.583 7.49976H73V26.9998Z"
            fill="#F4EB7E"
          />
        </svg>
      </div>

      {/* Title */}
      <div style={{
        marginTop: 6, fontSize: 11,
        color: hovered ? NAV_COLOR : "#444",
        fontWeight: hovered ? 600 : 500,
        textAlign: "center",
        maxWidth: 110,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        transition: "color 0.12s",
      }}>
        {board.title || "未命名笔记板"}
      </div>
      {/* Description / item count */}
      <div style={{
        fontSize: 9, color: "#999", marginTop: 2,
        maxWidth: 110,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        简介: {board.description?.trim() || `${board.item_count} 项`}
      </div>
    </div>
  );
};

// ── History shelf-item (consistent with main page Discovery) ──────────────────

const Indicator: React.FC<{ icon: string; count: number; title: string; }> = ({ icon, count, title }) => (
  <div title={title} style={{
    display: "flex", alignItems: "center", gap: 3,
    padding: "2px 3px", opacity: 0.55,
  }}>
    <img src={icon} alt={title} style={{ width: 13, height: 13, objectFit: "contain" }} />
    <span style={{ fontSize: 9, color: "#888", lineHeight: 1 }}>{count}</span>
  </div>
);

const IndicatorColumn: React.FC<{ card: HistoryCard }> = ({ card }) => (
  <div style={{
    width: 44, flexShrink: 0, height: "100%",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "flex-end", gap: 2,
  }}>
    <Indicator icon="/MainPage-style/view.png" count={card.viewer_count} title="看过" />
    <Indicator icon="/MainPage-style/comment.png" count={card.comment_count} title="评价" />
    <Indicator icon="/MainPage-style/mark.png" count={card.tags.length} title="标签" />
    <Indicator icon="/MainPage-style/relation.png" count={card.notebook_connections.length} title="收录于笔记板" />
  </div>
);

const HistoryShelfItem: React.FC<{
  card: HistoryCard;
  onNavigate: () => void;
}> = ({ card, onNavigate }) => {
  const [hovered, setHovered] = useState(false);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);

  const coverUrl = card.cover_path ? `http://localhost:3001${card.cover_path}` : null;
  const w = TYPE_W[card.type] || TYPE_W.pdf;

  // PDF (book)
  if (card.type === "pdf") {
    const bookW = w - 44 - 2;
    const spineW = 9;
    const coverAreaW = bookW - spineW;
    const bookH = coverAspect !== null
      ? Math.min(BLOCK_H - 10, Math.round(coverAreaW * coverAspect))
      : 118;

    return (
      <div
        role="button" tabIndex={0} onClick={onNavigate}
        onKeyDown={(e) => e.key === "Enter" && onNavigate()}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ width: w, height: ITEM_H, display: "flex", flexDirection: "column",
          cursor: "pointer", outline: "none", flexShrink: 0 }}
      >
        <div style={{
          height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10,
          filter: hovered ? "brightness(1.06)" : "none", transition: "filter 0.15s",
        }}>
          <div style={{
            width: bookW, height: bookH, display: "flex", flexShrink: 0,
            boxShadow: hovered ? "2px 4px 14px rgba(0,0,0,0.28)" : "1px 2px 8px rgba(0,0,0,0.16)",
            transition: "box-shadow 0.15s, transform 0.15s",
            transform: hovered ? "translateY(-3px)" : "none",
          }}>
            <div style={{ width: 9, flexShrink: 0, height: "100%",
              background: "linear-gradient(to right, #6b6b64 0%, #bbb8b0 60%, #9a9890 100%)" }} />
            <div style={{ flex: 1, height: "100%", overflow: "hidden",
              background: coverUrl ? "transparent" : "#d8d5cc" }}>
              {coverUrl ? (
                <img src={coverUrl} alt="" onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0) setCoverAspect(img.naturalHeight / img.naturalWidth);
                }} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
          <IndicatorColumn card={card} />
        </div>
        <div style={{
          height: TITLE_H, paddingTop: 6, paddingLeft: 2,
          fontSize: 11, color: hovered ? NAV_COLOR : "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
        }}>
          {card.title || card.identifier}
        </div>
      </div>
    );
  }

  // External link
  if (card.type === "external_link") {
    let urlLine1 = card.identifier;
    let urlLine2 = "";
    try {
      const u = new URL(card.identifier);
      urlLine1 = u.protocol + "//" + u.host;
      urlLine2 = u.pathname + u.search + u.hash;
      if (urlLine2 === "/") urlLine2 = "";
    } catch { /* keep raw */ }

    return (
      <div
        role="button" tabIndex={0} onClick={onNavigate}
        onKeyDown={(e) => e.key === "Enter" && onNavigate()}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ width: w, height: ITEM_H, display: "flex", flexDirection: "column",
          cursor: "pointer", outline: "none", flexShrink: 0 }}
      >
        <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
              <img src="/MainPage-style/page.png" alt="网页"
                style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0,
                  opacity: hovered ? 1 : 0.75, transition: "opacity 0.13s", marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#555", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5 }}>{urlLine1}</div>
                {urlLine2 && (
                  <div style={{ fontSize: 11, color: "#999", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5 }}>{urlLine2}</div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Indicator icon="/MainPage-style/view.png" count={card.viewer_count} title="看过" />
              <Indicator icon="/MainPage-style/comment.png" count={card.comment_count} title="评价" />
              <Indicator icon="/MainPage-style/mark.png" count={card.tags.length} title="标签" />
              <Indicator icon="/MainPage-style/relation.png" count={card.notebook_connections.length} title="收录于笔记板" />
            </div>
          </div>
        </div>
        <div style={{
          height: TITLE_H, paddingTop: 6, fontSize: 11,
          color: hovered ? NAV_COLOR : "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
        }}>
          {card.title || card.identifier}
        </div>
      </div>
    );
  }

  // Notebook
  if (card.type === "notebook") {
    const nbW = w - 44 - 6;
    return (
      <div
        role="button" tabIndex={0} onClick={onNavigate}
        onKeyDown={(e) => e.key === "Enter" && onNavigate()}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ width: w, height: ITEM_H, display: "flex", flexDirection: "column",
          cursor: "pointer", outline: "none", flexShrink: 0 }}
      >
        <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
          <div style={{
            width: nbW, height: 92, flexShrink: 0, display: "flex", overflow: "hidden",
            boxShadow: hovered ? "2px 4px 14px rgba(0,0,0,0.18)" : "1px 2px 6px rgba(0,0,0,0.10)",
            transition: "box-shadow 0.15s, transform 0.15s",
            transform: hovered ? "translateY(-2px)" : "none",
            borderRadius: "0 3px 3px 0",
          }}>
            <div style={{ width: 10, flexShrink: 0, height: "100%",
              background: "linear-gradient(to right, #b5a84a 0%, #f0dc6e 60%, #c9b850 100%)" }} />
            <div style={{ flex: 1, height: "100%", background: "#f9f2d0",
              borderLeft: "1px solid #ddd098", display: "flex", flexDirection: "column",
              justifyContent: "center", alignItems: "center", gap: 4, padding: "0 8px" }}>
              <img src="/Topframe_style/笔记板页面.png" alt="" style={{ width: 22, height: 22, objectFit: "contain", opacity: 0.5 }} />
              <div style={{ width: "80%", height: 1, background: "#ddd098" }} />
              <div style={{ width: "60%", height: 1, background: "#ddd098" }} />
            </div>
          </div>
          <IndicatorColumn card={card} />
        </div>
        <div style={{
          height: TITLE_H, paddingTop: 6, paddingLeft: 2, fontSize: 11,
          color: hovered ? NAV_COLOR : "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
        }}>
          {card.title || "未命名笔记板"}
        </div>
      </div>
    );
  }

  // Post
  const cardW = w - 44 - 6;
  return (
    <div
      role="button" tabIndex={0} onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ width: w, height: ITEM_H, display: "flex", flexDirection: "column",
        cursor: "pointer", outline: "none", flexShrink: 0 }}
    >
      <div style={{ height: BLOCK_H, display: "flex", alignItems: "flex-end", paddingBottom: 10 }}>
        <div style={{
          width: cardW, height: 72, flexShrink: 0,
          border: `1px solid ${hovered ? "rgba(23,55,8,0.22)" : "rgba(0,0,0,0.10)"}`,
          borderRadius: 5, background: "rgba(255,255,255,0.8)",
          padding: "8px 10px",
          boxShadow: hovered ? "1px 3px 10px rgba(0,0,0,0.10)" : "0 1px 4px rgba(0,0,0,0.06)",
          transition: "border-color 0.13s, box-shadow 0.13s",
          transform: hovered ? "translateY(-2px)" : "none",
          overflow: "hidden", display: "flex", flexDirection: "column",
          justifyContent: "flex-start", gap: 4,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#1a1a1a",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            overflow: "hidden",
          } as React.CSSProperties}>{card.title || "未命名帖子"}</div>
          <div style={{ fontSize: 9, color: "#ccc", marginTop: "auto" }}>帖子</div>
        </div>
        <IndicatorColumn card={card} />
      </div>
      <div style={{
        height: TITLE_H, paddingTop: 6, paddingLeft: 2, fontSize: 11,
        color: hovered ? NAV_COLOR : "#555",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: hovered ? 600 : 400, transition: "color 0.12s",
      }}>
        {card.title || "未命名帖子"}
      </div>
    </div>
  );
};

// ── Glass Card ────────────────────────────────────────────────────────────────

const GlassCard: React.FC<{
  title: string;
  children: React.ReactNode;
  minHeight?: number;
}> = ({ title, children, minHeight }) => (
  <div style={{
    background: GLASS_BG,
    borderRadius: 6,
    padding: "18px 18px",
    minHeight: minHeight || undefined,
    backdropFilter: "blur(4px)",
  }}>
    <div style={{ fontSize: 13, color: "#444", fontWeight: 500, marginBottom: 12 }}>{title}</div>
    <div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>{children}</div>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

function ProfilePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetUser = searchParams?.get("u") ?? null;
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [regionDraft, setRegionDraft] = useState("");
  const [prefDraft, setPrefDraft] = useState("");

  const fetchProfile = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    try {
      const url = targetUser
        ? `http://localhost:3001/api/profile/${encodeURIComponent(targetUser)}`
        : "http://localhost:3001/api/profile/me";
      const r = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data);
      setBioDraft(r.data.user.bio || "");
      setRegionDraft(r.data.user.region || "");
      setPrefDraft(r.data.user.preferences || "");
      setEditingBio(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router, targetUser]);

  useEffect(() => { setLoading(true); fetchProfile(); }, [fetchProfile]);
  const isSelf = data?.is_self !== false;

  const saveBio = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      await axios.patch("http://localhost:3001/api/profile/me",
        { bio: bioDraft },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEditingBio(false);
      fetchProfile();
    } catch (err) { console.error(err); }
  }, [bioDraft, fetchProfile]);

  const saveSettings = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      await axios.patch("http://localhost:3001/api/profile/me",
        { region: regionDraft, preferences: prefDraft },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowSettings(false);
      fetchProfile();
    } catch (err) { console.error(err); }
  }, [regionDraft, prefDraft, fetchProfile]);

  const navigateToResource = useCallback((card: HistoryCard) => {
    switch (card.type) {
      case "pdf":
        window.open(`/pdf-viewer?file=${encodeURIComponent(card.identifier)}`, "_blank"); break;
      case "post":
        router.push(`/threads/${card.identifier}`); break;
      case "external_link":
        window.open(card.identifier, "_blank", "noopener,noreferrer"); break;
      case "notebook":
        router.push(`/noteboard/${card.identifier}`); break;
    }
  }, [router]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      background: BG,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#1a1a1a",
    }}>
      <TopNav />

      <div style={{
        flex: 1, paddingTop: 78 + 22, paddingBottom: 60,
        paddingLeft: 78, paddingRight: 78,
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 229px",
        gap: 28,
        maxWidth: 1440, margin: "0 auto", width: "100%",
        boxSizing: "border-box",
      }}>
        {/* ── Left main column ── */}
        <div style={{ display: "flex", flexDirection: "column" }}>

          {/* Profile header */}
          <div style={{
            display: "flex", flexDirection: "column",
            paddingTop: 8, paddingBottom: 8,
            borderBottom: `1px solid ${SECTION_DIVIDER}`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
              {/* Avatar 75x75 — UserAvatar handles hover-to-follow on others */}
              <div style={{ width: 75, height: 75, flexShrink: 0 }}>
                {data?.user.userName ? (
                  <UserAvatar
                    userName={data.user.userName}
                    avatarPath={data.user.avatar_path}
                    size={75}
                    showFollowButton={!isSelf}
                    onClick={false}
                  />
                ) : null}
              </div>

              {/* Name + UID + stats row */}
              <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
                <div style={{ fontSize: 19, color: "#222", fontWeight: 500, letterSpacing: "0.02em" }}>
                  {data?.user.userName || (loading ? "" : "用户名")}
                </div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                  UID: {data?.user.id ?? ""}
                </div>

                {/* Stats row */}
                <div style={{
                  marginTop: 28,
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  fontSize: 12, color: "#555",
                  paddingRight: 12,
                }}>
                  {[
                    { label: "推荐数", value: data?.stats.recommendations ?? 0 },
                    { label: "关注数", value: data?.stats.following ?? 0 },
                    { label: "粉丝数", value: data?.stats.followers ?? 0 },
                    { label: "笔记、批注获赞", value: data?.stats.likes ?? 0 },
                  ].map((s) => (
                    <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "#666", fontSize: 12 }}>{s.label}</span>
                      <span style={{ fontSize: 15, color: "#222", fontWeight: 600 }}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 发布 section */}
          <div style={{
            paddingTop: 22, paddingBottom: 28,
            borderBottom: `1px solid ${SECTION_DIVIDER}`,
          }}>
            <div style={{ fontSize: 14, color: "#333", fontWeight: 500, marginBottom: 18 }}>发布:</div>
            {loading ? (
              <div style={{ height: 130, display: "flex", alignItems: "center", color: "#bbb", fontSize: 12 }}>加载中…</div>
            ) : data && data.noteboards.length > 0 ? (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 22, alignItems: "flex-end",
                paddingTop: 36,
              }}>
                {data.noteboards.map((board) => (
                  <NoteboardBox key={board.id}
                    board={board}
                    onClick={() => router.push(`/noteboard/${board.id}`)} />
                ))}
                {/* "+" tile for creating new noteboard */}
                <div
                  role="button"
                  onClick={() => router.push("/noteboard")}
                  style={{
                    width: BOX_W, height: BOX_H,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1px dashed rgba(0,0,0,0.18)", borderRadius: 3,
                    cursor: "pointer", color: "#bbb", fontSize: 18, fontWeight: 300,
                  }}
                  title="新建笔记板"
                >
                  +
                </div>
              </div>
            ) : (
              <div style={{ color: "#bbb", fontSize: 12 }}>
                还没有发布的笔记板。
                <button
                  onClick={() => router.push("/noteboard")}
                  style={{
                    marginLeft: 8, background: "none", border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 4, padding: "4px 10px", fontSize: 11,
                    color: "#444", cursor: "pointer",
                  }}>新建一个</button>
              </div>
            )}
          </div>

          {/* 动态历史 section */}
          <div style={{
            paddingTop: 22, paddingBottom: 28,
          }}>
            <div style={{ fontSize: 14, color: "#333", fontWeight: 500, marginBottom: 16 }}>动态历史:</div>
            {loading ? (
              <div style={{ height: 180, display: "flex", alignItems: "center", color: "#bbb", fontSize: 12 }}>加载中…</div>
            ) : data && data.history.length > 0 ? (
              <div style={{
                display: "flex", flexWrap: "wrap",
                gap: "0 6px", rowGap: 0,
                backgroundImage: `linear-gradient(transparent ${BLOCK_H - 1}px, ${SHELF_LINE_COLOR} ${BLOCK_H - 1}px, ${SHELF_LINE_COLOR} ${BLOCK_H}px, transparent ${BLOCK_H}px)`,
                backgroundSize: `100% ${ITEM_H}px`,
                backgroundRepeat: "repeat-y",
              }}>
                {data.history.map((card) => (
                  <HistoryShelfItem key={card.id + "_" + card.updated_at}
                    card={card}
                    onNavigate={() => navigateToResource(card)} />
                ))}
              </div>
            ) : (
              <div style={{ color: "#bbb", fontSize: 12 }}>暂无浏览记录。</div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
          {/* Settings gear — only show for self */}
          {isSelf && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -8 }}>
            <button
              onClick={() => setShowSettings(true)}
              title="设置"
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 4,
                opacity: 0.55, fontSize: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
              onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.opacity = "0.55"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.6">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
          )}

          {/* 个人介绍 */}
          <GlassCard title="个人介绍：" minHeight={225}>
            {isSelf && editingBio ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={bioDraft}
                  onChange={(e) => setBioDraft(e.target.value)}
                  rows={6}
                  style={{
                    width: "100%", border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 4, padding: 8, fontSize: 12, fontFamily: "inherit",
                    resize: "vertical", background: "rgba(255,255,255,0.6)",
                  }}
                  placeholder="一句话介绍自己..."
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => { setEditingBio(false); setBioDraft(data?.user.bio || ""); }}
                    style={{ fontSize: 11, padding: "4px 10px", background: "none",
                      border: "1px solid rgba(0,0,0,0.15)", borderRadius: 4, cursor: "pointer" }}>取消</button>
                  <button onClick={saveBio}
                    style={{ fontSize: 11, padding: "4px 10px", background: NAV_COLOR,
                      color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>保存</button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => isSelf && setEditingBio(true)}
                style={{ cursor: isSelf ? "pointer" : "default", minHeight: 100, whiteSpace: "pre-wrap" }}
              >
                {data?.user.bio?.trim() ||
                  <span style={{ color: "#bbb" }}>
                    {isSelf ? "点击此处添加个人介绍…" : "该用户暂无个人介绍。"}
                  </span>}
              </div>
            )}
          </GlassCard>

          {/* 用户资料 */}
          <GlassCard title="用户资料:" minHeight={130}>
            <div>地区: <span style={{ color: data?.user.region ? "#555" : "#bbb" }}>{data?.user.region || "未填写"}</span></div>
            <div>注册时间: <span style={{ color: "#555" }}>
              {data?.user.created_at ? new Date(data.user.created_at).toLocaleDateString() : "—"}
            </span></div>
            <div>偏好: <span style={{ color: data?.user.preferences ? "#555" : "#bbb" }}>{data?.user.preferences || "未填写"}</span></div>
          </GlassCard>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }} onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "white", padding: 24, borderRadius: 8, minWidth: 360,
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>编辑用户资料</div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#555" }}>
              地区
              <input value={regionDraft} onChange={(e) => setRegionDraft(e.target.value)}
                style={{ padding: 6, fontSize: 12, border: "1px solid #ddd", borderRadius: 4 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#555" }}>
              偏好（用逗号分隔标签）
              <input value={prefDraft} onChange={(e) => setPrefDraft(e.target.value)}
                style={{ padding: 6, fontSize: 12, border: "1px solid #ddd", borderRadius: 4 }} />
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setShowSettings(false)}
                style={{ fontSize: 12, padding: "6px 14px", background: "none",
                  border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>取消</button>
              <button onClick={saveSettings}
                style={{ fontSize: 12, padding: "6px 14px", background: NAV_COLOR,
                  color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageInner />
    </Suspense>
  );
}
