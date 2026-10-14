"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import TopNav from "../components/TopNav";
import UserAvatar from "../components/UserAvatar";
import VisibilityPicker from "../components/VisibilityPicker";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Group {
  id: number;
  name: string;
  is_default: number;
  sort_order: number;
  member_count: number;
}

interface ResourceRef {
  id: number | null;
  title: string | null;
  type: string | null;
  cover_path: string | null;
  identifier: string | null;
  page: number | null;
}

interface FeedEvent {
  kind: "annotation" | "reply" | "post";
  id: string;
  actor: string;
  at: string;
  level: number;
  payload: {
    annotation_id?: number;
    thread_id?: number | null;
    reply_id?: number;
    thread_title?: string | null;
    text?: string | null;
    selected_text?: string | null;
    body?: string | null;
    title?: string | null;
    resource?: ResourceRef | null;
  };
}

interface FeedResponse {
  events: FeedEvent[];
  users: Record<string, { id: number; avatar_path: string | null }>;
}

type PanelKind = "search" | "post" | "groups" | null;

// 本地草稿（localStorage 持久化；后端暂无草稿表）
interface Draft {
  id: string;
  title: string;
  body: string;
  visibility: 0 | 1 | 2;
  savedAt: number;
}
const DRAFTS_KEY = "thought_drafts";   // 草稿箱列表
const SCRATCH_KEY = "thought_scratch"; // 正在编辑但未存草稿的临时内容

// ── Constants ─────────────────────────────────────────────────────────────────

const NAV_COLOR = "#192D10";
const BG = "#FFFEF7";
const ICONBAR_W = 89;             // Matches Figma left margin to feed start
const HELPZONE_W = 212;           // 原 282，缩减 1/4
const HELPZONE_TOP = 87;          // (165 - 78) below top nav
const HELPZONE_H = 357;           // 原 536，缩减 1/3
const HELPZONE_RIGHT = 16;        // 求助区距视口右边
const GAP = HELPZONE_RIGHT;       // 动态区与求助区间距：等于求助区右边距 → 求助区左缘紧贴动态区右缘
const ICON_COLOR = "#757D73";

// 单条动态卡片样式（对齐 Movement-style/一个动态.svg）
const CARD_FILL = "rgba(229,229,229,0.05)"; // #E5E5E5 @ 5%
const CARD_BORDER = "#7C8365";

// Icon positions inside the left bar (y relative to top of content, after TopNav)
const Y_SEARCH = 48;              // SVG y≈126 - 78
const Y_POST = 119;               // SVG y≈197 - 78
// Groups (hamburger) is rendered at the bottom: position absolute bottom

// ── Helpers ───────────────────────────────────────────────────────────────────

const relativeTime = (iso: string) => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(iso).toLocaleDateString();
};

// ── Icon button ──────────────────────────────────────────────────────────────

const IconBtn: React.FC<{
  src: string; alt: string; size: number;
  active: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}> = ({ src, alt, size, active, onClick, style }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={alt}
      style={{
        background: active ? "rgba(0,0,0,0.06)" : hovered ? "rgba(0,0,0,0.04)" : "transparent",
        border: "none",
        cursor: "pointer",
        padding: 6,
        borderRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.13s, opacity 0.13s",
        opacity: active ? 1 : hovered ? 0.95 : 0.75,
        ...style,
      }}
    >
      <img src={src} alt={alt}
        style={{ width: size, height: size, objectFit: "contain" }} />
    </button>
  );
};

// ── Event card ────────────────────────────────────────────────────────────────

