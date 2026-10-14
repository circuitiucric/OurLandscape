"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import VisibilityPicker from "../components/VisibilityPicker";

interface VideoAnnotation {
  id: number;
  videoFile: string;
  videoTime: number;
  text: string;
  userName: string;
  createdAt: string;
}

interface ActivePopup {
  key: number;
  annotation: VideoAnnotation;
}

interface Deployment {
  board_id: number;
  board_title: string;
  user_name: string;
  reading_progress: { videoTime?: number } | null;
  note_text: string | null;
  text_content: string | null;
}

const ACCENT = "#173708";
const PAGE_BG = "#fffef7";

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

const VideoViewer: React.FC = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file") || "";
  const startTime = parseFloat(searchParams?.get("t") || "");
  const fileUrl = `http://localhost:3001/video/${file}`;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [curTime, setCurTime] = useState(0);
  const lastTimeRef = useRef(0);

  const [resourceId, setResourceId] = useState<number | null>(null);
  const [resourceTitle, setResourceTitle] = useState<string | null>(null);

  const [annotations, setAnnotations] = useState<VideoAnnotation[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [activePopups, setActivePopups] = useState<ActivePopup[]>([]);
  const popupKeyRef = useRef(0);

  // 批注栏默认收起；右侧白色竖条提示批注数量
  const [panelOpen, setPanelOpen] = useState(false);

  // 进度标识符（笔记板部署点）
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [markerHover, setMarkerHover] = useState(false);

  // 创建批注表单
  const [showForm, setShowForm] = useState(false);
  const [formText, setFormText] = useState("");
  const [formTime, setFormTime] = useState(0);
  const [formVisibility, setFormVisibility] = useState<0 | 1 | 2>(2);
  const [submitting, setSubmitting] = useState(false);

  // 当前用户
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      setMe(payload?.userName || null);
    } catch {}
  }, []);

  // 注册视频资源
  useEffect(() => {
    if (!file) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.post(
      "http://localhost:3001/api/resources/register",
      { type: "video", identifier: file, title: decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, "") },
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => { setResourceId(r.data.id); setResourceTitle(r.data.title ?? null); }).catch(console.error);
  }, [file]);

  // 拉取批注
  useEffect(() => {
    if (!file) return;
    axios.get(`http://localhost:3001/api/annotations?videoFile=${encodeURIComponent(file)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    }).then(r => setAnnotations(
      (r.data as VideoAnnotation[]).sort((a, b) => a.videoTime - b.videoTime)
    )).catch(console.error);
  }, [file]);

  // 拉取笔记板部署点（进度标识符数据源）
  const refetchDeployments = useCallback(() => {
    if (!resourceId) return;
    axios.get(
      `http://localhost:3001/api/noteboards/deployments?item_type=video&resource_id=${resourceId}`,
      { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
    ).then(r => setDeployments(r.data as Deployment[])).catch(console.error);
  }, [resourceId]);
  useEffect(() => { refetchDeployments(); }, [refetchDeployments]);

  // 每 30 秒保存阅读进度
  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.duration) return;
      axios.post(
        `http://localhost:3001/api/resources/${resourceId}/history`,
        {
          pageNumber: Math.floor(v.currentTime),
          progressPercent: Math.round((v.currentTime / v.duration) * 100),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(console.error);
    }, 30_000);
    return () => clearInterval(interval);
  }, [resourceId]);

  // 进度更新 + 触发腾讯式弹幕
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const cur = v.currentTime;
    const prev = lastTimeRef.current;
    if (cur > prev) {
      annotations.forEach((a) => {
        if (a.videoTime > prev && a.videoTime <= cur) {
          const key = ++popupKeyRef.current;
          setActivePopups((list) => [...list, { key, annotation: a }]);
          setTimeout(() => {
            setActivePopups((list) => list.filter((p) => p.key !== key));
          }, 5000);
        }
      });
    }
    lastTimeRef.current = cur;
    setCurTime(cur);
  }, [annotations]);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    lastTimeRef.current = Math.max(0, t - 0.01);
    v.currentTime = Math.max(0, t);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    if (!isNaN(startTime) && startTime > 0) {
      seekTo(startTime);
    }
  };

  // 打开/创建批注帖子
  const openThread = (annotationId: number) => {
    axios.post("http://localhost:3001/api/threads/create", {
      annotationId,
      userName: me || "Current User",
    }).then((r) => {
      // 以普通新标签页打开，保留浏览器的历史、收藏、前进/后退等功能（不要用带尺寸的弹窗）
      window.open(
        `http://localhost:3002/threads/${r.data.threadId}?sw=150`,
        "_blank",
        "noopener,noreferrer"
      );
    }).catch(console.error);
  };

  // 开始创建批注：暂停并记录当前时间
  const beginAnnotation = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setFormTime(v.currentTime);
    setFormText("");
    setFormVisibility(2);
    setShowForm(true);
  };

  const submitAnnotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formText.trim() || !file) return;
    setSubmitting(true);
    try {
      const r = await axios.post(
        "http://localhost:3001/api/annotations",
        {
          videoFile: file,
          videoTime: formTime,
          text: formText.trim(),
          visibilityLevel: formVisibility,
        },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      setAnnotations((list) =>
        [...list, r.data as VideoAnnotation].sort((a, b) => a.videoTime - b.videoTime)
      );
      setShowForm(false);
      setFormText("");
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 归类到笔记板 ──
  const [showClassify, setShowClassify] = useState(false);
  const [classifyTime, setClassifyTime] = useState(0);
  const [classifyBoards, setClassifyBoards] = useState<{ id: number; title: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [classifyNoteText, setClassifyNoteText] = useState("");
  const [classifying, setClassifying] = useState(false);

  useEffect(() => {
    if (!showClassify) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.get("http://localhost:3001/api/noteboards", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => setClassifyBoards(r.data)).catch(console.error);
  }, [showClassify]);

  const beginClassify = () => {
    const v = videoRef.current;
    setClassifyTime(v ? v.currentTime : 0);
    setShowClassify(true);
  };

  const handleClassify = async () => {
    if (!resourceId) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    setClassifying(true);
    try {
      let boardId = selectedBoardId;
      if (!boardId && newBoardTitle.trim()) {
        const r = await axios.post(
          "http://localhost:3001/api/noteboards",
          { title: newBoardTitle.trim() },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        boardId = r.data.id;
      }
      if (!boardId) return;
      await axios.post(
        `http://localhost:3001/api/noteboards/${boardId}/items`,
        {
          item_type: "video",
          resource_id: resourceId,
          title: resourceTitle || (file ? decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, "") : "视频"),
          note_text: classifyNoteText.trim() || null,
          reading_progress: { videoTime: classifyTime },
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowClassify(false);
      setSelectedBoardId(null);
      setNewBoardTitle("");
      setClassifyNoteText("");
      refetchDeployments();
    } catch (err) {
      console.error("归类失败", err);
    } finally {
      setClassifying(false);
    }
  };

  const sidebarW = 320;

  // ── 进度标识符：当前时间附近的部署点 ──
  const markerThreshold = Math.max(2, duration * 0.01);
  const nearMarkers = deployments.filter((d) => {
    const t = d.reading_progress?.videoTime;
    return typeof t === "number" && Math.abs(t - curTime) <= markerThreshold;
  });
  const nearMine = nearMarkers.some((d) => d.user_name === me);
  const hasNear = nearMarkers.length > 0;
  const markerIcon = nearMine
    ? "/Annotations_style/进度标识符-个人or确定中.png"
    : "/Annotations_style/进度标记符.png";
  const markerOpacity = nearMine ? 0.95 : hasNear ? 0.9 : 0.4;

  // 白色竖条长度 ∝ 批注数
  const barHeight = annotations.length
    ? Math.min(Math.max(annotations.length * 18, 44), 460)
    : 26;

  return (
    <div style={{ display: "flex", height: "100vh", background: PAGE_BG, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* 主区：视频 + 时间轴 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, minHeight: 0 }}>
          {file ? (
            <video
              ref={videoRef}
              src={fileUrl}
              controls
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              style={{ maxWidth: "100%", maxHeight: "100%", background: "#000", borderRadius: 6, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}
            />
          ) : (
            <div style={{ color: "#999" }}>未指定视频文件</div>
          )}
        </div>

        {/* 自定义时间轴 + 批注标记 */}
        <div style={{ padding: "0 28px 14px" }}>
          <div
            style={{ position: "relative", height: 26, marginBottom: 6, cursor: "pointer" }}
            onClick={(e) => {
              if (!duration) return;
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              seekTo(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            {/* 轨道 */}
            <div style={{ position: "absolute", top: 11, left: 0, right: 0, height: 4, background: "#dcdcd2", borderRadius: 2 }} />
            {/* 已播放 */}
            <div style={{ position: "absolute", top: 11, left: 0, width: duration ? `${(curTime / duration) * 100}%` : 0, height: 4, background: ACCENT, borderRadius: 2 }} />
            {/* 批注标记 */}
            {duration > 0 && annotations.map((a) => (
              <div
                key={a.id}
                title={`${fmt(a.videoTime)} · ${a.text}`}
                onClick={(e) => { e.stopPropagation(); seekTo(a.videoTime); }}
                onMouseEnter={() => setHoveredId(a.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  position: "absolute",
                  top: 4,
                  left: `${(a.videoTime / duration) * 100}%`,
                  transform: "translateX(-50%)",
                  width: hoveredId === a.id ? 12 : 9,
                  height: hoveredId === a.id ? 12 : 9,
                  borderRadius: "50%",
                  background: hoveredId === a.id ? "#FF5722" : "#FFC107",
                  border: "1.5px solid #fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  cursor: "pointer",
                  transition: "width 0.1s, height 0.1s, background 0.1s",
                }}
              />
            ))}
            {/* 进度标识符标记（笔记板部署点） */}
            {duration > 0 && deployments.map((d, i) => {
              const t = d.reading_progress?.videoTime;
              if (typeof t !== "number") return null;
              const mine = d.user_name === me;
              return (
                <div
                  key={`dep-${i}`}
                  title={`${fmt(t)} · ${d.board_title}（${d.user_name}）${d.note_text ? " · " + d.note_text : ""}`}
                  onClick={(e) => { e.stopPropagation(); seekTo(t); }}
                  style={{
                    position: "absolute",
                    top: 17,
                    left: `${(t / duration) * 100}%`,
                    transform: "translateX(-50%)",
                    width: 2,
                    height: 9,
                    background: mine ? ACCENT : "#9aa39a",
                    opacity: mine ? 0.9 : 0.6,
                    borderRadius: 1,
                    cursor: "pointer",
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#555", fontVariantNumeric: "tabular-nums" }}>
              {fmt(curTime)} / {fmt(duration)}
            </span>
            <button
              onClick={beginAnnotation}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", fontSize: 12, fontWeight: 600,
                background: ACCENT, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
              }}
            >
              ✎ 在 {fmt(curTime)} 添加批注
            </button>
            <div
              style={{ position: "relative" }}
              onMouseEnter={() => setMarkerHover(true)}
              onMouseLeave={() => setMarkerHover(false)}
            >
              <button
                onClick={beginClassify}
                title={hasNear ? "附近已有进度标识符 · 点击归类到笔记板" : "归类到笔记板"}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", fontSize: 12,
                  background: "rgba(255,255,255,0.9)", color: ACCENT,
                  border: "1px solid rgba(23,55,8,0.2)", borderRadius: 6, cursor: "pointer",
                }}
              >
                <img src={markerIcon} alt="" style={{ width: 18, height: 18, opacity: markerOpacity }} />
                归类到笔记板
              </button>
              {markerHover && hasNear && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 2200,
                  background: "#fff", border: "1px solid #e6e6dc", borderRadius: 8,
                  boxShadow: "0 6px 22px rgba(0,0,0,0.16)", padding: "8px 10px", width: 240,
                }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
                    附近的进度标识符（{fmt(curTime)} 附近）
                  </div>
                  {nearMarkers.map((d, i) => (
                    <a
                      key={`${d.board_id}-${i}`}
                      href={`http://localhost:3002/noteboard/${d.board_id}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ display: "block", textDecoration: "none", color: "inherit", padding: "5px 4px", borderRadius: 6 }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, color: ACCENT }}>
                        {d.board_title}
                        <span style={{ fontWeight: 400, color: "#999", marginLeft: 6 }}>{d.user_name}</span>
                      </div>
                      {(d.note_text || d.text_content) && (
                        <div style={{ fontSize: 11, color: "#666", marginTop: 2, lineHeight: 1.4 }}>
                          {d.note_text || d.text_content}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 收起态：右侧白色竖条，长度 ∝ 批注数 */}
      {!panelOpen && (
        <div
          onClick={() => setPanelOpen(true)}
          title={`展开批注栏 · ${annotations.length} 条批注`}
          style={{
            position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)",
            width: 6, height: barHeight, zIndex: 1200, cursor: "pointer",
            background: annotations.length ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
            borderRadius: "5px 0 0 5px",
            boxShadow: annotations.length
              ? "0 0 12px rgba(255,255,255,0.85), -1px 0 5px rgba(0,0,0,0.15)"
              : "-1px 0 4px rgba(0,0,0,0.1)",
            transition: "height 0.2s",
          }}
        />
      )}

      {/* 右侧批注栏（默认收起） */}
      {panelOpen && (
      <div style={{
        width: sidebarW, flexShrink: 0, background: "#f6f7f1",
        borderLeft: "1px solid #e6e6dc", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid #e6e6dc", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT }}>批注 · {annotations.length}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>双击批注进入讨论帖</div>
          </div>
          <button
            onClick={() => setPanelOpen(false)}
            title="收起批注栏"
            style={{ background: "none", border: "none", fontSize: 18, color: "#9aa39a", cursor: "pointer", lineHeight: 1, padding: 0 }}
          >
            »
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
          {annotations.length === 0 ? (
            <div style={{ fontSize: 12, color: "#bbb", textAlign: "center", marginTop: 32 }}>
              还没有批注，播放时点击「添加批注」即可在当前时间点留下批注
            </div>
          ) : (
            annotations.map((a) => (
              <div
                key={a.id}
                onMouseEnter={() => setHoveredId(a.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => seekTo(a.videoTime)}
                onDoubleClick={() => openThread(a.id)}
                style={{
                  background: "#fff",
                  border: `1px solid ${hoveredId === a.id ? "#FF9800" : "#eaeae0"}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 10,
                  cursor: "pointer",
                  boxShadow: hoveredId === a.id ? "0 2px 8px rgba(0,0,0,0.1)" : "0 1px 3px rgba(0,0,0,0.05)",
                  transition: "border-color 0.12s, box-shadow 0.12s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: ACCENT,
                    background: "rgba(23,55,8,0.08)", padding: "1px 6px", borderRadius: 4,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {fmt(a.videoTime)}
                  </span>
                  <span style={{ fontSize: 11, color: "#888" }}>{a.userName}</span>
                </div>
                <div style={{ fontSize: 13, color: "#333", lineHeight: 1.55, wordBreak: "break-word" }}>
                  {a.text}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* 命中节点弹出（贴右侧竖条，从下往上，5 秒） */}
      <div style={{
        position: "fixed", right: panelOpen ? sidebarW + 16 : 22, bottom: 90, zIndex: 1500,
        display: "flex", flexDirection: "column-reverse", alignItems: "flex-end", gap: 8, maxWidth: 360,
        pointerEvents: "none",
      }}>
        {activePopups.map((p) => (
          <div
            key={p.key}
            onDoubleClick={() => openThread(p.annotation.id)}
            style={{
              pointerEvents: "auto",
              background: "rgba(23,55,8,0.92)", color: "#fff",
              borderRadius: 10, padding: "10px 14px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              animation: "vpopin 0.25s ease-out",
              cursor: "pointer",
            }}
            title="双击进入讨论帖"
          >
            <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 3 }}>
              {p.annotation.userName} · {fmt(p.annotation.videoTime)}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{p.annotation.text}</div>
          </div>
        ))}
      </div>
      <style>{`@keyframes vpopin{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}`}</style>

      {/* 创建批注表单 */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowForm(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", width: 440, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>在 {fmt(formTime)} 添加批注</span>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", fontSize: 20, color: "#bbb", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <form onSubmit={submitAnnotation} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                placeholder="输入批注内容…"
                autoFocus
                rows={4}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #ddd", borderRadius: 8, fontSize: 13, resize: "vertical", fontFamily: "inherit", outline: "none" }}
              />
              <VisibilityPicker size="compact" value={formVisibility} onChange={setFormVisibility} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowForm(false)}
                  style={{ padding: "8px 16px", fontSize: 13, border: "1px solid #ddd", borderRadius: 6, background: "transparent", color: "#666", cursor: "pointer" }}>
                  取消
                </button>
                <button type="submit" disabled={submitting || !formText.trim()}
                  style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 6, background: formText.trim() ? ACCENT : "#ccc", color: "#fff", cursor: formText.trim() ? "pointer" : "default" }}>
                  {submitting ? "提交中…" : "提交批注"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 归类面板 */}
      {showClassify && (
        <div style={{
          position: "fixed", bottom: 100, left: 24, zIndex: 2000,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.14)", width: 270, padding: "14px 16px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2e1a" }}>归类到笔记板</span>
            <button onClick={() => { setShowClassify(false); setSelectedBoardId(null); setNewBoardTitle(""); setClassifyNoteText(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>已标记 {fmt(classifyTime)}</div>

          <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 10 }}>
            {classifyBoards.length === 0
              ? <div style={{ fontSize: 12, color: "#b0b0b0", padding: "4px 0" }}>暂无笔记板</div>
              : classifyBoards.map(b => (
                <label key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6,
                  cursor: "pointer", background: selectedBoardId === b.id ? "#f0fdf4" : "transparent",
                  fontSize: 13, color: "#374151",
                }}>
                  <input type="radio" name="vboard" checked={selectedBoardId === b.id}
                    onChange={() => { setSelectedBoardId(b.id); setNewBoardTitle(""); }}
                    style={{ accentColor: "#16a34a" }} />
                  {b.title}
                </label>
              ))}
          </div>

          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>新建笔记板</div>
            <input type="text" placeholder="输入名称…" value={newBoardTitle}
              onChange={e => { setNewBoardTitle(e.target.value); setSelectedBoardId(null); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
                border: `1px solid ${newBoardTitle ? "#16a34a" : "#d1d5db"}`, borderRadius: 6, outline: "none" }} />
          </div>

          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>添加笔记（可选）</div>
            <textarea placeholder="部署时将自动生成连线文本框…" value={classifyNoteText}
              onChange={e => setClassifyNoteText(e.target.value)} rows={3}
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
                border: "1px solid #d1d5db", borderRadius: 6, outline: "none", resize: "none", fontFamily: "inherit", lineHeight: 1.5 }} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowClassify(false); setSelectedBoardId(null); setNewBoardTitle(""); setClassifyNoteText(""); }}
              style={{ flex: 1, padding: "6px 0", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 6, background: "transparent", color: "#6b7280", cursor: "pointer" }}>
              取消
            </button>
            <button disabled={classifying || (!selectedBoardId && !newBoardTitle.trim())} onClick={handleClassify}
              style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 500, border: "none", borderRadius: 6,
                background: (selectedBoardId || newBoardTitle.trim()) ? "#16a34a" : "#d1d5db", color: "#fff",
                cursor: (selectedBoardId || newBoardTitle.trim()) ? "pointer" : "default" }}>
              {classifying ? "归类中…" : "归类"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoViewer;
