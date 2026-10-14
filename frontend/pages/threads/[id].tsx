import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import UploadModal from "../../components/UploadModal";
import UserAvatar from "../../src/app/components/UserAvatar";
import VisibilityPicker from "../../src/app/components/VisibilityPicker";

interface ThreadData {
  id: number;
  annotationId: number;
  createdBy: string;
  createdAt: string;
  rootThreadId?: number | null;
  title?: string | null;
  postType?: string | null;
  text: string;
  userName: string;
  pdfFile?: string;
  pageNumber?: number;
  videoFile?: string;
  videoTime?: number;
  selectedText?: string;
  // 选中文字前后各 20 字的上下文（仅帖子区批注来源时有值）
  selectionContextBefore?: string | null;
  selectionContextAfter?: string | null;
}

interface HistoryEntry {
  threadId: number;
  annotationText: string;
  selectedText?: string | null;
  // 普通链节：批注 → 它所回复的楼层
  floor?: {
    replyId: number;
    threadId: number;
    floorNumber: number;
    createdBy: string;
    text: string;
  };
  // 链尾：第一级帖子的「主楼」本身
  isRootMainPost?: boolean;
  mainPost?: {
    threadId: number;
    createdBy: string;
    postType?: string | null;
  };
}

interface Block {
  type: "text" | "image";
  content?: string;
  url?: string;
}

interface Reply {
  id: number;
  content: { blocks: Block[] };
  created_by: string;
  created_at: string;
  source_selection?: string | null;
}

// 楼主排序中的「优先楼层」：可能来自本帖，也可能来自某个子帖
interface FeaturedFloor {
  replyId: number;
  threadId: number;
  rootThreadId: number;
  content: { blocks: Block[] };
  createdBy: string;
  createdAt: string;
  sourceSelection?: string | null;
  floorNumber: number;
  isSubThread: boolean;
  threadLabel?: string | null;
  sortOrder?: number;
  featured?: boolean; // 仅 tree-floors 接口返回
}

interface AnnotationData {
  id: number;
  replyId: number;
  text: string;
  userName: string;
  selectedText?: string;
  textStartOffset?: number;
  textEndOffset?: number;
  createdAt?: string;
}

interface AnnotationPosition extends AnnotationData {
  topOffset: number;
  indentOffset: number;
}

interface SelectionInfo {
  inMainPost: boolean;
  replyId: number | null;
  text: string;
  startOffset: number;
  endOffset: number;
  popupX: number;
  popupY: number;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function buildRangeFromOffsets(
  container: HTMLElement,
  start: number,
  end: number
): Range | null {
  try {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOff = 0;
    let endOff = 0;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (!startNode && charCount + len >= start) {
        startNode = node;
        startOff = start - charCount;
      }
      if (!endNode && charCount + len >= end) {
        endNode = node;
        endOff = end - charCount;
        break;
      }
      charCount += len;
      node = walker.nextNode() as Text | null;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  } catch {
    return null;
  }
}

function getRectsRelativeTo(range: Range, container: HTMLElement): HighlightRect[] {
  const containerRect = container.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((r) => ({
    left: r.left - containerRect.left,
    top: r.top - containerRect.top,
    width: r.width,
    height: r.height,
  }));
}

// 顶部导航图标按钮 —— 与各页共用的 <TopNav> 组件（src/app/components/TopNav.tsx）保持一致的样式与交互
const NavBtn: React.FC<{ src: string; title: string; size?: number; onClick?: () => void }> = ({
  src, title, size = 26, onClick,
}) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      background: "none", border: "none",
      cursor: onClick ? "pointer" : "default",
      padding: "4px 6px", flexShrink: 0,
      display: "flex", alignItems: "center",
      borderRadius: 6, opacity: 0.88,
      transition: "opacity 0.15s, background 0.15s",
    }}
    onMouseEnter={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.opacity = "1";
      el.style.background = "rgba(255,255,255,0.08)";
    }}
    onMouseLeave={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.opacity = "0.88";
      el.style.background = "none";
    }}
  >
    <img src={src} alt={title} style={{ width: size, height: size, objectFit: "contain" }} />
  </button>
);

const Sep: React.FC<{ src: string }> = ({ src }) => (
  <img src={src} alt="" style={{ height: 42, width: "auto", opacity: 0.45, flexShrink: 0 }} />
);

const COLORS = {
  bg: "#fffef7",
  nav: "#192D10",
  border: "rgba(23,55,8,0.12)",
  divider: "#CCCCCB",
  accent: "#173708",
  sidebarBg: "rgba(217,219,214,0.2)",
  cardShadow: "2px 4px 4px rgba(0,0,0,0.25)",
  cardShadowHover: "2px 6px 12px rgba(0,0,0,0.32)",
};

const CARD_WIDTH = 193;
const CARD_HEIGHT = 120;
const CARD_GAP = 10;

const INDICATOR_ICONS = [
  { label: "有用", src: "/Threads_style/有用的.png" },
  { label: "有启发", src: "/Threads_style/有启发的.png" },
  { label: "过时", src: "/Threads_style/过时的.png" },
  { label: "不实", src: "/Threads_style/不实的.png" },
];

// Annotation cards only show 有用 + 有启发性 — icon + count space, transparent border
const AnnotationIndicators = ({ compact = false }: { compact?: boolean }) => (
  <div style={{ display: "flex", gap: 8 }}>
    {INDICATOR_ICONS.slice(0, 2).map(({ label, src }) => (
      <button
        key={label}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: compact ? "1px 3px" : "2px 5px",
          border: "1px solid transparent",
          borderRadius: 3,
          background: "none",
          cursor: "pointer",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={label} style={{ width: compact ? 12 : 14, height: compact ? 12 : 14, opacity: 0.65 }} />
        <span style={{ fontSize: compact ? 9 : 10, color: "#bbb", minWidth: compact ? 12 : 14 }}>0</span>
      </button>
    ))}
  </div>
);

// 楼层 / 主楼 的四个快捷指标：纵向排列，数字显示在图标右侧。
// 注意：指标数据（有用/有启发/过时/不实）尚未接入存储与推荐算法；
// 主楼应与其来源批注共享同一份指标数据，待后端实现后接入（暂以 0 占位）。
const QuickIndicatorsVertical = ({ iconSize = 14 }: { iconSize?: number }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
    {INDICATOR_ICONS.map(({ label, src }) => (
      <button
        key={label}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "1px 2px",
          border: "1px solid transparent",
          borderRadius: 3,
          background: "none",
          cursor: "pointer",
        } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={label} style={{ width: iconSize, height: iconSize, opacity: 0.55 }} />
        <span style={{ fontSize: 9, color: "#bbb", minWidth: 10, textAlign: "left" }}>0</span>
      </button>
    ))}
  </div>
);