const EventCard: React.FC<{
  ev: FeedEvent;
  avatarPath: string | null;
  onResourceClick: (r: ResourceRef) => void;
  onThreadClick: (threadId: number) => void;
}> = ({ ev, avatarPath, onResourceClick, onThreadClick }) => {
  const goProfile = () => {
    window.location.href = `/profile?u=${encodeURIComponent(ev.actor)}`;
  };

  let actionLabel = "";
  if (ev.kind === "annotation") actionLabel = "添加了批注";
  else if (ev.kind === "reply") actionLabel = "在帖子内盖了一楼";
  else actionLabel = "发布了一篇想法";

  const content = (() => {
    if (ev.level < 1) return null;

    if (ev.kind === "annotation") {
      const r = ev.payload.resource;
      return (
        <>
          {r && (
            <div
              onClick={() => onResourceClick(r)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", marginTop: 8,
                background: "rgba(255,255,255,0.55)",
                borderRadius: 4, cursor: "pointer",
              }}
            >
              {r.cover_path && (
                <img src={`http://localhost:3001${r.cover_path}`} alt=""
                  style={{ width: 26, height: 34, objectFit: "cover", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#444", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title || r.identifier}
                  {r.page ? <span style={{ color: "#999" }}>  · P{r.page}</span> : null}
                </div>
              </div>
            </div>
          )}
          {ev.level >= 2 && ev.payload.selected_text && (
            <div style={{
              fontSize: 11, color: "#777", marginTop: 6,
              borderLeft: `2px solid ${NAV_COLOR}`, paddingLeft: 8,
              fontStyle: "italic",
            }}>{ev.payload.selected_text}</div>
          )}
          {ev.level >= 2 && ev.payload.text && (
            <div style={{ fontSize: 13, color: "#222", marginTop: 8, whiteSpace: "pre-wrap" }}>
              {ev.payload.text}
            </div>
          )}
        </>
      );
    }

    if (ev.kind === "reply") {
      return (
        <>
          {ev.payload.thread_id && (
            <div
              onClick={() => onThreadClick(ev.payload.thread_id!)}
              style={{
                fontSize: 12, color: "#555", marginTop: 6, cursor: "pointer",
                padding: "6px 10px", background: "rgba(255,255,255,0.55)",
                borderRadius: 4,
              }}
            >帖子: {ev.payload.thread_title || `#${ev.payload.thread_id}`}</div>
          )}
          {ev.level >= 2 && ev.payload.body && (
            <div style={{ fontSize: 13, color: "#222", marginTop: 8, whiteSpace: "pre-wrap" }}>
              {ev.payload.body}
            </div>
          )}
        </>
      );
    }

    // post
    return (
      <>
        {ev.payload.title && (
          <div
            onClick={() => ev.payload.thread_id && onThreadClick(ev.payload.thread_id)}
            style={{
              fontSize: 14, fontWeight: 600, color: "#222", marginTop: 6,
              cursor: "pointer",
            }}
          >{ev.payload.title}</div>
        )}
        {ev.level >= 2 && ev.payload.body && (
          <div
            onClick={() => ev.payload.thread_id && onThreadClick(ev.payload.thread_id)}
            style={{
              fontSize: 13, color: "#444", marginTop: 6, whiteSpace: "pre-wrap",
              cursor: ev.payload.thread_id ? "pointer" : "default",
              display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical",
              overflow: "hidden",
            } as React.CSSProperties}
          >{ev.payload.body}</div>
        )}
      </>
    );
  })();

  return (
    <div style={{
      background: CARD_FILL,
      padding: "18px 22px",
      // 左右不封闭：仅顶部一条分隔线；相邻动态共用这条线（容器无间距）
      borderTop: `1px solid ${CARD_BORDER}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <UserAvatar userName={ev.actor} avatarPath={avatarPath} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#555", display: "flex", gap: 8, alignItems: "baseline" }}>
            <span
              onClick={goProfile}
              style={{ fontSize: 13, fontWeight: 600, color: "#222", cursor: "pointer" }}
            >{ev.actor}</span>
            <span>{actionLabel}</span>
            <span style={{ color: "#aaa", marginLeft: "auto", fontSize: 11 }}>{relativeTime(ev.at)}</span>
          </div>
          {content}
        </div>
      </div>
    </div>
  );
};

// ── Floating Panel ───────────────────────────────────────────────────────────

const FloatingPanel: React.FC<{
  anchor: { top: number } | { bottom: number };
  width: number;
  children: React.ReactNode;
  onClose: () => void;
}> = ({ anchor, width, children, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: ICONBAR_W + 6,
        top: "top" in anchor ? anchor.top : undefined,
        bottom: "bottom" in anchor ? anchor.bottom : undefined,
        width,
        background: "#fff",
        boxShadow: "0 6px 22px rgba(0,0,0,0.16)",
        borderRadius: 8,
        padding: 14,
        zIndex: 50,
      }}
    >{children}</div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

export default function MovementPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [openPanel, setOpenPanel] = useState<PanelKind>(null);

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [usersMeta, setUsersMeta] = useState<Record<string, { id: number; avatar_path: string | null }>>({});
  const [loading, setLoading] = useState(true);

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postVisibility, setPostVisibility] = useState<0 | 1 | 2>(2);
  const [posting, setPosting] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // ── 草稿箱 ──
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftFlash, setDraftFlash] = useState("");

  // 初次加载草稿列表
  useEffect(() => {
    try { setDrafts(JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]")); } catch { /* ignore */ }
  }, []);

  const persistDrafts = useCallback((next: Draft[]) => {
    setDrafts(next);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(next));
  }, []);

  // 打开编辑器：若当前为空则恢复上次未保存的临时内容
  const openComposer = useCallback(() => {
    if (!postTitle.trim() && !postBody.trim()) {
      try {
        const s = JSON.parse(localStorage.getItem(SCRATCH_KEY) || "null");
        if (s) {
          setPostTitle(s.title || "");
          setPostBody(s.body || "");
          if (s.visibility === 0 || s.visibility === 1 || s.visibility === 2) setPostVisibility(s.visibility);
        }
      } catch { /* ignore */ }
    }
    setOpenPanel("post");
  }, [postTitle, postBody]);

  // 编辑器开启时，持续把内容写入临时区，防止误关丢失
  useEffect(() => {
    if (openPanel !== "post") return;
    localStorage.setItem(SCRATCH_KEY, JSON.stringify({ title: postTitle, body: postBody, visibility: postVisibility }));
  }, [openPanel, postTitle, postBody, postVisibility]);

  const saveDraft = () => {
    if (!postTitle.trim() && !postBody.trim()) return;
    const entry: Draft = {
      id: editingDraftId || `d${Date.now()}`,
      title: postTitle, body: postBody, visibility: postVisibility, savedAt: Date.now(),
    };
    const exists = editingDraftId && drafts.some((d) => d.id === editingDraftId);
    const next = exists
      ? drafts.map((d) => (d.id === editingDraftId ? entry : d))
      : [entry, ...drafts];
    persistDrafts(next);
    setEditingDraftId(entry.id);
    setDraftFlash("已存入草稿箱");
    setTimeout(() => setDraftFlash(""), 1500);
  };

  const loadDraft = (d: Draft) => {
    setPostTitle(d.title);
    setPostBody(d.body);
    setPostVisibility(d.visibility);
    setEditingDraftId(d.id);
  };

  const deleteDraft = (id: string) => {
    persistDrafts(drafts.filter((d) => d.id !== id));
    if (editingDraftId === id) setEditingDraftId(null);
  };

  const newThought = () => {
    setPostTitle(""); setPostBody(""); setPostVisibility(2); setEditingDraftId(null);
    localStorage.removeItem(SCRATCH_KEY);
  };

  const fetchGroups = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    try {
      const r = await axios.get("http://localhost:3001/api/follows/groups", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(r.data.groups || []);
    } catch (err) { console.error(err); }
  }, [router]);

  const fetchFeed = useCallback(async (groupId: number | null) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (groupId) params.set("group_id", String(groupId));
      params.set("limit", "50");
      const r = await axios.get<FeedResponse>(
        `http://localhost:3001/api/feed?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEvents(r.data.events || []);
      setUsersMeta(r.data.users || {});
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchFeed(selectedGroup); }, [selectedGroup, fetchFeed]);

  const filteredEvents = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return events;
    return events.filter((ev) => {
      const parts = [
        ev.actor,
        ev.payload.text,
        ev.payload.selected_text,
        ev.payload.body,
        ev.payload.title,
        ev.payload.thread_title,
        ev.payload.resource?.title,
        ev.payload.resource?.identifier,
      ];
      return parts.some((p) => typeof p === "string" && p.toLowerCase().includes(q));
    });
  }, [events, searchText]);

  const submitPost = async () => {
    if (!postTitle.trim() || !postBody.trim()) return;
    setPosting(true);
    const token = localStorage.getItem("token");
    try {
      await axios.post("http://localhost:3001/api/feed/post",
        { title: postTitle.trim(), body: postBody, visibility_level: postVisibility },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // 发布成功后，从草稿箱移除对应草稿并清空临时内容
      if (editingDraftId) persistDrafts(drafts.filter((d) => d.id !== editingDraftId));
      localStorage.removeItem(SCRATCH_KEY);
      setPostTitle("");
      setPostBody("");
      setPostVisibility(2);
      setEditingDraftId(null);
      setOpenPanel(null);
      fetchFeed(selectedGroup);
    } catch (err) { console.error(err); }
    finally { setPosting(false); }
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const token = localStorage.getItem("token");
    try {
      await axios.post("http://localhost:3001/api/follows/groups",
        { name }, { headers: { Authorization: `Bearer ${token}` } });
      setNewGroupName("");
      fetchGroups();
    } catch (err) { console.error(err); }
  };

  const onResourceClick = (r: ResourceRef) => {
    if (!r) return;
    if (r.type === "pdf" && r.identifier) {
      const page = r.page ? `&page=${r.page}` : "";
      window.open(`/pdf-viewer?file=${encodeURIComponent(r.identifier)}${page}`, "_blank");
    }
  };
  const onThreadClick = (id: number) => router.push(`/threads/${id}`);

  return (
    <div style={{
      minHeight: "100vh", background: BG,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#1a1a1a",
      position: "relative",
    }}>
      <TopNav />

      {/* ── Left icon bar ── */}
      <div style={{
        position: "fixed",
        left: 0, top: 78, bottom: 0,
        width: ICONBAR_W,
        zIndex: 30,
        pointerEvents: "none",
      }}>
        <div style={{
          position: "relative",
          width: "100%", height: "100%",
          pointerEvents: "auto",
        }}>
          {/* Search */}
          <div style={{ position: "absolute", top: Y_SEARCH, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
            <IconBtn
              src="/Movement-style/Search.png"
              alt="搜索动态"
              size={24}
              active={openPanel === "search"}
              onClick={() => setOpenPanel(openPanel === "search" ? null : "search")}
            />
          </div>
          {/* Post */}
          <div style={{ position: "absolute", top: Y_POST, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
            <IconBtn
              src="/Movement-style/发布动态.png"
              alt="发布想法"
              size={28}
              active={openPanel === "post"}
              onClick={() => (openPanel === "post" ? setOpenPanel(null) : openComposer())}
            />
          </div>
          {/* Groups (bottom) */}
          <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
            <IconBtn
              src="/Movement-style/展开分组.png"
              alt="关注分组"
              size={22}
              active={openPanel === "groups"}
              onClick={() => setOpenPanel(openPanel === "groups" ? null : "groups")}
            />
          </div>

          {/* Popups */}
          {openPanel === "search" && (
            <FloatingPanel anchor={{ top: Y_SEARCH - 4 }} width={290} onClose={() => setOpenPanel(null)}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#222", marginBottom: 8 }}>搜索动态</div>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="按内容/标题/作者过滤..."
                autoFocus
                style={{
                  width: "100%", fontSize: 12, padding: "7px 10px",
                  border: "1px solid #ddd", borderRadius: 4,
                  boxSizing: "border-box", outline: "none",
                }}
              />
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 6 }}>
                共 {filteredEvents.length} / {events.length} 条匹配
              </div>
            </FloatingPanel>
          )}

          {openPanel === "groups" && (
            <FloatingPanel
              anchor={{ bottom: 30 }}
              width={240}
              onClose={() => setOpenPanel(null)}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#222", marginBottom: 8 }}>关注分组</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 240, overflowY: "auto" }}>
                <GroupRow label="全部动态" count={null}
                  active={selectedGroup === null}
                  onClick={() => { setSelectedGroup(null); setOpenPanel(null); }} />
                {groups.map((g) => (
                  <GroupRow key={g.id}
                    label={g.name}
                    count={g.member_count}
                    isDefault={!!g.is_default}
                    active={selectedGroup === g.id}
                    onClick={() => { setSelectedGroup(g.id); setOpenPanel(null); }} />
                ))}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
                  placeholder="新建分组..."
                  style={{
                    flex: 1, fontSize: 11, padding: "5px 8px",
                    border: "1px solid #ddd", borderRadius: 3,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <button onClick={createGroup} disabled={!newGroupName.trim()}
                  style={{
                    fontSize: 11, padding: "5px 10px",
                    background: "#f4f4ec", border: "1px solid #ddd",
                    borderRadius: 3, cursor: "pointer",
                  }}
                >+</button>
              </div>
            </FloatingPanel>
          )}
        </div>
      </div>

      {/* ── 动态区：full-height background spanning below TopNav to page bottom ── */}
      {/* Direct PNG, no shadow, no tint overlay. Stretches to fill the column. */}
      <div style={{
        position: "fixed",
        left: ICONBAR_W,
        right: HELPZONE_W + GAP,          /* GAP = gutter between 动态区 and 求助区 */
        top: 78,
        bottom: 0,
        backgroundImage: "url(/Movement-style/动态区-背景-已叠加Glass效果.png)",
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        zIndex: 0,
      }} />

      {/* ── 求助区：card with shadow at fixed position ── */}
      <aside style={{
        position: "fixed",
        right: HELPZONE_RIGHT,
        top: 78 + HELPZONE_TOP,
        width: HELPZONE_W,
        height: HELPZONE_H,
        backgroundImage: "url(/Movement-style/求助区-背景-已叠加Glass效果-投影参数X2%20Y-7%20模糊3%20扩展2%20颜色000000%208%25.png)",
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        // drop-shadow 跟随 PNG 透明圆角的实际形状投影
        filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.16))",
        zIndex: 5,
      }} />

      {/* ── Scrollable feed content over the 动态区 background ── */}
      <main style={{
        position: "relative",
        zIndex: 10,
        marginLeft: ICONBAR_W,
        marginRight: HELPZONE_W + GAP,
        paddingTop: 78 + 26,
        paddingBottom: 60,
        paddingLeft: 30,
        paddingRight: 30,
        minHeight: "100vh",
        boxSizing: "border-box",
      }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          marginBottom: 18,
        }}>
          <h1 style={{ fontSize: 17, fontWeight: 500, color: "#333", margin: 0 }}>
            动态
            {selectedGroup !== null && (
              <span style={{ fontSize: 13, color: "#888", marginLeft: 8 }}>
                · {groups.find((g) => g.id === selectedGroup)?.name}
              </span>
            )}
            {searchText.trim() && (
              <span style={{ fontSize: 12, color: "#aaa", marginLeft: 8 }}>
                · 搜索 “{searchText.trim()}”
              </span>
            )}
          </h1>
        </div>

        {loading ? (
          <div style={{ color: "#bbb", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
            加载中…
          </div>
        ) : filteredEvents.length === 0 ? (
          <div style={{ color: "#aaa", fontSize: 13, padding: "60px 0", textAlign: "center" }}>
            {events.length === 0
              ? (selectedGroup === null
                  ? "暂无动态。在他人头像上悬停并点击 + 关注用户后，他们的批注、楼层、帖子都会出现在这里。"
                  : "该分组下暂无动态。")
              : "没有匹配的动态。"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, borderBottom: `1px solid ${CARD_BORDER}` }}>
            {filteredEvents.map((ev) => (
              <EventCard
                key={ev.id}
                ev={ev}
                avatarPath={usersMeta[ev.actor]?.avatar_path ?? null}
                onResourceClick={onResourceClick}
                onThreadClick={onThreadClick}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── 发布想法：全窗口编辑器 + 草稿箱 ── */}
      {openPanel === "post" && (
        <ThoughtComposer
          title={postTitle} setTitle={setPostTitle}
          body={postBody} setBody={setPostBody}
          visibility={postVisibility} setVisibility={setPostVisibility}
          posting={posting}
          drafts={drafts}
          editingDraftId={editingDraftId}
          draftFlash={draftFlash}
          onSaveDraft={saveDraft}
          onLoadDraft={loadDraft}
          onDeleteDraft={deleteDraft}
          onNew={newThought}
          onSubmit={submitPost}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}

// ── 发布想法 全窗口编辑器 ───────────────────────────────────────────────────────

const ThoughtComposer: React.FC<{
  title: string; setTitle: (v: string) => void;
  body: string; setBody: (v: string) => void;
  visibility: 0 | 1 | 2; setVisibility: (v: 0 | 1 | 2) => void;
  posting: boolean;
  drafts: Draft[];
  editingDraftId: string | null;
  draftFlash: string;
  onSaveDraft: () => void;
  onLoadDraft: (d: Draft) => void;
  onDeleteDraft: (id: string) => void;
  onNew: () => void;
  onSubmit: () => void;
  onClose: () => void;
}> = ({
  title, setTitle, body, setBody, visibility, setVisibility, posting,
  drafts, editingDraftId, draftFlash,
  onSaveDraft, onLoadDraft, onDeleteDraft, onNew, onSubmit, onClose,
}) => {
  // Esc 关闭（保留临时内容，下次打开自动恢复）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canPublish = !!title.trim() && !!body.trim() && !posting;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20,28,16,0.42)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{
        width: "min(1120px, 95vw)", height: "min(86vh, 820px)",
        background: BG, borderRadius: 12, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid rgba(0,0,0,0.07)",
          background: NAV_COLOR,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>发布想法</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              一个更从容地写下长篇思考的地方
            </span>
          </div>
          <button
            onClick={onClose}
            title="关闭（内容会自动暂存）"
            style={{
              background: "rgba(255,255,255,0.12)", color: "#fff",
              border: "none", borderRadius: 6, width: 28, height: 28,
              cursor: "pointer", fontSize: 16, lineHeight: "28px",
            }}
          >×</button>
        </div>

        {/* Body: editor + draft box */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Editor */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "22px 30px", minWidth: 0 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题（必填）—— 将作为帖子的一楼展示"
              autoFocus
              style={{
                width: "100%", border: "none", outline: "none", background: "transparent",
                fontSize: 24, fontWeight: 600, color: "#1a1a1a",
                padding: "2px 0", boxSizing: "border-box",
              }}
            />
            <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "14px 0 16px" }} />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="在这里写下你的思考……（将作为正文，置于二楼）"
              style={{
                flex: 1, width: "100%", border: "none", outline: "none", background: "transparent",
                fontSize: 15, lineHeight: 1.85, color: "#2a2a2a",
                resize: "none", fontFamily: "inherit", boxSizing: "border-box",
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(); }}
            />
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 6 }}>
              {body.length} 字 · ⌘/Ctrl + ↵ 发布
            </div>
          </div>

          {/* Draft box */}
          <div style={{
            width: 290, flexShrink: 0, borderLeft: "1px solid rgba(0,0,0,0.07)",
            background: "rgba(255,255,255,0.5)",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px 8px",
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>草稿箱</span>
              <span style={{ fontSize: 11, color: "#aaa" }}>{drafts.length} 篇</span>
            </div>

            <div style={{ display: "flex", gap: 6, padding: "0 16px 10px" }}>
              <button
                onClick={onSaveDraft}
                disabled={!title.trim() && !body.trim()}
                style={{
                  flex: 1, fontSize: 12, padding: "6px 0",
                  background: NAV_COLOR, color: "#fff", border: "none",
                  borderRadius: 5, cursor: (!title.trim() && !body.trim()) ? "default" : "pointer",
                  opacity: (!title.trim() && !body.trim()) ? 0.4 : 1,
                }}
              >{editingDraftId ? "更新草稿" : "存为草稿"}</button>
              <button
                onClick={onNew}
                title="清空当前内容，开始一篇新想法"
                style={{
                  fontSize: 12, padding: "6px 10px",
                  background: "none", border: "1px solid #ddd",
                  borderRadius: 5, cursor: "pointer", color: "#666",
                }}
              >新建</button>
            </div>

            <div style={{ minHeight: 16, padding: "0 16px" }}>
              {draftFlash && (
                <span style={{ fontSize: 11, color: NAV_COLOR }}>{draftFlash}</span>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "6px 12px 16px" }}>
              {drafts.length === 0 ? (
                <div style={{ fontSize: 11, color: "#bbb", textAlign: "center", padding: "30px 8px" }}>
                  暂无草稿。<br />写到一半可「存为草稿」，稍后回来继续。
                </div>
              ) : (
                drafts.map((d) => {
                  const active = d.id === editingDraftId;
                  const preview = (d.title.trim() || d.body.trim() || "（空白草稿）").slice(0, 40);
                  const sub = d.title.trim() && d.body.trim() ? d.body.trim().slice(0, 48) : "";
                  return (
                    <div
                      key={d.id}
                      onClick={() => onLoadDraft(d)}
                      style={{
                        position: "relative", cursor: "pointer",
                        padding: "9px 28px 9px 10px", marginBottom: 6,
                        background: active ? "rgba(25,45,16,0.10)" : "rgba(255,255,255,0.7)",
                        border: `1px solid ${active ? NAV_COLOR : "rgba(0,0,0,0.06)"}`,
                        borderRadius: 6,
                      }}
                    >
                      <div style={{
                        fontSize: 12.5, fontWeight: 600, color: "#222",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{preview}</div>
                      {sub && (
                        <div style={{
                          fontSize: 11, color: "#888", marginTop: 2,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{sub}</div>
                      )}
                      <div style={{ fontSize: 10, color: "#bbb", marginTop: 3 }}>{relativeTime(new Date(d.savedAt).toISOString())}</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteDraft(d.id); }}
                        title="删除草稿"
                        style={{
                          position: "absolute", top: 6, right: 6,
                          background: "none", border: "none", cursor: "pointer",
                          color: "#bbb", fontSize: 14, lineHeight: 1, padding: 2,
                        }}
                      >×</button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 24px", borderTop: "1px solid rgba(0,0,0,0.07)",
        }}>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                fontSize: 13, padding: "7px 16px",
                background: "none", border: "1px solid #ddd",
                borderRadius: 6, cursor: "pointer", color: "#666",
              }}
            >取消</button>
            <button
              onClick={onSubmit}
              disabled={!canPublish}
              style={{
                fontSize: 13, padding: "7px 22px",
                background: NAV_COLOR, color: "#fff", border: "none",
                borderRadius: 6, cursor: canPublish ? "pointer" : "default",
                opacity: canPublish ? 1 : 0.5,
              }}
            >{posting ? "发布中…" : "发布想法"}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Group row component ──────────────────────────────────────────────────────

const GroupRow: React.FC<{
  label: string;
  count: number | null;
  active: boolean;
  isDefault?: boolean;
  onClick: () => void;
}> = ({ label, count, active, isDefault, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "6px 8px",
        background: active ? "rgba(25,45,16,0.10)" : hovered ? "rgba(0,0,0,0.04)" : "transparent",
        border: "none",
        borderLeft: active ? `2px solid ${NAV_COLOR}` : "2px solid transparent",
        borderRadius: 3,
        cursor: "pointer",
        textAlign: "left",
        fontSize: 12,
        color: active ? NAV_COLOR : "#444",
        fontWeight: active ? 600 : 400,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {isDefault && <span style={{ fontSize: 9, color: "#aaa" }}>默</span>}
      </span>
      {count !== null && (
        <span style={{ fontSize: 11, color: "#aaa" }}>{count}</span>
      )}
    </button>
  );
};
