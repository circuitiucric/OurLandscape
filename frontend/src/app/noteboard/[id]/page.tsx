"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import * as pdfjsLib from "pdfjs-dist";
import TopNav from "../../components/TopNav";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ── Constants ─────────────────────────────────────────────────────────────────

const COLS = 120;
const CELL = 24;        // px per cell at zoom=1
const GROUP_GAP = 64;   // px between groups at zoom=1
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Item {
  id: number;
  item_type: "pdf" | "thread" | "annotation" | "video" | "webpage" | "text_note";
  resource_id: number | null;
  resource_identifier: string | null;
  text_content: string | null;
  title: string | null;
  status: "pending" | "deployed";
  group_index: number;
  col: number;
  row_index: number;
  w: number;
  h: number;
  reading_progress: Record<string, unknown> | null;
  note_text: string | null;
  clip_id: number | null;
  locked: 0 | 1 | boolean;
  clip_dx: number;
  clip_dy: number;
}

interface Clip {
  id: number;
  source_board_id: number | null;
  source_user: string | null;
}

interface Connection {
  id: number;
  from_item_id: number;
  to_item_id: number;
  line_type: "straight" | "curved";
  label: string | null;
  ctrl_x: number | null;
  ctrl_y: number | null;
}

interface DragState {
  item: Item;
  offsetX: number;   // px from canvas origin to card left, at drag start
  offsetY: number;
  previewCol: number;
  previewRow: number;
  previewGroup: number;
}

interface PendingDragState {
  item?: Item;       // single pending item
  clip?: Clip;       // or a whole pending clip bundle
  label?: string;
  ghostX: number;  // viewport px
  ghostY: number;
}

// ── Card components ───────────────────────────────────────────────────────────

function PdfCard({ item, cell, onDragStart, onSizeChange }: {
  item: Item; cell: number;
  onDragStart: (e: React.MouseEvent, item: Item) => void;
  onSizeChange: (id: number, w: number, h: number) => void;
}) {
  const w = item.w * cell;
  const h = item.h * cell;
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const identifier = item.resource_identifier;
    if (!identifier) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(`http://localhost:3001/pdf/${identifier}`).promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const cv = cvRef.current;
        if (!cv) return;
        const natural = page.getViewport({ scale: 1 });

        // Snap to closest grid ratio: base width 3.75 (在 5 格基础上长宽各缩小约 1/4)
        // 网格为整数格，故四舍五入
        const ratio = natural.height / natural.width;
        const baseW = 3.75;
        const snapW = Math.round(baseW);
        const snapH = Math.max(3, Math.min(15, Math.round(baseW * ratio)));
        if (item.w !== snapW || item.h !== snapH) {
          onSizeChange(item.id, snapW, snapH);
        }

        // Render thumbnail once at ≤600px wide — CSS will stretch to fill the card
        const thumbScale = Math.min(1, 600 / natural.width);
        const vp = page.getViewport({ scale: thumbScale });
        cv.width  = vp.width;
        cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [item.resource_identifier]); // zoom/size changes → only CSS rescale, no re-render

  return (
    <div onMouseDown={e => onDragStart(e, item)} style={{ width: w, height: h, position: "relative", cursor: "grab" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#e8e4dc",
        borderRadius: 3,
        border: "1px solid #c8c4bc",
        boxShadow: "1px 2px 8px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}>
        {item.resource_identifier ? (
          // width:100% height:100% stretches canvas pixels to fill card exactly
          <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/NoteBoard_style/PDF-笔记状态.png" alt=""
              style={{ width: "60%", height: "80%", objectFit: "contain", opacity: 0.55 }}
              draggable={false} />
          </div>
        )}
      </div>
      {item.title && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          paddingTop: 3, fontSize: Math.max(9, cell * 0.42),
          color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          pointerEvents: "none", userSelect: "none",
        }}>
          {item.title}
        </div>
      )}
    </div>
  );
}

function VideoCard({ item, cell, onDragStart }: {
  item: Item; cell: number; onDragStart: (e: React.MouseEvent, item: Item) => void;
}) {
  const w = item.w * cell;
  const h = item.h * cell;
  const vidRef = useRef<HTMLVideoElement>(null);
  const identifier = item.resource_identifier;

  // 归类时记录的时间点，用作封面帧
  const coverTime = (() => {
    const raw = item.reading_progress;
    const rp = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw || {});
    const t = (rp as Record<string, unknown>).videoTime;
    return typeof t === "number" && t > 0 ? t : 0.5;
  })();

  return (
    <div onMouseDown={e => onDragStart(e, item)} style={{ width: w, height: h, position: "relative", cursor: "grab" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#1a1a2e",
        borderRadius: 3,
        border: "1px solid #333",
        boxShadow: "1px 2px 8px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
        position: "relative",
      }}>
        {identifier ? (
          <video
            ref={vidRef}
            src={`http://localhost:3001/video/${identifier}`}
            muted
            preload="metadata"
            onLoadedMetadata={() => { const v = vidRef.current; if (v) { try { v.currentTime = coverTime; } catch {} } }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        ) : (
          <img
            src="/NoteBoard_style/视频-笔记状态.png"
            alt=""
            style={{ width: "55%", height: "60%", objectFit: "contain", opacity: 0.75 }}
            draggable={false}
          />
        )}
        {/* 播放角标 */}
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: cell * 1.4, height: cell * 1.4, borderRadius: "50%",
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <svg width={cell * 0.7} height={cell * 0.7} viewBox="0 0 24 24" fill="#fff"><polygon points="6 4 20 12 6 20 6 4" /></svg>
        </div>
      </div>
      {item.title && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0, right: 0,
          paddingTop: 3,
          fontSize: Math.max(9, cell * 0.42),
          color: "#333",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          pointerEvents: "none", userSelect: "none",
        }}>
          {item.title}
        </div>
      )}
    </div>
  );
}