const ThreadPage = () => {
  const router = useRouter();
  const { id } = router.query;

  // 个人主页：已登录跳转个人页，否则跳登录（与 <TopNav> 一致）
  const handleProfile = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    router.push(token ? "/profile" : "/login");
  };

  const [thread, setThread] = useState<ThreadData | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [allAnnotations, setAllAnnotations] = useState<AnnotationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 楼主排序 ────────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [threadOwner, setThreadOwner] = useState<string | null>(null);
  const [featuredFloors, setFeaturedFloors] = useState<FeaturedFloor[]>([]);
  const [sortMode, setSortMode] = useState<"default" | "owner">("default");
  // 编辑面板
  const [ownerEditOpen, setOwnerEditOpen] = useState(false);
  const [treeFloors, setTreeFloors] = useState<FeaturedFloor[]>([]);
  const [editSelection, setEditSelection] = useState<number[]>([]); // 有序的 replyId
  const [savingSort, setSavingSort] = useState(false);

  // 从 token 解析当前用户名（用于判断是否为帖主）
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      setCurrentUser(payload.userName || null);
    } catch {}
  }, []);

  const fetchOwnerSort = useCallback(async () => {
    if (!id) return;
    try {
      const r = await axios.get(`http://localhost:3001/api/threads/${id}/owner-sort`);
      setThreadOwner(r.data.owner ?? null);
      setFeaturedFloors(r.data.floors ?? []);
    } catch {
      setFeaturedFloors([]);
    }
  }, [id]);
  useEffect(() => { fetchOwnerSort(); }, [fetchOwnerSort]);

  const openOwnerEdit = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const r = await axios.get(`http://localhost:3001/api/threads/${id}/tree-floors`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTreeFloors(r.data || []);
      // 初始选择 = 当前已勾选的顺序
      setEditSelection(featuredFloors.map((f) => f.replyId));
      setOwnerEditOpen(true);
    } catch (err) {
      console.error("加载楼层列表失败", err);
    }
  };

  const toggleEditFloor = (replyId: number) => {
    setEditSelection((prev) =>
      prev.includes(replyId) ? prev.filter((x) => x !== replyId) : [...prev, replyId]
    );
  };

  const moveEditFloor = (idx: number, dir: -1 | 1) => {
    setEditSelection((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const saveOwnerSort = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setSavingSort(true);
    try {
      await axios.post(
        `http://localhost:3001/api/threads/${id}/owner-sort`,
        { replyIds: editSelection },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchOwnerSort();
      setOwnerEditOpen(false);
      setSortMode("owner");
    } catch (err) {
      console.error("保存楼主排序失败", err);
    } finally {
      setSavingSort(false);
    }
  };

  // 主楼区域可拖拽高度：null 表示按内容自适应；首次测量后写入像素值
  const [mainPostHeight, setMainPostHeight] = useState<number | null>(null);
  const mainPostOuterRef = useRef<HTMLDivElement>(null);
  // focusedReplyId: which floor the user is annotating into (for text selection highlight)
  const [focusedReplyId, setFocusedReplyId] = useState<number | null>(null);
  // hoveredFloorId: which floor highlights its source in the main post
  const [hoveredFloorId, setHoveredFloorId] = useState<number | null>(null);
  // hoveredAnnotationId: which annotation card is hovered (shows highlight in floor)
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<number | null>(null);

  // Horizontal scroll state for annotation sidebar (negative = shifted left)
  const [wheelDelta, setWheelDelta] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);

  // Resizable sidebar — 支持 URL ?sw=N 指定初始宽度（PDF 弹窗模式打开时传 150）
  // 默认宽度 = 最小宽度（450）：侧栏从最窄起步，只能向左拖大
  const [sidebarWidth, setSidebarWidth] = useState(450);
  useEffect(() => {
    const sw = parseInt((router.query.sw as string) || "0", 10);
    if (sw > 0) setSidebarWidth(sw);
  }, [router.query.sw]);

  // Double-click annotation modal
  const [dblClickAnnotation, setDblClickAnnotation] = useState<AnnotationData | null>(null);

  // 历史对话链弹窗
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyChain, setHistoryChain] = useState<HistoryEntry[] | null>(null);
  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryChain(null);
    try {
      const r = await axios.get(`http://localhost:3001/api/threads/${id}/history`);
      setHistoryChain(r.data);
    } catch (err) {
      console.error("加载历史对话失败", err);
      setHistoryChain([]);
    }
  };

  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [newReplyText, setNewReplyText] = useState("");
  const [newAnnotationText, setNewAnnotationText] = useState("");
  const [submitVisibility, setSubmitVisibility] = useState<0 | 1 | 2>(2);

  // Direct "add floor" (no text selection required)
  const [showAddFloor, setShowAddFloor] = useState(false);
  const [addFloorText, setAddFloorText] = useState("");

  // ── 部署信息悬停弹窗 ──────────────────────────────────────────────────────
  const [deployHover, setDeployHover] = useState<{
    x: number; y: number;
    data: Array<{ board_title: string; user_name: string }> | null;
  } | null>(null);
  const deployCache = useRef<Map<string, Array<{ board_title: string; user_name: string }>>>(new Map());

  const showDeployHover = async (
    e: React.MouseEvent, itemType: string, resourceId: number
  ) => {
    const key = `${itemType}:${resourceId}`;
    const cached = deployCache.current.get(key);
    setDeployHover({ x: e.clientX, y: e.clientY, data: cached ?? null });
    if (cached !== undefined) return;
    try {
      const r = await axios.get("http://localhost:3001/api/noteboards/deployments", {
        params: { item_type: itemType, resource_id: resourceId },
      });
      deployCache.current.set(key, r.data);
      setDeployHover(prev => prev ? { ...prev, data: r.data } : null);
    } catch {}
  };

  // ── 归类面板 ──────────────────────────────────────────────────────────────
  interface ClassifyTarget { itemType: "thread" | "annotation"; resourceId: number; title: string; textContent?: string; threadId?: number; replyId?: number; }
  const [classifyTarget, setClassifyTarget] = useState<ClassifyTarget | null>(null);
  const [classifyPos, setClassifyPos] = useState({ x: 0, y: 0 });
  const [classifyBoards, setClassifyBoards] = useState<{ id: number; title: string }[]>([]);
  const [classifySelectedBoard, setClassifySelectedBoard] = useState<number | null>(null);
  const [classifyNewTitle, setClassifyNewTitle] = useState("");
  const [classifyNoteText, setClassifyNoteText] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    if (!classifyTarget) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.get("http://localhost:3001/api/noteboards", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => setClassifyBoards(r.data)).catch(console.error);
  }, [classifyTarget]);

  const openClassify = (e: React.MouseEvent, target: ClassifyTarget) => {
    e.stopPropagation();
    setClassifyTarget(target);
    setClassifySelectedBoard(null);
    setClassifyNewTitle("");
    setClassifyNoteText("");
    const x = Math.min(e.clientX + 12, window.innerWidth - 268);
    const y = Math.min(e.clientY - 10, window.innerHeight - 320);
    setClassifyPos({ x, y });
  };

  const handleClassify = async () => {
    if (!classifyTarget) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    setClassifying(true);
    try {
      let boardId = classifySelectedBoard;
      if (!boardId && classifyNewTitle.trim()) {
        const r = await axios.post(
          "http://localhost:3001/api/noteboards",
          { title: classifyNewTitle.trim() },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        boardId = r.data.id;
      }
      if (!boardId) return;
      await axios.post(
        `http://localhost:3001/api/noteboards/${boardId}/items`,
        {
          item_type: classifyTarget.itemType,
          resource_id: classifyTarget.resourceId,
          title: classifyTarget.title,
          text_content: classifyTarget.textContent ?? null,
          note_text: classifyNoteText.trim() || null,
          reading_progress: classifyTarget.threadId != null ? {
            threadId: classifyTarget.threadId,
            ...(classifyTarget.replyId != null ? { replyId: classifyTarget.replyId } : {}),
          } : null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setClassifyTarget(null);
    } catch (err) {
      console.error("归类失败", err);
    } finally {
      setClassifying(false);
    }
  };

  const [mainPostHighlights, setMainPostHighlights] = useState<HighlightRect[]>([]);
  const [floorHighlights, setFloorHighlights] = useState<HighlightRect[]>([]);
  const [annotationPositions, setAnnotationPositions] = useState<AnnotationPosition[]>([]);

  const mainPostContentRef = useRef<HTMLDivElement>(null);
  const replyRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const sidebarRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Keep mutable refs for the wheel handler closure
  const wheelStateRef = useRef({ wheelDelta: 0, scrollMax: 0 });
  useEffect(() => {
    wheelStateRef.current = { wheelDelta, scrollMax };
  });

  // ── Data fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    Promise.all([
      axios.get(`http://localhost:3001/api/threads/${id}`),
      axios.get(`http://localhost:3001/api/replies`, { params: { threadId: id } }),
      axios.get(`http://localhost:3001/api/annotations`, { params: { threadId: id } }),
    ])
      .then(([threadRes, repliesRes, annotationsRes]) => {
        setThread(threadRes.data);
        setReplies(repliesRes.data);
        setAllAnnotations(annotationsRes.data);
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  // ── Compute annotation positions in sidebar ───────────────────────────────
  const updateAnnotationPositions = useCallback(() => {
    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return;

    const sidebarRect = sidebarEl.getBoundingClientRect();

    const withTops: AnnotationPosition[] = allAnnotations.map((anno) => {
      const floorEl = replyRefs.current.get(anno.replyId);
      let topOffset = -9999;

      if (floorEl) {
        if (anno.textStartOffset !== undefined && anno.textEndOffset !== undefined) {
          const contentEl = floorEl.querySelector(".reply-text-content") as HTMLElement | null;
          if (contentEl) {
            const range = buildRangeFromOffsets(contentEl, anno.textStartOffset, anno.textEndOffset);
            if (range) {
              const rects = range.getClientRects();
              if (rects.length > 0) {
                topOffset = rects[0].top - sidebarRect.top;
              }
            }
          }
        }
        if (topOffset === -9999) {
          // Fallback: anchor to top of the floor card
          topOffset = floorEl.getBoundingClientRect().top - sidebarRect.top + 16;
        }
      }

      return { ...anno, topOffset, indentOffset: 0 };
    });

    // Sort by vertical position
    const sorted = [...withTops].sort((a, b) => a.topOffset - b.topOffset);

    // Compute horizontal indentation to avoid vertical overlaps
    // Cards are center-aligned to anchor, so effective range is [top - H/2, top + H/2]
    sorted.forEach((anno, i) => {
      const occupiedRanges: Array<{ left: number; right: number }> = [];
      for (let j = 0; j < i; j++) {
        const prev = sorted[j];
        const vertOverlap = Math.abs(anno.topOffset - prev.topOffset) < CARD_HEIGHT;
        if (vertOverlap) {
          occupiedRanges.push({
            left: prev.indentOffset,
            right: prev.indentOffset + CARD_WIDTH,
          });
        }
      }
      occupiedRanges.sort((a, b) => a.left - b.left);
      let testPos = 0;
      for (const occ of occupiedRanges) {
        if (testPos + CARD_WIDTH <= occ.left) break;
        if (testPos < occ.right) testPos = occ.right + CARD_GAP;
      }
      anno.indentOffset = testPos;
    });

    // Update horizontal scroll range
    const maxRight = sorted.reduce((m, a) => Math.max(m, a.indentOffset + CARD_WIDTH), 0);
    const newScrollMax = Math.max(0, maxRight - (sidebarEl.clientWidth - 14));
    setScrollMax(newScrollMax);

    setAnnotationPositions(sorted);
  }, [allAnnotations]);

  // Run after annotations or replies change (small delay to let DOM settle)
  useEffect(() => {
    const t = setTimeout(updateAnnotationPositions, 60);
    return () => clearTimeout(t);
  }, [allAnnotations, replies, updateAnnotationPositions]);

  // Run on floors scroll
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateAnnotationPositions, { passive: true });
    return () => el.removeEventListener("scroll", updateAnnotationPositions);
  }, [updateAnnotationPositions]);

  // ── Non-passive wheel listener on sidebar → horizontal shift ──────────────
  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { wheelDelta: cur, scrollMax: maxVal } = wheelStateRef.current;
      const newDelta = cur - e.deltaY * 0.6;
      const constrained = Math.max(-maxVal, Math.min(0, newDelta));
      setWheelDelta(constrained);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [loading]);

  // ── Global mouseup → auto text selection ─────────────────────────────────
  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || !selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const popupX = Math.min(rect.left + rect.width / 2, window.innerWidth - 320);
      const popupY = Math.min(rect.bottom + 10, window.innerHeight - 220);

      // Check main post
      const mainEl = mainPostContentRef.current;
      if (mainEl && mainEl.contains(range.commonAncestorContainer)) {
        const pre = range.cloneRange();
        pre.selectNodeContents(mainEl);
        pre.setEnd(range.startContainer, range.startOffset);
        const startOffset = pre.toString().length;
        setSelectionInfo({ inMainPost: true, replyId: null, text, startOffset, endOffset: startOffset + text.length, popupX, popupY });
        return;
      }

      // Check reply floors
      for (const [replyId, el] of Array.from(replyRefs.current.entries())) {
        const contentEl = el.querySelector(".reply-text-content") as HTMLElement | null;
        if (contentEl && contentEl.contains(range.commonAncestorContainer)) {
          const pre = range.cloneRange();
          pre.selectNodeContents(contentEl);
          pre.setEnd(range.startContainer, range.startOffset);
          const startOffset = pre.toString().length;
          setSelectionInfo({ inMainPost: false, replyId, text, startOffset, endOffset: startOffset + text.length, popupX, popupY });
          setFocusedReplyId(replyId);
          return;
        }
      }
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // ── Highlight helpers ─────────────────────────────────────────────────────
  const highlightMainPost = useCallback((reply: Reply) => {
    if (!reply.source_selection || !mainPostContentRef.current) {
      setMainPostHighlights([]);
      return;
    }
    try {
      const sel = JSON.parse(reply.source_selection);
      const range = buildRangeFromOffsets(mainPostContentRef.current, sel.startOffset, sel.endOffset);
      if (!range) { setMainPostHighlights([]); return; }
      setMainPostHighlights(getRectsRelativeTo(range, mainPostContentRef.current));
    } catch {
      setMainPostHighlights([]);
    }
  }, []);

  const highlightFloorText = useCallback((anno: AnnotationData) => {
    if (anno.textStartOffset === undefined || anno.textEndOffset === undefined) {
      setFloorHighlights([]);
      return;
    }
    const floorEl = replyRefs.current.get(anno.replyId);
    if (!floorEl) { setFloorHighlights([]); return; }
    const contentEl = floorEl.querySelector(".reply-text-content") as HTMLElement | null;
    if (!contentEl) { setFloorHighlights([]); return; }
    const range = buildRangeFromOffsets(contentEl, anno.textStartOffset, anno.textEndOffset);
    if (!range) { setFloorHighlights([]); return; }
    setFloorHighlights(getRectsRelativeTo(range, contentEl));
    setFocusedReplyId(anno.replyId);
  }, []);

  // ── Sidebar drag resize ───────────────────────────────────────────────────
  const handleSidebarDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (m: MouseEvent) => {
      const delta = startX - m.clientX;
      // 最小宽度 450，避免楼层区过宽导致长文字埋入批注栏；
      // 向左拖拽（增大宽度）不再设上限
      setSidebarWidth(Math.max(450, startW + delta));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // ── Main post height resize ──────────────────────────────────────────────
  // 切换帖子时重置高度，下次测量重新按新文本初始化
  useEffect(() => {
    setMainPostHeight(null);
  }, [thread?.id]);

  // 首次内容渲染后，按外层容器的自然高度初始化主楼区域高度
  useEffect(() => {
    if (!thread || mainPostHeight !== null) return;
    if (!mainPostOuterRef.current) return;
    setMainPostHeight(mainPostOuterRef.current.scrollHeight);
  }, [thread, mainPostHeight]);

  const handleMainPostResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = mainPostHeight ?? 200;
    const onMove = (m: MouseEvent) => {
      const delta = m.clientY - startY;
      setMainPostHeight(Math.max(60, startH + delta));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [mainPostHeight]);

  // ── Submit helpers ────────────────────────────────────────────────────────
  const dismissSelection = useCallback(() => {
    setSelectionInfo(null);
    setNewReplyText("");
    setNewAnnotationText("");
    setSubmitVisibility(2);
    window.getSelection()?.removeAllRanges();
  }, []);

  // 统一的登录检查：未登录则提示并跳转登录页
  const requireLoginOrAlert = (): string | null => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      alert("请先登录后再发表内容");
      router.push("/login");
      return null;
    }
    return token;
  };

  const handleSubmitAddFloor = async () => {
    if (!addFloorText.trim()) return;
    const token = requireLoginOrAlert();
    if (!token) return;
    try {
      const response = await axios.post(
        "http://localhost:3001/api/replies",
        {
          thread_id: id,
          content: { blocks: [{ type: "text", content: addFloorText }] },
          visibility_level: submitVisibility,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setReplies((prev) => [
        ...prev,
        {
          id: response.data.replyId,
          content: { blocks: [{ type: "text", content: addFloorText }] },
          created_by: "user",
          created_at: new Date().toISOString(),
        },
      ]);
      setAddFloorText("");
      setShowAddFloor(false);
      setSubmitVisibility(2);
    } catch (err) {
      console.error("Error submitting floor:", err);
    }
  };

  const handleSubmitReply = async () => {
    if (!selectionInfo || !newReplyText.trim()) return;
    const token = requireLoginOrAlert();
    if (!token) return;
    try {
      const response = await axios.post(
        "http://localhost:3001/api/replies",
        {
          thread_id: id,
          content: { blocks: [{ type: "text", content: newReplyText }] },
          source_selection: JSON.stringify({ text: selectionInfo.text, startOffset: selectionInfo.startOffset, endOffset: selectionInfo.endOffset }),
          visibility_level: submitVisibility,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setReplies((prev) => [
        ...prev,
        {
          id: response.data.replyId,
          content: { blocks: [{ type: "text", content: newReplyText }] },
          created_by: "user",
          created_at: new Date().toISOString(),
          source_selection: JSON.stringify({ text: selectionInfo.text, startOffset: selectionInfo.startOffset, endOffset: selectionInfo.endOffset }),
        },
      ]);
      dismissSelection();
    } catch (err) {
      console.error("Error submitting reply:", err);
    }
  };

  const handleSubmitAnnotation = async () => {
    if (!selectionInfo || !selectionInfo.replyId || !newAnnotationText.trim()) return;
    const token = requireLoginOrAlert();
    if (!token) return;
    try {
      const response = await axios.post(
        "http://localhost:3001/api/annotations",
        {
          replyId: selectionInfo.replyId,
          text: newAnnotationText,
          selectedText: selectionInfo.text,
          textStartOffset: selectionInfo.startOffset,
          textEndOffset: selectionInfo.endOffset,
          yPosition: selectionInfo.popupY,
          visibilityLevel: submitVisibility,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAllAnnotations((prev) => [...prev, response.data]);
      dismissSelection();
    } catch (err) {
      console.error("Error submitting annotation:", err);
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ height: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.accent }}>
        加载中...
      </div>
    );
  }
  if (error || !thread) {
    return (
      <div style={{ height: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "red" }}>
        {error || "帖子不存在"}
      </div>
    );
  }

  // Sidebar height for clipping off-screen annotations
  const sidebarHeight = sidebarRef.current?.clientHeight ?? 800;

  // ── 楼主排序：派生显示数据 ───────────────────────────────────────────────────
  // 仅一级帖（rootThreadId 为空）支持楼主排序；帖主可编辑，其他用户可切换排序方式。
  const isFirstLevel = thread.rootThreadId == null;
  // 帖主判定优先用主楼数据（thread.createdBy，主帖接口已返回），
  // 不依赖 owner-sort 接口是否就绪，保证切换栏/编辑按钮稳定出现。
  const ownerName = thread.createdBy || threadOwner;
  const isOwner = !!currentUser && !!ownerName && currentUser === ownerName;
  const hasOwnerSort = featuredFloors.length > 0;
  const showSortBar = isFirstLevel && (hasOwnerSort || isOwner);

  // 本帖楼层原始序号（默认排序下的楼层号），重排后仍沿用，避免编号混乱
  const originalFloorNo = new Map<number, number>();
  replies.forEach((r, i) => originalFloorNo.set(r.id, i + 1));

  // 构造实际渲染列表：默认排序 → 原顺序；楼主排序 → 优先楼层在前，其余本帖楼层随后
  type DisplayItem =
    | { kind: "root"; reply: Reply; floorNo: number }
    | { kind: "promoted"; floor: FeaturedFloor };
  let displayList: DisplayItem[] = [];
  if (sortMode === "owner" && hasOwnerSort) {
    const featuredRootIds = new Set(
      featuredFloors.filter((f) => !f.isSubThread).map((f) => f.replyId)
    );
    featuredFloors.forEach((f) => {
      if (f.isSubThread) {
        displayList.push({ kind: "promoted", floor: f });
      } else {
        const reply = replies.find((r) => r.id === f.replyId);
        if (reply) displayList.push({ kind: "root", reply, floorNo: originalFloorNo.get(reply.id) || 0 });
      }
    });
    replies.forEach((r, i) => {
      if (!featuredRootIds.has(r.id)) displayList.push({ kind: "root", reply: r, floorNo: i + 1 });
    });
  } else {
    replies.forEach((r, i) => displayList.push({ kind: "root", reply: r, floorNo: i + 1 }));
  }

  // 本帖普通楼层卡片（保持原有交互与批注侧栏锚定）
  const renderRootFloor = (reply: Reply, floorNo: number) => {
    const isFocused = focusedReplyId === reply.id;
    const isFeatured = sortMode === "owner" && featuredFloors.some((f) => f.replyId === reply.id);
    return (
      <div
        key={reply.id}
        id={`reply-${reply.id}`}
        ref={(el) => {
          if (el) replyRefs.current.set(reply.id, el);
          else replyRefs.current.delete(reply.id);
        }}
        style={{
          background: isFeatured ? "rgba(23,55,8,0.035)" : "transparent",
          cursor: "default",
          position: "relative",
          minHeight: 186,
          // 右侧预留出批注栏宽度，使楼层正文在批注栏浮层左侧换行，
          // 而非铺到整行被埋进批注栏（与分隔线/快捷指标的 sidebarWidth 让位一致）
          padding: `16px ${sidebarWidth + 20}px 46px 52px`,
        }}
        onMouseEnter={() => {
          setHoveredFloorId(reply.id);
          highlightMainPost(reply);
        }}
        onMouseLeave={() => {
          setHoveredFloorId(null);
          setMainPostHighlights([]);
        }}
      >
        {/* Divider line — symmetric margins: 52px left, sidebarWidth+52 right */}
        <div style={{ position: "absolute", bottom: 0, left: 52, right: sidebarWidth + 52, height: 1, backgroundColor: COLORS.divider }} />

        {/* Progress identifier — absolute bottom-left, extends past divider start */}
        <button
          style={{ position: "absolute", left: 18, bottom: 14, background: "none", border: "none", cursor: "pointer", padding: 2, opacity: 0.25, display: "flex", alignItems: "center", transition: "opacity 0.15s" }}
          title="收录到笔记板"
          onMouseEnter={e => { (e.currentTarget.style.opacity = "0.8"); showDeployHover(e, "thread", reply.id); }}
          onMouseLeave={e => { (e.currentTarget.style.opacity = "0.25"); setDeployHover(null); }}
          onClick={e => {
            const blocks = reply.content.blocks;
            const text = blocks.map(b => b.content ?? "").join(" ").slice(0, 50);
            openClassify(e, { itemType: "thread", resourceId: reply.id, title: text || `楼层 #${floorNo}`, threadId: thread.id, replyId: reply.id });
          }}
        >
          <img src="/Threads_style/进度标记符.png" alt="收录" style={{ width: 14, height: 14 }} />
        </button>

        {/* Header row: avatar + name + floor# + date */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {reply.created_by && (
            <UserAvatar userName={reply.created_by} size={26} />
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.nav }}>{reply.created_by}</span>
          <span style={{ fontSize: 10, color: "#bbb" }}>#{floorNo}</span>
          {isFeatured && (
            <span style={{ fontSize: 9, color: COLORS.accent, background: "rgba(23,55,8,0.10)", borderRadius: 3, padding: "1px 5px" }}>楼主精选</span>
          )}
          <span style={{ fontSize: 10, color: "#ccc", marginLeft: "auto" }}>{new Date(reply.created_at).toLocaleDateString()}</span>
        </div>

        {/* Floor text content */}
        <div
          className="reply-text-content"
          style={{ fontSize: 14, lineHeight: 1.78, color: "#2a2a2a", userSelect: "text", cursor: "text", position: "relative" }}
        >
          {reply.content.blocks.map((block, bi) => (
            <div key={bi}>
              {block.type === "text" && <span>{block.content}</span>}
              {block.type === "image" && block.url && (
                <img
                  src={block.url.startsWith("http") ? block.url : `http://localhost:3001${block.url}`}
                  alt=""
                  style={{ maxWidth: "100%", borderRadius: 4, marginTop: 6 }}
                />
              )}
            </div>
          ))}
          {isFocused && floorHighlights.map((rect, i) => (
            <div key={i} style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: "rgba(23,55,8,0.18)", borderRadius: 2, pointerEvents: "none" }} />
          ))}
        </div>

        {/* Source selection attribution */}
        {reply.source_selection && (() => {
          try {
            const sel = JSON.parse(reply.source_selection);
            return (
              <div style={{ marginTop: 10, borderLeft: "2px solid rgba(23,55,8,0.22)", paddingLeft: 8, fontSize: 11, color: "#aaa", fontStyle: "italic" }}>
                源自主楼: &ldquo;{sel.text?.substring(0, 60)}{sel.text?.length > 60 ? "…" : ""}&rdquo;
              </div>
            );
          } catch { return null; }
        })()}

        {/* 快捷指标 — 纵向排列于楼层右下角，数字在图标右侧 */}
        <div style={{ position: "absolute", right: sidebarWidth + 16, bottom: 14 }}>
          <QuickIndicatorsVertical iconSize={14} />
        </div>
      </div>
    );
  };

  // 楼主排序中来自「子帖」的优先楼层：以回流卡片展示，点击跳转到其所在子帖楼层
  const renderPromotedFloor = (floor: FeaturedFloor) => {
    const text = floor.content.blocks.map((b) => b.content ?? "").join(" ");
    return (
      <div
        key={`promoted-${floor.replyId}`}
        onClick={() => router.push(`/threads/${floor.threadId}#reply-${floor.replyId}`)}
        title="来自子帖，点击进入原楼层"
        style={{
          position: "relative",
          cursor: "pointer",
          // 同楼层卡片：右侧让位批注栏宽度，避免回流卡片被埋进批注栏
          margin: `12px ${sidebarWidth + 20}px 12px 52px`,
          padding: "14px 16px",
          borderRadius: 8,
          border: `1px solid ${COLORS.border}`,
          borderLeft: `3px solid ${COLORS.accent}`,
          background: "rgba(23,55,8,0.04)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {floor.createdBy && <UserAvatar userName={floor.createdBy} size={22} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.nav }}>{floor.createdBy}</span>
          <span style={{ fontSize: 9, color: COLORS.accent, background: "rgba(23,55,8,0.10)", borderRadius: 3, padding: "1px 5px" }}>楼主精选</span>
          <span style={{ fontSize: 10, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            ↪ 子帖「{floor.threadLabel || `#${floor.threadId}`}」· 楼层 #{floor.floorNumber}
          </span>
          <span style={{ fontSize: 10, color: "#ccc", marginLeft: "auto" }}>{new Date(floor.createdAt).toLocaleDateString()}</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "#2a2a2a", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {text}
        </div>
      </div>
    );
  };

  return (
    <>
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: COLORS.bg,
        color: "#1a1a1a",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* ── Top Navbar ──（与各页共用的 <TopNav> 保持一致；中间用本页面包屑代替搜索栏） */}
      <div style={{ height: 78, background: COLORS.nav, display: "flex", alignItems: "center", padding: "0 20px", flexShrink: 0, zIndex: 20 }}>
        {/* 主页 动态 上传 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <NavBtn src="/Topframe_style/主页.png" title="主页" onClick={() => router.push("/")} />
          <NavBtn src="/Topframe_style/动态.png" title="动态" onClick={() => router.push("/movement")} />
          <NavBtn src="/Topframe_style/上传.png" title="上传/推荐资源" onClick={() => setShowUpload(true)} />
        </div>

        {/* 面包屑（占据中间弹性空间） */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, overflow: "hidden", margin: "0 16px" }}>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 16, flexShrink: 0 }}>›</span>
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.selectedText
              ? `"${thread.selectedText.substring(0, 50)}${thread.selectedText.length > 50 ? "…" : ""}"`
              : (thread.postType === "direct" ? thread.title : thread.text)?.substring(0, 50)}
          </span>
        </div>

        {/* 右区：通知 求助 | 个人主页 | 历史记录 笔记板 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <NavBtn src="/Topframe_style/通知信息.png" title="通知邮件箱" />
          <NavBtn src="/Topframe_style/求助通知.png" title="求助邮件箱" />
          <Sep src="/Topframe_style/Line.png" />
          <NavBtn src="/Topframe_style/个人主页.png" title="个人主页" onClick={handleProfile} />
          <Sep src="/Topframe_style/Line-1.png" />
          <NavBtn src="/Topframe_style/足迹历史.png" title="历史记录" onClick={() => router.push("/reading-inbox")} />
          <NavBtn src="/Topframe_style/笔记板页面.png" title="笔记板" onClick={() => router.push("/noteboard")} />
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Full-width Sticky Main Post — spans floors + sidebar ── */}
        <div
          ref={mainPostOuterRef}
          style={{
            flexShrink: 0,
            background: "linear-gradient(to top,#FEFEFE 0px,#FEFEFE 1px,#F4F3EC 1px,#F4F3EC 3px,#F5F4ED 3px,#F5F4ED 5px,#F6F5EE 5px,#F6F5EE 7px,#F7F6EF 7px,#F7F6EF 10px,#F8F7F0 10px)",
            padding: "16px 24px 50px 52px",
            position: "relative",
            zIndex: 10,
            // 拖拽控制高度：尚未测量时 auto；测量后用像素值，溢出由用户拖大显示
            height: mainPostHeight ?? "auto",
            overflow: "hidden",
          } as React.CSSProperties}>

          {/* Progress identifier — absolute top-left */}
          <button
            style={{ position: "absolute", left: 14, top: 14, background: "none", border: "none", cursor: "pointer", padding: 2, opacity: 0.3, display: "flex", alignItems: "center", transition: "opacity 0.15s" }}
            title="收录到笔记板"
            onMouseEnter={e => { (e.currentTarget.style.opacity = "0.85"); showDeployHover(e, "thread", thread.id); }}
            onMouseLeave={e => { (e.currentTarget.style.opacity = "0.3"); setDeployHover(null); }}
            onClick={e => openClassify(e, {
              itemType: "thread",
              resourceId: thread.id,
              title: thread.selectedText?.slice(0, 50) || thread.text?.slice(0, 50) || "帖子",
              threadId: thread.id,
            })}
          >
            <img src="/Threads_style/进度标记符.png" alt="收录" style={{ width: 16, height: 16 }} />
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            {thread.userName && (
              <UserAvatar userName={thread.userName} size={30} />
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.nav }}>{thread.userName}</div>
              <div style={{ fontSize: 10, color: "#aaa" }}>{thread.postType === "direct" ? "想法 · 主楼" : "主楼"}</div>
            </div>
          </div>

          {thread.selectedText && (
            <div style={{ borderLeft: `3px solid ${COLORS.nav}`, paddingLeft: 12, marginBottom: 12, fontSize: 13, fontStyle: "italic", lineHeight: 1.75 }}>
              &ldquo;
              {thread.selectionContextBefore ? (
                <span style={{ color: "#bbb" }}>…{thread.selectionContextBefore}</span>
              ) : null}
              <span style={{ color: "#555", background: "rgba(23,55,8,0.10)", fontWeight: 500 }}>{thread.selectedText}</span>
              {thread.selectionContextAfter ? (
                <span style={{ color: "#bbb" }}>{thread.selectionContextAfter}…</span>
              ) : null}
              &rdquo;
            </div>
          )}
          {thread.postType === "direct" ? (
            // 直接发布的「想法」：标题即一楼正文（正文在二楼，即下方第一个楼层）
            <div
              ref={mainPostContentRef}
              style={{ fontSize: 22, lineHeight: 1.5, fontWeight: 600, color: "#1a1a1a", userSelect: "text", position: "relative", cursor: "text" }}
            >
              {thread.title || "（无标题）"}
            </div>
          ) : (
            <div
              ref={mainPostContentRef}
              style={{ fontSize: 15, lineHeight: 1.8, color: "#1a1a1a", userSelect: "text", position: "relative", cursor: "text" }}
            >
              {thread.text}
              {mainPostHighlights.map((rect, i) => (
                <div key={i} style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: "rgba(23,55,8,0.18)", borderRadius: 2, pointerEvents: "none" }} />
              ))}
            </div>
          )}

          {/* 查看历史对话 — absolute bottom-left，仅当本帖由上级楼层的批注派生而来（非根帖）时显示 */}
          {thread.rootThreadId != null && (
            <button
              onClick={openHistory}
              title="回溯本帖批注所回复的楼层，直至第一级"
              style={{ position: "absolute", left: 14, bottom: 16, display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.accent, fontSize: 12, opacity: 0.6 }}
            >
              <img src="/Threads_style/回到.png" alt="" style={{ width: 16, height: 16, opacity: 0.75 }} />
              查看历史对话
            </button>
          )}

          {/* 回到原文 — absolute bottom-left */}
          {thread.pdfFile && (
            <a
              href={`http://localhost:3002/pdf-viewer?file=${thread.pdfFile}&page=${thread.pageNumber ?? 1}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ position: "absolute", left: 14, bottom: 16, display: "flex", alignItems: "center", gap: 5, color: COLORS.accent, textDecoration: "none", fontSize: 12, opacity: 0.6 }}
              title="回到PDF原文"
            >
              <img src="/Threads_style/回到.png" alt="回到" style={{ width: 16, height: 16, opacity: 0.75 }} />
              回到原文
            </a>
          )}
          {!thread.pdfFile && thread.videoFile && (
            <a
              href={`http://localhost:3002/video-viewer?file=${thread.videoFile}&t=${Math.floor(thread.videoTime ?? 0)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ position: "absolute", left: 14, bottom: 16, display: "flex", alignItems: "center", gap: 5, color: COLORS.accent, textDecoration: "none", fontSize: 12, opacity: 0.6 }}
              title="回到视频"
            >
              <img src="/Threads_style/回到.png" alt="回到" style={{ width: 16, height: 16, opacity: 0.75 }} />
              回到视频
            </a>
          )}

          {/* 主楼快捷指标 — 纵向排列于右下角（与来源批注共享指标数据，待后端实现） */}
          <div style={{ position: "absolute", right: 24, bottom: 16 }}>
            <QuickIndicatorsVertical iconSize={15} />
          </div>

          {/* 排序切换 — 主楼右上角文字链接（仅一级帖；有楼主精选或本人为帖主时显示） */}
          {showSortBar && (
            <div style={{
              position: "absolute", right: 24, top: 16,
              display: "flex", alignItems: "center", gap: 6, fontSize: 12,
            }}>
              <span
                onClick={() => setSortMode("default")}
                style={{
                  cursor: "pointer",
                  color: sortMode === "default" ? COLORS.accent : "#aaa",
                  fontWeight: sortMode === "default" ? 600 : 400,
                }}
              >默认排序</span>
              <span style={{ color: "#ddd" }}>/</span>
              <span
                onClick={() => { if (hasOwnerSort) setSortMode("owner"); else if (isOwner) openOwnerEdit(); }}
                title={hasOwnerSort ? "楼主精选" : (isOwner ? "点击设置楼主精选" : "帖主尚未设置楼主精选")}
                style={{
                  cursor: (hasOwnerSort || isOwner) ? "pointer" : "default",
                  color: sortMode === "owner" ? COLORS.accent : (hasOwnerSort || isOwner ? "#aaa" : "#ddd"),
                  fontWeight: sortMode === "owner" ? 600 : 400,
                }}
              >楼主精选</span>
              {isOwner && (
                <span
                  onClick={openOwnerEdit}
                  title={hasOwnerSort ? "编辑楼主精选" : "设置楼主精选"}
                  style={{ cursor: "pointer", color: COLORS.accent, opacity: 0.65, marginLeft: 2 }}
                >（{hasOwnerSort ? "编辑" : "设置"}）</span>
              )}
            </div>
          )}

          {/* 高度拖拽柄：底部细条，鼠标 row-resize */}
          <div
            onMouseDown={handleMainPostResize}
            title="拖动调整主楼区域高度"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 6,
              cursor: "row-resize",
              zIndex: 20,
            }}
          />
        </div>

        {/* ── Content Row: floors + sidebar ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* 排序切换已移入主楼区域（见上方主楼右下角的「默认排序 / 楼主精选」文字链接） */}

          {/* Scrollable Floors */}
          <div
            ref={scrollAreaRef}
            style={{ flex: 1, overflowY: "auto" }}
          >
            {displayList.map((item) =>
              item.kind === "root"
                ? renderRootFloor(item.reply, item.floorNo)
                : renderPromotedFloor(item.floor)
            )}

            {replies.length === 0 && (
              <div style={{ textAlign: "center", color: "#bbb", padding: "56px 0", fontSize: 13 }}>
                选中主楼文字，或点击下方按钮创建第一个楼层
              </div>
            )}
          </div>

          {/* ── Add Floor Footer ── */}
          <div style={{
            flexShrink: 0,
            position: "relative",
            // 右侧让位批注栏宽度，回复输入区与楼层正文对齐，不被埋入批注栏
            padding: `10px ${sidebarWidth + 20}px 10px 52px`,
          } as React.CSSProperties}>
            {/* 顶部分隔线（左右各留出距离，与楼层分隔线对齐） */}
            <div style={{ position: "absolute", top: 0, left: 52, right: sidebarWidth + 52, height: 1, backgroundColor: COLORS.divider }} />
            {showAddFloor ? (
              <div>
                <textarea
                  value={addFloorText}
                  onChange={(e) => setAddFloorText(e.target.value)}
                  placeholder="输入楼层内容…"
                  autoFocus
                  style={{ width: "100%", height: 72, padding: "7px 10px", border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 13, resize: "none", boxSizing: "border-box", outline: "none", fontFamily: "inherit", background: "white" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitAddFloor();
                    if (e.key === "Escape") { setShowAddFloor(false); setAddFloorText(""); }
                  }}
                />
                <div style={{ marginTop: 6 }}>
                  <VisibilityPicker size="compact"
                    value={submitVisibility} onChange={setSubmitVisibility} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={() => { setShowAddFloor(false); setAddFloorText(""); setSubmitVisibility(2); }} style={{ flex: 1, padding: "5px 0", background: "#f5f5f2", border: `1px solid ${COLORS.border}`, borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                    取消
                  </button>
                  <button onClick={handleSubmitAddFloor} style={{ flex: 2, padding: "5px 0", background: COLORS.nav, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                    发布楼层
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "#ccc", textAlign: "right", marginTop: 3 }}>⌘↵ 发送 · Esc 取消</div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddFloor(true)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "7px 16px", cursor: "pointer", color: "#272826", fontSize: 13 }}
              >
                <img src="/Threads_style/Message square.png" alt="回复" style={{ width: 16, height: 16, opacity: 0.75 }} />
                回复主楼
              </button>
            )}
          </div>
        </div>

        {/* ── Right Annotation Sidebar — overlay, does not affect floor layout ── */}
        <div
          ref={sidebarRef}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: sidebarWidth,
            zIndex: 5,
            background: [
              "linear-gradient(to right,",
              "#F7F8F7 0px,#F7F8F7 1px,",
              "#F0F0E9 1px,#F0F0E9 2px,",
              "#F1F1EA 2px,#F1F1EA 4px,",
              "#F1F2EB 4px,#F1F2EB 6px,",
              "#F2F2EC 6px,#F2F2EC 8px,",
              "#F3F3ED 8px,#F3F3ED 11px,",
              "#F4F4ED 11px,#F4F4ED 14px,",
              "#F5F5EE 14px,#F5F5EE 17px,",
              "#F5F6EF 17px,#F5F6EF 21px,",
              "#F6F6F0 21px,#F6F6F0 27px,",
              "#F7F7F1 27px,#F7F7F1 calc(100% - 28px),",
              "#F7F8F1 calc(100% - 28px),#F7F8F1 calc(100% - 22px),",
              "#F7F8F2 calc(100% - 22px),#F7F8F2 calc(100% - 18px),",
              "#F7F8F3 calc(100% - 18px),#F7F8F3 calc(100% - 14px),",
              "#F7F8F4 calc(100% - 14px),#F7F8F4 calc(100% - 11px),",
              "#F7F8F5 calc(100% - 11px),#F7F8F5 calc(100% - 6px),",
              "#F7F8F6 calc(100% - 6px),#F7F8F6 calc(100% - 4px),",
              "#F7F8F7 calc(100% - 4px),#F7F8F7 100%)",
            ].join(""),
            borderLeft: "none",
            overflow: "hidden",
          } as React.CSSProperties}
        >
          {/* Drag handle — left edge */}
          <div
            style={{
              position: "absolute",
              left: 0, top: 0, bottom: 0,
              width: 5,
              cursor: "col-resize",
              zIndex: 20,
            }}
            onMouseDown={handleSidebarDragMouseDown}
          />

          {/* Empty state */}
          {allAnnotations.length === 0 && (
            <div style={{ padding: "20px 14px", color: "#ccc", fontSize: 12, textAlign: "center", lineHeight: 1.6, marginTop: 20 }}>
              选中楼层文字
              <br />
              添加批注
            </div>
          )}

          {/* Annotation cards — absolutely positioned, horizontally stacked */}
          {annotationPositions.map((anno) => {
            const left = anno.indentOffset + wheelDelta;
            const isHovered = hoveredAnnotationId === anno.id;
            const faded = hoveredAnnotationId !== null && !isHovered;
            // Clip cards that are well outside the visible area
            const isVisible = anno.topOffset > -CARD_HEIGHT - 20 && anno.topOffset < sidebarHeight + 20;

            return (
              <div
                key={anno.id}
                onMouseEnter={() => {
                  setHoveredAnnotationId(anno.id);
                  highlightFloorText(anno);
                }}
                onMouseLeave={() => {
                  setHoveredAnnotationId(null);
                  setFloorHighlights([]);
                }}
                onDoubleClick={async () => {
                  // anno.id 是批注 ID，需先经 /api/threads/create 拿到对应 threadId
                  try {
                    const r = await axios.post("http://localhost:3001/api/threads/create", {
                      annotationId: anno.id,
                      userName: anno.userName || "Current User",
                    });
                    router.push(`/threads/${r.data.threadId}`);
                  } catch (err) {
                    console.error("打开/创建帖子失败", err);
                  }
                }}
                style={{
                  position: "absolute",
                  top: anno.topOffset - CARD_HEIGHT / 2,
                  left: left + 8,
                  width: CARD_WIDTH,
                  background: "rgba(255,255,255,0.96)",
                  borderRadius: 5,
                  boxShadow: isHovered ? COLORS.cardShadowHover : COLORS.cardShadow,
                  padding: "10px 12px 8px 12px",
                  transition: "box-shadow 0.18s, left 0.1s, opacity 0.15s",
                  cursor: "default",
                  zIndex: isHovered ? 10 : 1,
                  opacity: faded ? 0.22 : 1,
                  visibility: isVisible ? "visible" : "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  {anno.userName && (
                    <UserAvatar userName={anno.userName} size={16} />
                  )}
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: COLORS.nav }}>{anno.userName}</span>
                  <img
                    src="/Threads_style/进度标记符.png" alt="收录" title="收录到笔记板"
                    style={{ width: 13, height: 13, opacity: 0.3, cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0 }}
                    onMouseEnter={e => { (e.currentTarget.style.opacity = "0.85"); showDeployHover(e, "annotation", anno.id); }}
                    onMouseLeave={e => { (e.currentTarget.style.opacity = "0.3"); setDeployHover(null); }}
                    onClick={e => openClassify(e, {
                      itemType: "annotation",
                      resourceId: anno.id,
                      title: anno.text.slice(0, 40),
                      textContent: anno.text,
                      threadId: thread.id,
                    })}
                  />
                  <span style={{ flex: 1, fontSize: 9, color: "#bbb", textAlign: "right" }}>
                    {anno.createdAt ? new Date(anno.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.65, color: "#333" }}>{anno.text}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <AnnotationIndicators compact />
                  <button
                    title="更多"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", opacity: 0.4, fontSize: 14, color: "#555", lineHeight: 1 }}
                    onClick={(e) => e.stopPropagation()}
                  >···</button>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* ── 归类面板 ── */}
      {/* 部署信息悬停弹窗 */}
      {deployHover?.data && deployHover.data.length > 0 && (
        <div style={{
          position: "fixed",
          left: Math.min(deployHover.x + 14, window.innerWidth - 220),
          top: Math.max(deployHover.y - 10, 8),
          zIndex: 9999,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
          padding: "8px 12px", minWidth: 180, pointerEvents: "none", fontFamily: "inherit",
        }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 5 }}>已被收录至</div>
          {deployHover.data.map((d, i) => (
            <div key={i} style={{ fontSize: 12, color: "#1a2e1a", padding: "2px 0",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.user_name} · {d.board_title}
            </div>
          ))}
        </div>
      )}

      {classifyTarget && (
        <div
          style={{
            position: "fixed", left: classifyPos.x, top: classifyPos.y,
            zIndex: 2000, background: "#fff",
            border: "1px solid #e5e7eb", borderRadius: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
            width: 256, padding: "14px 16px",
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2e1a" }}>归类到笔记板</span>
            <button onClick={() => setClassifyTarget(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {classifyTarget.title}
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 10 }}>
            {classifyBoards.length === 0
              ? <div style={{ fontSize: 12, color: "#b0b0b0", padding: "4px 0" }}>暂无笔记板</div>
              : classifyBoards.map(b => (
                <label key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 6px", borderRadius: 6, cursor: "pointer",
                  background: classifySelectedBoard === b.id ? "#f0fdf4" : "transparent",
                  fontSize: 13, color: "#374151",
                }}>
                  <input type="radio" name="thread-board" checked={classifySelectedBoard === b.id}
                    onChange={() => { setClassifySelectedBoard(b.id); setClassifyNewTitle(""); }}
                    style={{ accentColor: "#16a34a" }} />
                  {b.title}
                </label>
              ))
            }
          </div>
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>新建笔记板</div>
            <input type="text" placeholder="输入名称…" value={classifyNewTitle}
              onChange={e => { setClassifyNewTitle(e.target.value); setClassifySelectedBoard(null); }}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 8px", fontSize: 12,
                border: `1px solid ${classifyNewTitle ? "#16a34a" : "#d1d5db"}`,
                borderRadius: 6, outline: "none",
              }} />
          </div>
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>添加笔记（可选）</div>
            <textarea
              placeholder="部署时将自动生成连线文本框…"
              value={classifyNoteText}
              onChange={e => setClassifyNoteText(e.target.value)}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 8px", fontSize: 12,
                border: "1px solid #d1d5db", borderRadius: 6,
                outline: "none", resize: "none",
                fontFamily: "inherit", lineHeight: 1.5,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setClassifyTarget(null)} style={{
              flex: 1, padding: "6px 0", fontSize: 12,
              border: "1px solid #d1d5db", borderRadius: 6,
              background: "transparent", color: "#6b7280", cursor: "pointer",
            }}>取消</button>
            <button
              disabled={classifying || (!classifySelectedBoard && !classifyNewTitle.trim())}
              onClick={handleClassify}
              style={{
                flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 500,
                border: "none", borderRadius: 6,
                background: (classifySelectedBoard || classifyNewTitle.trim()) ? "#16a34a" : "#d1d5db",
                color: "#fff",
                cursor: (classifySelectedBoard || classifyNewTitle.trim()) ? "pointer" : "default",
              }}>
              {classifying ? "归类中…" : "归类"}
            </button>
          </div>
        </div>
      )}

      {/* ── Annotation Detail Modal (double-click) ── */}
      {dblClickAnnotation && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            background: "rgba(0,0,0,0.38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setDblClickAnnotation(null)}
        >
          <div
            style={{
              width: "66vw",
              height: "66vh",
              background: COLORS.bg,
              borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
              display: "flex",
              flexDirection: "row",
              overflow: "hidden",
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Left panel — context / selected text */}
            <div style={{
              width: "38%",
              borderRight: `1.5px solid ${COLORS.divider}`,
              background: "rgba(23,55,8,0.04)",
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              overflowY: "auto",
            }}>
              <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>锚定文本</div>
              {dblClickAnnotation.selectedText ? (
                <div style={{
                  borderLeft: `3px solid ${COLORS.nav}`,
                  paddingLeft: 14,
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: "#555",
                  fontStyle: "italic",
                }}>
                  &ldquo;{dblClickAnnotation.selectedText}&rdquo;
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#bbb" }}>无选中文本</div>
              )}
            </div>

            {/* Right panel — annotation content */}
            <div style={{
              flex: 1,
              padding: "28px 28px 20px 28px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                {dblClickAnnotation.userName && (
                  <UserAvatar userName={dblClickAnnotation.userName} size={34} />
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.nav }}>{dblClickAnnotation.userName}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>
                    {dblClickAnnotation.createdAt ? new Date(dblClickAnnotation.createdAt).toLocaleString() : ""}
                  </div>
                </div>
                <button
                  onClick={() => setDblClickAnnotation(null)}
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "2px 6px" }}
                >×</button>
              </div>

              {/* Annotation text */}
              <div style={{ flex: 1, overflowY: "auto", fontSize: 15, lineHeight: 1.85, color: "#1a1a1a" }}>
                {dblClickAnnotation.text}
              </div>

              {/* Footer */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${COLORS.divider}` }}>
                <AnnotationIndicators />
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => {
                    setDblClickAnnotation(null);
                    router.push(`/threads/${dblClickAnnotation.id}`);
                  }}
                  style={{
                    padding: "6px 18px",
                    background: COLORS.nav,
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  进入帖子 →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 历史对话弹窗 ── */}
      {historyOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "rgba(0,0,0,0.38)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setHistoryOpen(false)}
        >
          <div
            style={{
              width: "min(640px, 80vw)", maxHeight: "78vh",
              background: COLORS.bg, borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", padding: "18px 22px", borderBottom: `1px solid ${COLORS.divider}` }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.nav }}>历史对话</span>
              <span style={{ fontSize: 11, color: "#aaa", marginLeft: 10 }}>从当前帖子的批注回溯到第一级</span>
              <button
                onClick={() => setHistoryOpen(false)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "2px 6px" }}
              >×</button>
            </div>

            <div style={{ padding: "18px 22px", overflowY: "auto" }}>
              {historyChain === null && (
                <div style={{ textAlign: "center", color: "#bbb", fontSize: 13, padding: "30px 0" }}>加载中…</div>
              )}
              {historyChain !== null && historyChain.length === 0 && (
                <div style={{ textAlign: "center", color: "#bbb", fontSize: 13, padding: "30px 0" }}>暂无历史对话</div>
              )}
              {/* 按从上到下（最早的第一级 → 当前帖子）排列：后端返回的链是「当前 → 源头」，此处倒序渲染 */}
              {historyChain !== null && [...historyChain].reverse().map((entry, i, arr) => {
                const isCurrent = i === arr.length - 1;

                // 链首：第一级帖子的「主楼」本身（独立展示，无所回复的楼层）
                if (entry.isRootMainPost) {
                  return (
                    <div key={`root-${entry.threadId}`} style={{ marginBottom: 14 }}>
                      <button
                        onClick={() => { setHistoryOpen(false); router.push(`/threads/${entry.threadId}`); }}
                        title="跳转到第一级帖子"
                        style={{
                          width: "100%", textAlign: "left", cursor: "pointer",
                          border: `1px solid ${COLORS.nav}`, borderRadius: 8,
                          padding: "10px 14px", background: "rgba(23,55,8,0.04)",
                        }}
                      >
                        <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4 }}>
                          第一级帖子 · 主楼{entry.mainPost?.createdBy ? ` · ${entry.mainPost.createdBy}` : ""}
                        </div>
                        {entry.selectedText && (
                          <div style={{ borderLeft: `2px solid rgba(23,55,8,0.3)`, paddingLeft: 8, fontSize: 11, color: "#999", fontStyle: "italic", marginBottom: 6 }}>
                            &ldquo;{entry.selectedText.substring(0, 60)}{entry.selectedText.length > 60 ? "…" : ""}&rdquo;
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: "#2a2a2a", lineHeight: 1.6 }}>{entry.annotationText}</div>
                      </button>

                      {!isCurrent && (
                        <div style={{ height: 14, borderLeft: `2px dotted ${COLORS.divider}`, marginLeft: 22, marginTop: 4 }} />
                      )}
                    </div>
                  );
                }

                return (
                <div key={entry.threadId} style={{ marginBottom: 14 }}>
                  {/* 该批注所回复（锚定）的楼层 —— 时间在前，置于上方 */}
                  {entry.floor && (
                    <button
                      onClick={() => { setHistoryOpen(false); router.push(`/threads/${entry.floor!.threadId}#reply-${entry.floor!.replyId}`); }}
                      title="跳转到该楼层所在帖子"
                      style={{
                        width: "100%", textAlign: "left", cursor: "pointer",
                        border: `1px dashed ${COLORS.border}`, borderRadius: 8,
                        padding: "10px 14px", background: "#fafaf6",
                      }}
                    >
                      <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4 }}>
                        楼层 #{entry.floor.floorNumber} · {entry.floor.createdBy}
                      </div>
                      <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>
                        {entry.floor.text.substring(0, 120)}{entry.floor.text.length > 120 ? "…" : ""}
                      </div>
                    </button>
                  )}

                  {/* 该帖的主楼批注 —— 由上方楼层派生，置于下方 */}
                  <div style={{ display: "flex", justifyContent: "center", color: "#bbb", fontSize: 11, margin: "6px 0" }}>↓ 批注回复</div>
                  <div style={{
                    border: `1px solid ${COLORS.border}`, borderRadius: 8,
                    padding: "10px 14px", background: isCurrent ? "rgba(23,55,8,0.05)" : "#fff",
                  }}>
                    <div style={{ fontSize: 10, color: "#aaa", marginBottom: 4 }}>
                      {isCurrent ? "当前帖子 · 主楼批注" : "上级帖子 · 主楼批注"}
                    </div>
                    {entry.selectedText && (
                      <div style={{ borderLeft: `2px solid rgba(23,55,8,0.3)`, paddingLeft: 8, fontSize: 11, color: "#999", fontStyle: "italic", marginBottom: 6 }}>
                        &ldquo;{entry.selectedText.substring(0, 60)}{entry.selectedText.length > 60 ? "…" : ""}&rdquo;
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: "#2a2a2a", lineHeight: 1.6 }}>{entry.annotationText}</div>
                  </div>

                  {!isCurrent && (
                    <div style={{ height: 14, borderLeft: `2px dotted ${COLORS.divider}`, marginLeft: 22, marginTop: 4 }} />
                  )}
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Selection Popup ── */}
      {selectionInfo && (
        <div
          style={{
            position: "fixed",
            left: selectionInfo.popupX,
            top: selectionInfo.popupY,
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "white",
            borderRadius: 8,
            boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
            padding: "14px 16px",
            width: 300,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10, fontStyle: "italic", borderLeft: "2px solid rgba(23,55,8,0.3)", paddingLeft: 8 }}>
            &ldquo;{selectionInfo.text.substring(0, 70)}{selectionInfo.text.length > 70 ? "…" : ""}&rdquo;
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: COLORS.accent }}>
            {selectionInfo.inMainPost ? "创建楼层" : "添加批注"}
          </div>

          <textarea
            value={selectionInfo.inMainPost ? newReplyText : newAnnotationText}
            onChange={(e) =>
              selectionInfo.inMainPost ? setNewReplyText(e.target.value) : setNewAnnotationText(e.target.value)
            }
            placeholder={selectionInfo.inMainPost ? "输入楼层内容…" : "输入批注内容…"}
            style={{ width: "100%", height: 76, padding: "7px 9px", border: `1px solid ${COLORS.border}`, borderRadius: 5, fontSize: 13, resize: "none", boxSizing: "border-box", outline: "none", fontFamily: "inherit" }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                selectionInfo.inMainPost ? handleSubmitReply() : handleSubmitAnnotation();
              }
              if (e.key === "Escape") dismissSelection();
            }}
          />

          <div style={{ marginTop: 8 }}>
            <VisibilityPicker size="compact"
              value={submitVisibility} onChange={setSubmitVisibility} />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={dismissSelection} style={{ flex: 1, padding: "6px 0", background: "#f5f5f2", border: `1px solid ${COLORS.border}`, borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
              取消
            </button>
            <button
              onClick={selectionInfo.inMainPost ? handleSubmitReply : handleSubmitAnnotation}
              style={{ flex: 1, padding: "6px 0", background: COLORS.nav, color: "white", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
            >
              {selectionInfo.inMainPost ? "发布楼层" : "提交批注"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#ccc", textAlign: "right", marginTop: 4 }}>⌘↵ 发送 · Esc 取消</div>
        </div>
      )}
    </div>

    {/* ── 编辑楼主排序弹窗（仅帖主） ── */}
    {ownerEditOpen && (
      <div
        style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.38)", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={() => setOwnerEditOpen(false)}
      >
        <div
          style={{
            width: "min(760px, 88vw)", maxHeight: "82vh",
            background: COLORS.bg, borderRadius: 12,
            boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", padding: "16px 22px", borderBottom: `1px solid ${COLORS.divider}` }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.nav }}>编辑楼主排序</span>
            <span style={{ fontSize: 11, color: "#aaa", marginLeft: 10 }}>勾选要前排展示的楼层（可来自子帖），右侧调整顺序</span>
            <button onClick={() => setOwnerEditOpen(false)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af", lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>

          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* 左：候选楼层（整棵帖子树） */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", borderRight: `1px solid ${COLORS.divider}` }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>全部楼层（本帖 + 子帖）</div>
              {treeFloors.length === 0 && (
                <div style={{ fontSize: 12, color: "#bbb", padding: "12px 0" }}>暂无楼层</div>
              )}
              {treeFloors.map((f) => {
                const checked = editSelection.includes(f.replyId);
                const text = f.content.blocks.map((b) => b.content ?? "").join(" ");
                return (
                  <label key={f.replyId} style={{
                    display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 8px",
                    borderRadius: 6, cursor: "pointer",
                    background: checked ? "#f0fdf4" : "transparent",
                  }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleEditFloor(f.replyId)}
                      style={{ accentColor: "#16a34a", marginTop: 3 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>
                        {f.isSubThread ? `子帖「${f.threadLabel || `#${f.threadId}`}」· #${f.floorNumber}` : `本帖 · #${f.floorNumber}`} · {f.createdBy}
                      </div>
                      <div style={{ fontSize: 12, color: "#333", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {text || "（无文本）"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* 右：已选顺序 */}
            <div style={{ width: 300, overflowY: "auto", padding: "12px 16px" }}>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>前排顺序（自上而下）</div>
              {editSelection.length === 0 && (
                <div style={{ fontSize: 12, color: "#bbb", padding: "12px 0" }}>尚未勾选楼层</div>
              )}
              {editSelection.map((rid, idx) => {
                const f = treeFloors.find((x) => x.replyId === rid);
                const text = f ? f.content.blocks.map((b) => b.content ?? "").join(" ") : `楼层 #${rid}`;
                return (
                  <div key={rid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, background: "#fafaf6", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: COLORS.accent, fontWeight: 600, width: 16 }}>{idx + 1}</span>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {text || "（无文本）"}
                    </div>
                    <button onClick={() => moveEditFloor(idx, -1)} disabled={idx === 0}
                      style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#ddd" : "#777", fontSize: 12, padding: "0 2px" }}>▲</button>
                    <button onClick={() => moveEditFloor(idx, 1)} disabled={idx === editSelection.length - 1}
                      style={{ background: "none", border: "none", cursor: idx === editSelection.length - 1 ? "default" : "pointer", color: idx === editSelection.length - 1 ? "#ddd" : "#777", fontSize: 12, padding: "0 2px" }}>▼</button>
                    <button onClick={() => toggleEditFloor(rid)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#c0392b", fontSize: 14, padding: "0 2px" }}>×</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 22px", borderTop: `1px solid ${COLORS.divider}` }}>
            <button onClick={() => setOwnerEditOpen(false)}
              style={{ padding: "7px 18px", fontSize: 13, border: `1px solid ${COLORS.border}`, borderRadius: 6, background: "transparent", color: "#6b7280", cursor: "pointer" }}>取消</button>
            <button onClick={saveOwnerSort} disabled={savingSort}
              style={{ padding: "7px 22px", fontSize: 13, fontWeight: 500, border: "none", borderRadius: 6, background: COLORS.nav, color: "#fff", cursor: savingSort ? "default" : "pointer" }}>
              {savingSort ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    )}

    {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </>
  );
};

export default ThreadPage;