function IconNameCard({ item, cell, onDragStart }: {
  item: Item; cell: number; onDragStart: (e: React.MouseEvent, item: Item) => void;
}) {
  const w = item.w * cell;
  const h = item.h * cell;
  const iconSrc = item.item_type === "thread"
    ? "/NoteBoard_style/帖子图标.png"
    : "/NoteBoard_style/网页标识-笔记状态.png";
  return (
    <div
      onMouseDown={e => onDragStart(e, item)}
      style={{
        width: w, height: h, cursor: "grab",
        background: "#fff",
        borderRadius: 6,
        border: "1px solid #ddd",
        boxShadow: "0 1px 5px rgba(0,0,0,0.1)",
        display: "flex", alignItems: "center",
        padding: `0 ${cell * 0.35}px`,
        gap: cell * 0.3,
        overflow: "hidden",
      }}
    >
      <img
        src={iconSrc} alt=""
        style={{ width: cell * 1, height: cell * 2, objectFit: "contain", flexShrink: 0 }}
        draggable={false}
      />
      <span style={{
        fontSize: Math.max(10, cell * 0.52),
        color: "#333",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {item.title || (item.item_type === "thread" ? "无标题帖子" : "外部链接")}
      </span>
    </div>
  );
}

// Annotation card — auto-resizes with text content
function AnnotationCard({ item, cell, onDragStart, onHeightChange, readOnly }: {
  item: Item; cell: number;
  onDragStart: (e: React.MouseEvent, item: Item) => void;
  onHeightChange: (id: number, newH: number, text: string) => void;
  readOnly?: boolean;
}) {
  const w = item.w * cell;
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    const newH = Math.max(item.h, Math.ceil((ta.scrollHeight + cell * 1.2) / cell));
    if (newH !== item.h) onHeightChange(item.id, newH, ta.value);
  };

  return (
    <div
      onMouseDown={e => { if ((e.target as HTMLElement).tagName !== "TEXTAREA") onDragStart(e, item); }}
      style={{
        width: w, minHeight: item.h * cell,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 10px rgba(0,0,0,0.13)",
        border: "1px solid #eee",
        display: "flex", flexDirection: "column",
        cursor: "grab",
      }}
    >
      <div style={{ padding: `${cell * 0.2}px ${cell * 0.3}px 0`, display: "flex", justifyContent: "flex-end" }}>
        <span style={{ fontSize: Math.max(9, cell * 0.38), color: "#aaa" }}>用户名</span>
      </div>
      <textarea
        ref={taRef}
        defaultValue={item.text_content ?? ""}
        onInput={autoResize}
        onMouseDown={e => { if (!readOnly) e.stopPropagation(); }}
        readOnly={readOnly}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          border: "none", outline: "none",
          background: "transparent",
          padding: `${cell * 0.15}px ${cell * 0.3}px`,
          fontSize: Math.max(10, cell * 0.5),
          color: "#333",
          lineHeight: 1.55,
          fontFamily: "inherit",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

// Text note — immutable display card; content is set at creation and cannot be changed
function TextNoteCard({ item, cell, onDragStart }: {
  item: Item; cell: number;
  onDragStart: (e: React.MouseEvent, item: Item) => void;
}) {
  const handleH = Math.max(8, cell * 0.35);
  return (
    <div style={{ width: item.w * cell, minHeight: item.h * cell, display: "flex", flexDirection: "column" }}>
      <div
        onMouseDown={e => onDragStart(e, item)}
        style={{
          height: handleH, flexShrink: 0,
          background: "rgba(90,138,90,0.15)",
          borderRadius: "3px 3px 0 0",
          cursor: "grab",
        }}
      />
      <div
        onMouseDown={e => onDragStart(e, item)}
        style={{
          flex: 1, padding: `${cell * 0.15}px ${cell * 0.3}px`,
          fontSize: Math.max(11, cell * 0.55),
          color: "#222", lineHeight: 1.65,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          userSelect: "none", cursor: "grab",
          minHeight: item.h * cell - handleH,
        }}>
        {item.text_content ?? ""}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NoteboardPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  const [title, setTitle] = useState("笔记板");
  const [allBoards, setAllBoards] = useState<{ id: number; title: string }[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingDrag, setPendingDrag] = useState<PendingDragState | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<Item | null>(null);
  const [lineType, setLineType] = useState<"straight" | "curved">("straight");
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState<string | null>(null);

  // Ownership / sharing
  const [editable, setEditable] = useState(true);   // current user owns this board
  const [denied, setDenied] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [resourceId, setResourceId] = useState<number | null>(null);

  // Rubber-band selection (only when viewing someone else's board)
  const [selRect, setSelRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showCopyPanel, setShowCopyPanel] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const selDragRef = useRef<{ x0: number; y0: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  // Refs so global event handlers always see fresh values without stale closures
  const pendingDragRef = useRef<PendingDragState | null>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const connectModeRef = useRef(false);
  useEffect(() => { connectModeRef.current = connectMode; }, [connectMode]);
  const connClickTimerRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const ctrlDragRef = useRef<{
    connId: number; startMx: number; startMy: number; startCtrlX: number; startCtrlY: number;
  } | null>(null);
  const connectionsRef = useRef<Connection[]>([]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  const idRef = useRef(id);
  useEffect(() => { idRef.current = id; }, [id]);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = { Authorization: `Bearer ${token}` };
  const API = "http://localhost:3001";

  // Current user's name decoded from the JWT (authoritative for the ownership UI)
  const currentUser = (() => {
    if (!token) return null;
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      return payload.userName ?? null;
    } catch { return null; }
  })();

  // ── Fetch ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    if (!token) { router.push("/login"); return; }
    Promise.all([
      axios.get(`${API}/api/noteboards/${id}`, { headers }),
      axios.get(`${API}/api/noteboards`, { headers }),
    ]).then(([bRes, listRes]) => {
      setTitle(bRes.data.title);
      setItems(bRes.data.items ?? []);
      setConnections(bRes.data.connections ?? []);
      setClips(bRes.data.clips ?? []);
      // Trust a name comparison over the backend flag, so own boards are always
      // editable even if the server hasn't been restarted with the new field.
      const owner = bRes.data.user_name ?? null;
      setEditable(
        owner != null && currentUser != null
          ? owner === currentUser
          : !!bRes.data.editable
      );
      setOwnerName(owner);
      setIsPublic(!!bRes.data.is_public);
      setResourceId(bRes.data.resource_id ?? null);
      setAllBoards(listRes.data);
    }).catch(err => {
      const s = err?.response?.status;
      if (s === 401) {
        localStorage.removeItem("token");
        router.push("/login");
      } else if (s === 403 || s === 404) {
        setDenied(true);
      }
    })
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line

  // ── Periodically bump the last-browse timestamp while the board is open ──────
  // The initial view is recorded server-side on GET; this keeps 动态历史 fresh
  // (mirrors the PDF viewer's 30s autosave) so the most-recently-open board
  // sorts to the front of the browsing history.
  useEffect(() => {
    if (!resourceId || !token) return;
    const ping = () => {
      axios.post(
        `${API}/api/resources/${resourceId}/history`,
        { pageNumber: 1, progressPercent: 0 },
        { headers }
      ).catch(() => {});
    };
    const interval = setInterval(ping, 30_000);
    return () => clearInterval(interval);
  }, [resourceId]); // eslint-disable-line

  // ── Zoom via Ctrl+scroll ────────────────────────────────────────────────────

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.001)));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ── Ctrl-point drag ────────────────────────────────────────────────────────

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = ctrlDragRef.current;
      if (!state) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left + canvas.scrollLeft;
      const my = e.clientY - rect.top  + canvas.scrollTop;
      const cellZ = CELL * zoomRef.current;
      const newCtrlX = state.startCtrlX + (mx - state.startMx) / cellZ;
      const newCtrlY = state.startCtrlY + (my - state.startMy) / cellZ;
      setConnections(prev => prev.map(c =>
        c.id === state.connId ? { ...c, ctrl_x: newCtrlX, ctrl_y: newCtrlY } : c
      ));
    };
    const onUp = () => {
      const state = ctrlDragRef.current;
      if (!state) return;
      ctrlDragRef.current = null;
      const conn = connectionsRef.current.find(c => c.id === state.connId);
      if (!conn || conn.ctrl_x == null) return;
      const tk = localStorage.getItem("token");
      axios.patch(
        `http://localhost:3001/api/noteboards/${idRef.current}/connections/${conn.id}`,
        { ctrl_x: conn.ctrl_x, ctrl_y: conn.ctrl_y },
        { headers: { Authorization: `Bearer ${tk}` } }
      ).catch(console.error);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",  onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",  onUp);
    };
  }, []); // eslint-disable-line

  // ── Pending-area → canvas drag ─────────────────────────────────────────────

  const onPendingDragStart = (e: React.MouseEvent, item: Item) => {
    e.preventDefault();
    const state: PendingDragState = { item, ghostX: e.clientX, ghostY: e.clientY };
    pendingDragRef.current = state;
    setPendingDrag(state);
  };

  const onPendingClipDragStart = (e: React.MouseEvent, clip: Clip, label: string) => {
    e.preventDefault();
    const state: PendingDragState = { clip, label, ghostX: e.clientX, ghostY: e.clientY };
    pendingDragRef.current = state;
    setPendingDrag(state);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!pendingDragRef.current) return;
      const next = { ...pendingDragRef.current, ghostX: e.clientX, ghostY: e.clientY };
      pendingDragRef.current = next;
      setPendingDrag(next);
    };

    const onUp = async (e: MouseEvent) => {
      const pd = pendingDragRef.current;
      if (!pd) return;
      pendingDragRef.current = null;
      setPendingDrag(null);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Only deploy if released over the canvas area
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;

      const z = zoomRef.current;
      const cellZ = CELL * z;
      const stride = COLS * cellZ + GROUP_GAP * z;
      const canvasX = e.clientX - rect.left + canvas.scrollLeft;
      const canvasY = e.clientY - rect.top  + canvas.scrollTop;

      const token = localStorage.getItem("token");
      const deployHeaders = { Authorization: `Bearer ${token}` };

      const gi     = Math.max(0, Math.floor(canvasX / stride));
      const localX = canvasX - gi * stride;
      const row    = Math.max(0, Math.round(canvasY / cellZ));

      // ── Whole-clip deploy ──
      if (pd.clip) {
        const baseCol = Math.max(0, Math.round(localX / cellZ));
        setItems(prev => prev.map(i => i.clip_id === pd.clip!.id
          ? { ...i, status: "deployed", group_index: gi, col: baseCol + i.clip_dx, row_index: row + i.clip_dy }
          : i
        ));
        axios.patch(
          `http://localhost:3001/api/noteboards/${id}/clips/${pd.clip.id}/deploy`,
          { group_index: gi, col: baseCol, row },
          { headers: deployHeaders }
        ).catch(err => {
          console.error("Clip deploy failed", err);
          setItems(prev => prev.map(i => i.clip_id === pd.clip!.id
            ? { ...i, status: "pending" } : i
          ));
        });
        return;
      }

      const col    = Math.max(0, Math.min(COLS - pd.item!.w, Math.round(localX / cellZ)));

      // Optimistic update
      setItems(prev => prev.map(i => i.id === pd.item!.id
        ? { ...i, status: "deployed", group_index: gi, col, row_index: row }
        : i
      ));

      axios.patch(
        `http://localhost:3001/api/noteboards/${id}/items/${pd.item!.id}/deploy`,
        { group_index: gi, col, row_index: row },
        { headers: deployHeaders }
      ).catch(err => {
        console.error("Deploy failed", err);
        setItems(prev => prev.map(i => i.id === pd.item!.id
          ? { ...i, status: "pending" } : i
        ));
      });

      // Auto-deploy connected text note if note_text was set at classify time
      if (pd.item!.note_text) {
        const noteCol = Math.min(COLS - 4, col + pd.item!.w + 1);
        (async () => {
          try {
            const { data: noteItem } = await axios.post(
              `http://localhost:3001/api/noteboards/${id}/items`,
              { item_type: "text_note", w: 4, h: 2, text_content: pd.item!.note_text },
              { headers: deployHeaders }
            );
            await axios.patch(
              `http://localhost:3001/api/noteboards/${id}/items/${noteItem.id}/deploy`,
              { group_index: gi, col: noteCol, row_index: row },
              { headers: deployHeaders }
            );
            const { data: conn } = await axios.post(
              `http://localhost:3001/api/noteboards/${id}/connections`,
              { from_item_id: pd.item!.id, to_item_id: noteItem.id, line_type: "straight" },
              { headers: deployHeaders }
            );
            setItems(prev => [...prev, {
              ...noteItem, status: "deployed" as const,
              group_index: gi, col: noteCol, row_index: row,
              reading_progress: null, note_text: null,
            }]);
            setConnections(prev => [...prev, {
              id: conn.id, from_item_id: pd.item!.id, to_item_id: noteItem.id,
              line_type: "straight" as const, label: null, ctrl_x: null, ctrl_y: null,
            }]);
          } catch (err) { console.error("auto note-deploy failed", err); }
        })();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [id]); // eslint-disable-line

  // ── Grid helpers ────────────────────────────────────────────────────────────

  const cellPx = CELL * zoom;
  const groupW = COLS * cellPx;
  const groupStride = groupW + GROUP_GAP * zoom;

  const itemLeft = (item: Item) => item.group_index * groupStride + item.col * cellPx;
  const itemTop  = (item: Item) => item.row_index * cellPx;

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const onCardDoubleClick = (item: Item) => {
    // MySQL2 may return JSON columns as strings — parse defensively
    const raw = item.reading_progress;
    const rp: Record<string, unknown> = (() => {
      if (!raw) return {};
      if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
      return raw as Record<string, unknown>;
    })();

    if (item.item_type === "pdf" && item.resource_identifier) {
      const page = (rp.pageNumber as number) ?? 1;
      const pdfY = rp.pdfY as number | undefined;
      const url = `/pdf-viewer?file=${encodeURIComponent(item.resource_identifier)}&page=${page}`
        + (pdfY != null ? `&pdfY=${pdfY}` : "");
      router.push(url);
    } else if (item.item_type === "video" && item.resource_identifier) {
      const t = Math.floor((rp.videoTime as number) ?? 0);
      router.push(`/video-viewer?file=${encodeURIComponent(item.resource_identifier)}&t=${t}`);
    } else if (item.item_type === "annotation") {
      if (rp.pdfFile) {
        router.push(`/pdf-viewer?file=${encodeURIComponent(rp.pdfFile as string)}&page=${(rp.pageNumber as number) ?? 1}`);
      } else if (rp.threadId) {
        router.push(`/threads/${rp.threadId}`);
      }
    } else if (item.item_type === "thread") {
      // rp.threadId is always the parent thread ID.
      // item.resource_id is reply.id for floors (NOT thread.id), so only use it
      // as fallback when there is no replyId (i.e. the item is a main post).
      const threadId = (rp.threadId as number | undefined)
        ?? (rp.replyId ? null : item.resource_id);
      if (!threadId) return;
      const url = `/threads/${threadId}`;
      router.push(rp.replyId ? `${url}#reply-${rp.replyId}` : url);
    }
  };

  const onDragStart = (e: React.MouseEvent, item: Item) => {
    if (!editable) return;        // can't move cards on someone else's board
    if (item.status !== "deployed") return;
    if (e.detail >= 2) return; // 双击不触发拖拽
    if (connectModeRef.current) return; // 连线模式不触发拖拽
    e.preventDefault();
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + canvas.scrollLeft;
    const my = e.clientY - rect.top  + canvas.scrollTop;
    setDrag({
      item,
      offsetX: mx - itemLeft(item),
      offsetY: my - itemTop(item),
      previewCol:   item.col,
      previewRow:   item.row_index,
      previewGroup: item.group_index,
    });
  };

  // Items intersecting the rubber-band rectangle (canvas coords)
  const computeSelected = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const minx = Math.min(r.x0, r.x1), maxx = Math.max(r.x0, r.x1);
    const miny = Math.min(r.y0, r.y1), maxy = Math.max(r.y0, r.y1);
    return items.filter(i => {
      if (i.status !== "deployed") return false;
      const L = itemLeft(i), T = itemTop(i);
      const R = L + i.w * cellPx, B = T + i.h * cellPx;
      return L < maxx && R > minx && T < maxy && B > miny;
    }).map(i => i.id);
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (editable) return;          // rubber-band only when viewing others' boards
    if (e.button !== 0) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + canvas.scrollLeft;
    const y = e.clientY - rect.top  + canvas.scrollTop;
    selDragRef.current = { x0: x, y0: y };
    setSelRect({ x0: x, y0: y, x1: x, y1: y });
    setSelectedIds([]);
    setShowCopyPanel(false);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    // Rubber-band selection (read-only boards)
    if (selDragRef.current) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + canvas.scrollLeft;
      const y = e.clientY - rect.top  + canvas.scrollTop;
      const r = { x0: selDragRef.current.x0, y0: selDragRef.current.y0, x1: x, y1: y };
      setSelRect(r);
      setSelectedIds(computeSelected(r));
      return;
    }
    if (!drag) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + canvas.scrollLeft;
    const my = e.clientY - rect.top  + canvas.scrollTop;
    const rawX = mx - drag.offsetX;
    const rawY = my - drag.offsetY;

    const gi    = Math.max(0, Math.floor(rawX / groupStride));
    const localX = rawX - gi * groupStride;
    const col   = Math.max(0, Math.min(COLS - drag.item.w, Math.round(localX / cellPx)));
    const row   = Math.max(0, Math.round(rawY / cellPx));

    setDrag(d => d ? { ...d, previewCol: col, previewRow: row, previewGroup: gi } : null);
  };

  const onMouseUp = async () => {
    if (selDragRef.current) {
      selDragRef.current = null;
      setSelRect(null);
      if (selectedIds.length > 0) setShowCopyPanel(true);
      return;
    }
    if (!drag) return;
    const { item, previewCol, previewRow, previewGroup } = drag;
    setDrag(null);
    if (previewCol === item.col && previewRow === item.row_index && previewGroup === item.group_index) return;

    // Locked clip item → move the whole clip as a group
    if (item.clip_id != null) {
      const baseCol = previewCol - item.clip_dx;
      const baseRow = previewRow - item.clip_dy;
      setItems(prev => prev.map(i => i.clip_id === item.clip_id
        ? { ...i, group_index: previewGroup, col: baseCol + i.clip_dx, row_index: baseRow + i.clip_dy }
        : i
      ));
      axios.patch(`${API}/api/noteboards/${id}/clips/${item.clip_id}/deploy`,
        { group_index: previewGroup, col: baseCol, row: baseRow },
        { headers }
      ).catch(console.error);
      return;
    }

    setItems(prev => prev.map(i => i.id === item.id
      ? { ...i, col: previewCol, row_index: previewRow, group_index: previewGroup }
      : i
    ));
    axios.put(`${API}/api/noteboards/${id}/items/${item.id}`,
      { col: previewCol, row_index: previewRow, group_index: previewGroup },
      { headers }
    ).catch(console.error);
  };

  // Copy the current framed selection into one of the user's own boards (as a pending clip)
  const copySelection = async (targetBoardId: number) => {
    const sel = items.filter(i => i.status === "deployed" && selectedIds.includes(i.id));
    if (sel.length === 0) return;
    const minLeft = Math.min(...sel.map(itemLeft));
    const minTop  = Math.min(...sel.map(itemTop));
    const itemsPayload = sel.map(i => ({
      src_id: i.id, item_type: i.item_type, resource_id: i.resource_id,
      text_content: i.text_content, title: i.title, w: i.w, h: i.h,
      reading_progress: i.reading_progress,
      clip_dx: Math.round((itemLeft(i) - minLeft) / cellPx),
      clip_dy: Math.round((itemTop(i)  - minTop)  / cellPx),
    }));
    const idset = new Set(selectedIds);
    const connPayload = connections
      .filter(c => idset.has(c.from_item_id) && idset.has(c.to_item_id))
      .map(c => ({ from_src_id: c.from_item_id, to_src_id: c.to_item_id, line_type: c.line_type, label: c.label }));
    try {
      await axios.post(`${API}/api/noteboards/${targetBoardId}/clips`,
        { source_board_id: Number(id), items: itemsPayload, connections: connPayload },
        { headers }
      );
      setCopyMsg("已复制到该笔记板的待部署区");
      setSelectedIds([]); setShowCopyPanel(false);
      setTimeout(() => setCopyMsg(null), 2800);
    } catch {
      setCopyMsg("复制失败");
      setTimeout(() => setCopyMsg(null), 2800);
    }
  };

  const deleteClip = (clipId: number) => {
    setItems(prev => prev.filter(i => i.clip_id !== clipId));
    setClips(prev => prev.filter(c => c.id !== clipId));
    axios.delete(`${API}/api/noteboards/${id}/clips/${clipId}`, { headers }).catch(console.error);
  };

  // ── Auto-resize callbacks ───────────────────────────────────────────────────

  const onHeightChange = (itemId: number, newH: number, text: string) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, h: newH, text_content: text } : i));
    axios.put(`${API}/api/noteboards/${id}/items/${itemId}`,
      { h: newH, text_content: text },
      { headers }
    ).catch(console.error);
  };

  const onPdfSizeChange = (itemId: number, newW: number, newH: number) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, w: newW, h: newH } : i));
    axios.put(`${API}/api/noteboards/${id}/items/${itemId}`,
      { w: newW, h: newH },
      { headers }
    ).catch(console.error);
  };

  // ── New-feature handlers ────────────────────────────────────────────────────

  const addTextNote = async (text: string) => {
    if (!text.trim()) return;
    const canvas = canvasRef.current;
    const z = zoom;
    const cellZ = CELL * z;
    const stride = COLS * cellZ + GROUP_GAP * z;
    const cx = canvas ? canvas.scrollLeft + canvas.clientWidth / 2 : 0;
    const cy = canvas ? canvas.scrollTop + canvas.clientHeight / 2 : 0;
    const gi  = Math.max(0, Math.floor(cx / stride));
    const col = Math.max(0, Math.min(COLS - 4, Math.round((cx - gi * stride) / cellZ)));
    const row = Math.max(0, Math.round(cy / cellZ));
    const tk = localStorage.getItem("token");
    try {
      const { data: newItem } = await axios.post(
        `${API}/api/noteboards/${id}/items`,
        { item_type: "text_note", w: 4, h: 2, text_content: text.trim() },
        { headers: { Authorization: `Bearer ${tk}` } }
      );
      await axios.patch(
        `${API}/api/noteboards/${id}/items/${newItem.id}/deploy`,
        { group_index: gi, col, row_index: row },
        { headers: { Authorization: `Bearer ${tk}` } }
      );
      setItems(prev => [...prev, { ...newItem, status: "deployed" as const, group_index: gi, col, row_index: row, reading_progress: null, note_text: null }]);
    } catch (err) { console.error("addTextNote failed", err); }
  };

  const removeItem = (itemId: number) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
    setConnections(prev => prev.filter(c => c.from_item_id !== itemId && c.to_item_id !== itemId));
    const tk = localStorage.getItem("token");
    axios.delete(`${API}/api/noteboards/${id}/items/${itemId}`, {
      headers: { Authorization: `Bearer ${tk}` },
    }).catch(console.error);
  };

  const handleCardConnectClick = async (item: Item) => {
    if (!connectFrom) { setConnectFrom(item); return; }
    if (connectFrom.id === item.id) { setConnectFrom(null); return; }
    const from = connectFrom;
    setConnectFrom(null);
    const tk = localStorage.getItem("token");
    try {
      const { data } = await axios.post(
        `${API}/api/noteboards/${id}/connections`,
        { from_item_id: from.id, to_item_id: item.id, line_type: lineType },
        { headers: { Authorization: `Bearer ${tk}` } }
      );
      setConnections(prev => [...prev, {
        id: data.id, from_item_id: from.id, to_item_id: item.id,
        line_type: lineType, label: null, ctrl_x: null, ctrl_y: null,
      }]);
    } catch (err) { console.error("connect failed", err); }
  };

  const removeConnection = (connId: number) => {
    setConnections(prev => prev.filter(c => c.id !== connId));
    const tk = localStorage.getItem("token");
    axios.delete(`${API}/api/noteboards/${id}/connections/${connId}`, {
      headers: { Authorization: `Bearer ${tk}` },
    }).catch(console.error);
  };

  const toggleConnectionCurve = (conn: Connection) => {
    const newType = conn.line_type === "straight" ? "curved" : "straight";
    setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, line_type: newType } : c));
    const tk = localStorage.getItem("token");
    axios.patch(
      `${API}/api/noteboards/${id}/connections/${conn.id}`,
      { line_type: newType },
      { headers: { Authorization: `Bearer ${tk}` } }
    ).catch(console.error);
  };

  const onConnectionClick = (e: React.MouseEvent, conn: Connection) => {
    if (!connectModeRef.current) return; // 仅在“编辑连线”状态允许修改连线
    e.stopPropagation();
    const timers = connClickTimerRef.current;
    if (timers.has(conn.id)) {
      clearTimeout(timers.get(conn.id)!);
      timers.delete(conn.id);
      removeConnection(conn.id);
    } else {
      timers.set(conn.id, setTimeout(() => {
        timers.delete(conn.id);
        toggleConnectionCurve(conn);
      }, 280));
    }
  };

  // ── Canvas dimensions ───────────────────────────────────────────────────────

  const deployed = items.filter(i => i.status === "deployed");
  const pending  = items.filter(i => i.status === "pending");

  // Bounding box (canvas px) of each clip's deployed items, for the watermark frame
  const clipBoxes = clips.map(clip => {
    const its = deployed.filter(i => i.clip_id === clip.id);
    if (its.length === 0) return null;
    const x0 = Math.min(...its.map(itemLeft));
    const y0 = Math.min(...its.map(itemTop));
    const x1 = Math.max(...its.map(i => itemLeft(i) + i.w * cellPx));
    const y1 = Math.max(...its.map(i => itemTop(i)  + i.h * cellPx));
    return { clip, x0, y0, x1, y1 };
  }).filter(Boolean) as { clip: Clip; x0: number; y0: number; x1: number; y1: number }[];

  // Pending clips → one entry per clip; plain pending items shown individually
  const pendingPlain = pending.filter(i => i.clip_id == null);
  const pendingClips = clips
    .map(clip => ({ clip, its: pending.filter(i => i.clip_id === clip.id) }))
    .filter(c => c.its.length > 0);

  const numGroups = deployed.length === 0 ? 1
    : Math.max(...deployed.map(i => i.group_index)) + 1;
  const maxRow = deployed.length === 0 ? 30
    : Math.max(...deployed.map(i => i.row_index + i.h)) + 15;

  const canvasW = numGroups * groupStride;
  const canvasH = maxRow * cellPx;

  // ── Connection SVG ──────────────────────────────────────────────────────────

  const itemMap = new Map(items.map(i => [i.id, i]));

  const cardCenter = (item: Item) => ({
    x: itemLeft(item) + (item.w / 2) * cellPx,
    y: itemTop(item)  + (item.h / 2) * cellPx,
  });

  // Returns the point on item's edge closest to `toward`
  const edgePoint = (item: Item, toward: { x: number; y: number }) => {
    const w  = item.w * cellPx;
    const h  = item.h * cellPx;
    const cx = itemLeft(item) + w / 2;
    const cy = itemTop(item)  + h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: cx, y: cy };
    const tx = Math.abs(dx) > 0.5 ? (w / 2) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 0.5 ? (h / 2) / Math.abs(dy) : Infinity;
    const t  = Math.min(tx, ty);
    return { x: cx + t * dx, y: cy + t * dy };
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // Button style replicated from public/NoteBoard_style/按钮样式.svg
  // (border only on top & bottom edges — no left/right border)
  const figmaBtn: React.CSSProperties = {
    padding: "9px 18px", fontSize: 13, borderRadius: 2,
    borderTop: "1px solid #6B8365", borderBottom: "1px solid #6B8365",
    borderLeft: "none", borderRight: "none",
    background: "rgba(12,13,12,0.03)",
    cursor: "pointer", color: "#3a4536",
    fontFamily: "inherit", lineHeight: 1,
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
      加载中…
    </div>
  );

  if (denied) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center",
      height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
      <div>该笔记板不存在或未公开，无法访问。</div>
      <button onClick={() => router.push("/noteboard")} style={figmaBtn}>返回我的笔记板</button>
    </div>
  );

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh",
      background: "#FFFEF7", fontFamily: "sans-serif", overflow: "hidden" }}>
      <TopNav />

      <div style={{ display: "flex", flex: 1, overflow: "hidden", marginTop: 78 }}>

        {/* ── Sidebar ── */}
        <div style={{
          width: 200, flexShrink: 0,
          background: "#546F4D", color: "#e8f0e8",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Board list */}
          <div style={{ padding: "14px 0 6px 12px", fontSize: 10, color: "#6a8a6a",
            fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>
            笔记板
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {allBoards.map(b => (
              <div key={b.id} onClick={() => router.push(`/noteboard/${b.id}`)} style={{
                padding: "7px 12px", cursor: "pointer", fontSize: 13,
                background: b.id === Number(id) ? "rgba(255,255,255,0.13)" : "transparent",
                color: b.id === Number(id) ? "#fff" : "#a0bca0",
                borderLeft: b.id === Number(id) ? "3px solid #7aba7a" : "3px solid transparent",
              }}>
                {b.title}
              </div>
            ))}
          </div>

        </div>

        {/* ── Canvas column ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Read-only banner when viewing another user's board */}
          {!editable && (
            <div style={{
              flexShrink: 0, padding: "7px 14px", fontSize: 12,
              background: "#eef3ea", borderBottom: "1px solid #d6e0cf", color: "#4a5d44",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>正在浏览 <b>@{ownerName ?? "他人"}</b> 的笔记板（只读）。按住鼠标左键框选资源即可复制到自己的笔记板。</span>
            </div>
          )}

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            style={{
              flex: 1, overflow: "auto",
              cursor: drag ? "grabbing" : (!editable ? "crosshair" : "default"),
              background: "#FFFEF7",
            }}
          >
            <div style={{ width: canvasW, height: canvasH, position: "relative" }}>

              {/* Group shading & labels */}
              {Array.from({ length: numGroups }, (_, gi) => (
                <div key={gi} style={{
                  position: "absolute",
                  left: gi * groupStride, top: 0,
                  width: groupW, height: canvasH,
                  background: gi % 2 === 0 ? "rgba(255,255,255,0.35)" : "transparent",
                  borderRight: `1.5px dashed #c0ccc0`,
                  pointerEvents: "none",
                }}>
                  <span style={{
                    position: "absolute", top: 6, left: 8,
                    fontSize: Math.max(9, cellPx * 0.38),
                    color: "#b0bdb0", userSelect: "none",
                  }}>
                    组 {gi + 1}
                  </span>
                </div>
              ))}

              {/* Deployed cards */}
              {deployed.map(item => {
                const isThis = drag?.item.id === item.id;
                const d = isThis
                  ? { ...item, col: drag!.previewCol, row_index: drag!.previewRow, group_index: drag!.previewGroup }
                  : item;
                const cardProps = { item: d, cell: cellPx, onDragStart };
                const isHovered = hoveredCardId === item.id;
                const isConnectFrom = connectFrom?.id === item.id;
                const isSelected = selectedIds.includes(item.id);
                const locked = !!item.locked;

                return (
                  <div key={item.id}
                    onDoubleClick={() => editable && !connectMode && onCardDoubleClick(item)}
                    onMouseEnter={() => setHoveredCardId(item.id)}
                    onMouseLeave={() => setHoveredCardId(null)}
                    style={{
                      position: "absolute",
                      left: itemLeft(d),
                      top:  itemTop(d),
                      zIndex: isThis ? 100 : 1,
                      opacity: isThis ? 0.82 : 1,
                      transition: isThis ? "none" : "left 0.08s, top 0.08s",
                      outline: isSelected
                        ? "2px solid #2b7de0"
                        : (isConnectFrom
                          ? "2px solid #7aba7a"
                          : (connectMode && isHovered ? "2px dashed #7aba7a" : "none")),
                      borderRadius: 4,
                    }}>
                    {/* Connect-mode click overlay — covers full card, reliable cursor + click */}
                    {editable && connectMode && (
                      <div
                        onClick={e => { e.stopPropagation(); handleCardConnectClick(item); }}
                        style={{
                          position: "absolute", inset: 0,
                          cursor: isConnectFrom ? "cell" : "crosshair",
                          zIndex: 150,
                          background: isConnectFrom ? "rgba(122,186,122,0.12)" : "transparent",
                        }}
                      />
                    )}
                    {/* ✕ remove button — owner only, non-locked, when not in connect mode */}
                    {editable && !locked && isHovered && !connectMode && (
                      <button
                        onClick={e => { e.stopPropagation(); removeItem(item.id); }}
                        onMouseDown={e => e.stopPropagation()}
                        style={{
                          position: "absolute", top: -8, right: -8,
                          width: 18, height: 18,
                          background: "#e55", color: "#fff",
                          border: "none", borderRadius: "50%",
                          fontSize: 11, lineHeight: "18px", textAlign: "center",
                          cursor: "pointer", zIndex: 200, padding: 0,
                        }}>
                        ✕
                      </button>
                    )}
                    {item.item_type === "pdf"       && <PdfCard {...cardProps} onSizeChange={onPdfSizeChange} />}
                    {item.item_type === "video"     && <VideoCard {...cardProps} />}
                    {(item.item_type === "thread" || item.item_type === "webpage") && <IconNameCard {...cardProps} />}
                    {item.item_type === "annotation" && (
                      <AnnotationCard {...cardProps} onHeightChange={onHeightChange} readOnly={locked || !editable} />
                    )}
                    {item.item_type === "text_note" && <TextNoteCard {...cardProps} />}
                  </div>
                );
              })}

              {/* Connection lines */}
              <svg style={{
                position: "absolute", top: 0, left: 0,
                width: canvasW, height: canvasH,
                zIndex: 50, pointerEvents: "none",
              }}>
                {connections.map(conn => {
                  const from = itemMap.get(conn.from_item_id);
                  const to   = itemMap.get(conn.to_item_id);
                  if (!from || !to) return null;
                  if (from.status !== "deployed" || to.status !== "deployed") return null;
                  const fc  = cardCenter(from);
                  const tc  = cardCenter(to);
                  const f   = edgePoint(from, tc);
                  const t   = edgePoint(to,   fc);
                  const sw  = Math.max(1, cellPx * 0.07);
                  const hitSw = Math.max(10, sw * 4);
                  const cpR   = Math.max(5, cellPx * 0.22);

                  if (conn.line_type === "curved") {
                    const defCtrlX = (f.x + t.x) / 2;
                    const defCtrlY = (f.y + t.y) / 2 - Math.abs(t.x - f.x) * 0.3;
                    const ctrlX = conn.ctrl_x != null ? conn.ctrl_x * cellPx : defCtrlX;
                    const ctrlY = conn.ctrl_y != null ? conn.ctrl_y * cellPx : defCtrlY;
                    return (
                      <g key={conn.id}>
                        {/* Bezier handle guide lines — only while editing connections */}
                        {connectMode && (
                          <>
                            <line x1={f.x} y1={f.y} x2={ctrlX} y2={ctrlY}
                              stroke="#606B74" strokeWidth={sw * 0.5} strokeOpacity={0.22}
                              strokeDasharray={`${cellPx * 0.28} ${cellPx * 0.18}`} />
                            <line x1={t.x} y1={t.y} x2={ctrlX} y2={ctrlY}
                              stroke="#606B74" strokeWidth={sw * 0.5} strokeOpacity={0.22}
                              strokeDasharray={`${cellPx * 0.28} ${cellPx * 0.18}`} />
                          </>
                        )}
                        {/* Interactive curve — editable only in connect mode */}
                        <g onClick={e => onConnectionClick(e, conn)}
                          style={{ cursor: connectMode ? "pointer" : "default",
                            pointerEvents: connectMode ? "all" : "none" }}>
                          {connectMode && <title>单击切换直/曲线，双击删除</title>}
                          <path d={`M${f.x},${f.y} Q${ctrlX},${ctrlY} ${t.x},${t.y}`}
                            fill="none" stroke="rgba(0,0,0,0.01)" strokeWidth={hitSw} />
                          <path d={`M${f.x},${f.y} Q${ctrlX},${ctrlY} ${t.x},${t.y}`}
                            fill="none" stroke="#606B74" strokeWidth={sw} strokeOpacity={0.6} />
                          {conn.label && (
                            <text x={ctrlX} y={ctrlY - 4} textAnchor="middle"
                              fontSize={Math.max(9, cellPx * 0.38)} fill="#606B74" opacity={0.7}>
                              {conn.label}
                            </text>
                          )}
                        </g>
                        {/* Draggable control point handle — only while editing connections */}
                        {connectMode && (
                          <circle
                            cx={ctrlX} cy={ctrlY} r={cpR}
                            fill="#606B74" fillOpacity={0.85}
                            stroke="#fff" strokeWidth={1.5}
                            style={{ cursor: "move", pointerEvents: "all" }}
                            onMouseDown={e => {
                              e.stopPropagation();
                              e.preventDefault();
                              const canvas = canvasRef.current!;
                              const rect = canvas.getBoundingClientRect();
                              ctrlDragRef.current = {
                                connId: conn.id,
                                startMx: e.clientX - rect.left + canvas.scrollLeft,
                                startMy: e.clientY - rect.top  + canvas.scrollTop,
                                startCtrlX: conn.ctrl_x ?? ctrlX / cellPx,
                                startCtrlY: conn.ctrl_y ?? ctrlY / cellPx,
                              };
                            }}
                          />
                        )}
                      </g>
                    );
                  }
                  // Straight line — editable only in connect mode
                  return (
                    <g key={conn.id}
                      onClick={e => onConnectionClick(e, conn)}
                      style={{ cursor: connectMode ? "pointer" : "default",
                        pointerEvents: connectMode ? "all" : "none" }}>
                      {connectMode && <title>单击切换直/曲线，双击删除</title>}
                      <line x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                        stroke="rgba(0,0,0,0.01)" strokeWidth={hitSw} />
                      <line x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                        stroke="#606B74" strokeWidth={sw} strokeOpacity={0.6} />
                      {conn.label && (
                        <text x={(f.x+t.x)/2} y={(f.y+t.y)/2 - 4} textAnchor="middle"
                          fontSize={Math.max(9, cellPx * 0.38)} fill="#606B74" opacity={0.7}>
                          {conn.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Clip watermark frames (copied bundles) */}
              {clipBoxes.map(({ clip, x0, y0, x1, y1 }) => {
                const PAD = 8;
                return (
                  <div key={`clip-${clip.id}`} style={{
                    position: "absolute",
                    left: x0 - PAD, top: y0 - PAD,
                    width: (x1 - x0) + PAD * 2, height: (y1 - y0) + PAD * 2,
                    border: "1.5px dashed #b08a4a",
                    borderRadius: 6,
                    background: "rgba(176,138,74,0.04)",
                    zIndex: 60, pointerEvents: "none",
                  }}>
                    <div style={{
                      position: "absolute", top: -11, left: 8,
                      background: "#FFFEF7", padding: "0 6px",
                      fontSize: 11, color: "#9a7838",
                      pointerEvents: "auto", display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span
                        onClick={() => clip.source_board_id && router.push(`/noteboard/${clip.source_board_id}`)}
                        style={{ cursor: clip.source_board_id ? "pointer" : "default", textDecoration: "underline" }}
                        title="跳转到来源笔记板">
                        来自 @{clip.source_user ?? "未知"} · 来源
                      </span>
                      {editable && (
                        <button
                          onClick={() => deleteClip(clip.id)}
                          style={{ border: "none", background: "transparent", color: "#c0392b",
                            cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
                          title="删除整个复制块">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Rubber-band selection rectangle */}
              {selRect && (
                <div style={{
                  position: "absolute",
                  left: Math.min(selRect.x0, selRect.x1),
                  top:  Math.min(selRect.y0, selRect.y1),
                  width:  Math.abs(selRect.x1 - selRect.x0),
                  height: Math.abs(selRect.y1 - selRect.y0),
                  border: "1.5px solid #2b7de0",
                  background: "rgba(43,125,224,0.10)",
                  zIndex: 300, pointerEvents: "none",
                }} />
              )}

            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Copy-selection panel (read-only boards) ── */}
    {!editable && showCopyPanel && selectedIds.length > 0 && (
      <div style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 700,
        width: 260, background: "#fff", borderRadius: 10,
        boxShadow: "0 6px 26px rgba(0,0,0,0.22)", padding: "14px 16px",
        fontFamily: "sans-serif",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2e1a", marginBottom: 8 }}>
          已选 {selectedIds.length} 项 · 复制到我的笔记板
        </div>
        <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 8 }}>
          {allBoards.length === 0 ? (
            <div style={{ fontSize: 12, color: "#aaa", padding: "6px 0" }}>你还没有笔记板</div>
          ) : allBoards.map(b => (
            <div key={b.id}
              onClick={() => copySelection(b.id)}
              style={{
                padding: "7px 10px", fontSize: 13, cursor: "pointer",
                borderRadius: 6, color: "#333",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ec")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              {b.title}
            </div>
          ))}
        </div>
        <button
          onClick={() => { setShowCopyPanel(false); setSelectedIds([]); }}
          style={{ ...figmaBtn, width: "100%", textAlign: "center" }}>
          取消
        </button>
      </div>
    )}

    {/* Copy toast */}
    {copyMsg && (
      <div style={{
        position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)",
        zIndex: 10001, background: "rgba(26,46,26,0.92)", color: "#fff",
        padding: "9px 18px", borderRadius: 8, fontSize: 13, fontFamily: "sans-serif",
      }}>
        {copyMsg}
      </div>
    )}

    {/* ── Floating action panel (bottom-left) ── */}
    <div style={{
      position: "fixed", left: 214, bottom: 18, zIndex: 600,
      display: "flex", flexDirection: "row", alignItems: "center", gap: 10,
      fontFamily: "sans-serif",
    }}>
      {editable && (
        <button
          onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}
          style={{ ...figmaBtn, background: connectMode ? "rgba(107,131,101,0.22)" : figmaBtn.background }}>
          编辑连线
        </button>
      )}
      {editable && connectMode && (
        <button
          onClick={() => setLineType(l => l === "straight" ? "curved" : "straight")}
          style={figmaBtn}>
          {lineType === "straight" ? "直线" : "曲线"}
        </button>
      )}
      {editable && (
        <button onClick={() => setNoteInput("")} style={figmaBtn}>
          添加文字
        </button>
      )}
      {editable && (
        <button
          onClick={() => {
            const next = !isPublic;
            setIsPublic(next);
            axios.put(`${API}/api/noteboards/${id}`, { is_public: next }, { headers }).catch(console.error);
          }}
          style={{ ...figmaBtn, background: isPublic ? "rgba(107,131,101,0.22)" : figmaBtn.background }}
          title={isPublic
            ? "当前已公开，其他用户可只读浏览并框选复制。点击可改为不公开"
            : "当前不公开。点击改为公开，其他用户即可只读浏览并框选复制"}>
          {isPublic ? "☑ 可公开" : "☐ 可公开"}
        </button>
      )}
      <span style={{ fontSize: 12, color: "#888", minWidth: 38, textAlign: "center" }}>
        {Math.round(zoom * 100)}%
      </span>
      <button onClick={() => setZoom(1)} style={figmaBtn}>
        复原尺寸
      </button>
      {editable && connectMode && (
        <span style={{ fontSize: 11, color: "#7aba7a", fontStyle: "italic", marginLeft: 2 }}>
          {connectFrom ? `已选「${connectFrom.title ?? connectFrom.item_type}」→ 点击目标卡片` : "点击起始卡片"}
        </span>
      )}
    </div>

    {/* ── Floating pending panel (top-right) ── */}
    {editable && (
    <div style={{
      position: "fixed",
      top: 100, right: 18,
      width: 288,
      maxHeight: "calc(100vh - 120px)",
      zIndex: 600,
      display: "flex", flexDirection: "column",
      fontFamily: "sans-serif",
    }}>
      {/* PNG background with transparency */}
      <img
        src="/NoteBoard_style/待部署区.png"
        alt=""
        draggable={false}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "fill",
          opacity: 0.82,
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
      {/* Content layer */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 6px" }}>
          {pendingPlain.length === 0 && pendingClips.length === 0 ? (
            <div style={{ padding: "6px 12px", fontSize: 11, color: "#bbb" }}>
              暂无待部署资源
            </div>
          ) : (<>
            {/* Copied clip bundles */}
            {pendingClips.map(({ clip, its }) => {
              const label = `复制块 · 来自 @${clip.source_user ?? "未知"}（${its.length} 项）`;
              const dragging = pendingDrag?.clip?.id === clip.id;
              return (
                <div key={`pclip-${clip.id}`} style={{ position: "relative", margin: "2px 8px" }}>
                  <div
                    onMouseDown={e => onPendingClipDragStart(e, clip, label)}
                    style={{
                      padding: "6px 22px 6px 8px",
                      background: dragging ? "rgba(0,0,0,0.03)" : "rgba(176,138,74,0.08)",
                      border: "1px dashed #cdab6e",
                      borderRadius: 6, fontSize: 12,
                      color: dragging ? "#aaa" : "#7a5e25",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      cursor: "grab", userSelect: "none",
                    }}>
                    {label}
                  </div>
                  <button
                    onClick={() => deleteClip(clip.id)}
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      position: "absolute", top: "50%", right: 5,
                      transform: "translateY(-50%)",
                      width: 14, height: 14, background: "transparent",
                      color: "#aaa", border: "none", fontSize: 11,
                      cursor: "pointer", padding: 0, lineHeight: "14px", textAlign: "center",
                    }}>
                    ×
                  </button>
                </div>
              );
            })}
            {/* Plain pending items */}
            {pendingPlain.map(item => (
              <div key={item.id} style={{ position: "relative", margin: "2px 8px" }}>
                <div
                  onMouseDown={e => onPendingDragStart(e, item)}
                  style={{
                    padding: "5px 22px 5px 8px",
                    background: pendingDrag?.item?.id === item.id ? "rgba(0,0,0,0.03)" : "transparent",
                    borderRadius: 6,
                    fontSize: 12,
                    color: pendingDrag?.item?.id === item.id ? "#aaa" : "#333",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    cursor: "grab",
                    userSelect: "none",
                    transition: "opacity 0.1s",
                  }}>
                  {item.title ?? item.text_content?.slice(0, 28) ?? `[${item.item_type}]`}
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    position: "absolute", top: "50%", right: 5,
                    transform: "translateY(-50%)",
                    width: 14, height: 14, background: "transparent",
                    color: "#aaa", border: "none", fontSize: 11,
                    cursor: "pointer", padding: 0, lineHeight: "14px",
                    textAlign: "center",
                  }}>
                  ×
                </button>
              </div>
            ))}
          </>)}
        </div>
      </div>
    </div>
    )}

    {/* ── Text note creation modal ── */}
    {noteInput !== null && (
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.28)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
        onClick={() => setNoteInput(null)}>
        <div style={{
          background: "#fff", borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          padding: "22px 24px", width: 320,
        }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2e1a", marginBottom: 10 }}>
            新建文字说明框
          </div>
          <textarea
            autoFocus
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                addTextNote(noteInput);
                setNoteInput(null);
              } else if (e.key === "Escape") {
                setNoteInput(null);
              }
            }}
            rows={5}
            placeholder="输入文字内容…"
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "8px 10px", fontSize: 13,
              border: "1px solid #d1d5db", borderRadius: 7,
              outline: "none", resize: "vertical",
              fontFamily: "inherit", lineHeight: 1.6,
              color: "#222",
            }}
          />
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 5, marginBottom: 14 }}>
            Ctrl+Enter 确认，Esc 取消
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setNoteInput(null)} style={{
              padding: "5px 14px", fontSize: 13, borderRadius: 6,
              border: "1px solid #d1d5db", background: "#f5f5f0",
              cursor: "pointer", color: "#555",
            }}>
              取消
            </button>
            <button
              onClick={() => { addTextNote(noteInput); setNoteInput(null); }}
              disabled={!noteInput.trim()}
              style={{
                padding: "5px 14px", fontSize: 13, borderRadius: 6,
                border: "none", cursor: noteInput.trim() ? "pointer" : "default",
                background: noteInput.trim() ? "#1a2e1a" : "#ccc",
                color: "#fff",
              }}>
              创建
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Ghost while dragging a clip bundle from pending area ── */}
    {pendingDrag && pendingDrag.clip && (
      <div style={{
        position: "fixed",
        left: pendingDrag.ghostX + 8,
        top:  pendingDrag.ghostY + 8,
        pointerEvents: "none", zIndex: 9999, opacity: 0.9,
        background: "rgba(176,138,74,0.12)",
        border: "1.5px dashed #b08a4a", borderRadius: 6,
        padding: "6px 12px", fontSize: 12, color: "#7a5e25",
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        fontFamily: "sans-serif", whiteSpace: "nowrap",
      }}>
        {pendingDrag.label ?? "复制块"}
      </div>
    )}

    {/* ── Ghost card while dragging from pending area ── */}
    {pendingDrag && pendingDrag.item && (() => {
      const { item, ghostX, ghostY } = pendingDrag as { item: Item; ghostX: number; ghostY: number };
      const GHOST_CELL = 20;
      const gw = item.w * GHOST_CELL;
      const gh = item.h * GHOST_CELL;
      return (
        <div style={{
          position: "fixed",
          left: ghostX - gw / 2,
          top:  ghostY - gh / 2,
          width: gw, height: gh,
          pointerEvents: "none",
          zIndex: 9999,
          opacity: 0.82,
          cursor: "grabbing",
        }}>
          {(item.item_type === "pdf" || item.item_type === "video") ? (
            <div style={{
              width: "100%", height: "100%",
              background: item.item_type === "pdf" ? "#e8e4dc" : "#1a1a2e",
              borderRadius: 3,
              border: `1px solid ${item.item_type === "pdf" ? "#c8c4bc" : "#333"}`,
              boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <img
                src={item.item_type === "pdf"
                  ? "/NoteBoard_style/PDF-笔记状态.png"
                  : "/NoteBoard_style/视频-笔记状态.png"}
                alt=""
                style={{
                  width: "55%",
                  height: item.item_type === "pdf" ? "75%" : "55%",
                  objectFit: "contain",
                  opacity: item.item_type === "pdf" ? 0.5 : 0.7,
                }}
              />
            </div>
          ) : (
            <div style={{
              width: "100%", height: "100%",
              background: item.item_type === "annotation" ? "#fff" : "rgba(250,250,248,0.95)",
              borderRadius: item.item_type === "annotation" ? 6 : 3,
              border: "1px solid #ddd",
              boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
              display: "flex", alignItems: "center",
              padding: "0 6px",
              overflow: "hidden",
            }}>
              <span style={{ fontSize: 10, color: "#555",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title ?? item.text_content?.slice(0, 24) ?? item.item_type}
              </span>
            </div>
          )}
        </div>
      );
    })()}
    </>
  );
}
