"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import TopNav from "../components/TopNav";

const PRIMARY_TAGS = [
  "科学·大类",
  "计算机与软件使用",
  "家务与健康",
  "行政与社会生活",
  "哲学、社会学与心理",
  "文学与美学",
] as const;

const TYPE_LABEL: Record<string, string> = {
  pdf: "PDF", video: "视频", post: "帖子", notebook: "笔记板", external_link: "外链",
};
const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  pdf:           { bg: "#dbeafe", text: "#1d4ed8" },
  video:         { bg: "#fee2e2", text: "#b91c1c" },
  post:          { bg: "#dcfce7", text: "#15803d" },
  notebook:      { bg: "#fef9c3", text: "#854d0e" },
  external_link: { bg: "#f3e8ff", text: "#7e22ce" },
};

// 视频进度以「秒」存于 page_number，格式化为 mm:ss
const fmtVideoTime = (s: number) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

interface HistoryItem {
  id: number;
  type: string;
  identifier: string;
  title: string;
  page_number: number;
  progress_percent: number;
  updated_at: string;
  classified_page: number | null;
  classified_progress: number | null;
  classified_at: string | null;
  is_recommended: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

// ─── Recommend Modal ──────────────────────────────────────────────────────────

const RecommendPanel: React.FC<{
  resourceId: number;
  resourceType: string;
  onDone: () => void;
  onCancel: () => void;
}> = ({ resourceId, resourceType, onDone, onCancel }) => {
  const [tag, setTag] = useState("");
  const [customName, setCustomName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!tag) { setError("请选择一级分类"); return; }
    if (resourceType === "external_link" && !customName.trim()) {
      setError("站外链接需要填写命名"); return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        `http://localhost:3001/api/resources/${resourceId}/recommend`,
        { primaryTag: tag, customName: customName || undefined },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      onDone();
    } catch (err) {
      setError("推荐失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      marginTop: 12,
      backgroundColor: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 8,
      padding: "14px 16px",
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>
        选择一级分类（必选）
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {PRIMARY_TAGS.map(t => (
          <button
            key={t}
            onClick={() => setTag(t)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: `1px solid ${tag === t ? "#4f46e5" : "#d1d5db"}`,
              backgroundColor: tag === t ? "#ede9fe" : "#fff",
              color: tag === t ? "#4f46e5" : "#374151",
              cursor: "pointer", fontSize: 12,
              fontWeight: tag === t ? 600 : 400,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {resourceType === "external_link" && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
            站外链接命名（必填）
          </p>
          <input
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            placeholder="给这个链接起个简洁的名字..."
            style={{
              width: "100%", padding: "7px 10px",
              border: "1px solid #d1d5db", borderRadius: 6,
              fontSize: 13, outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 8 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            padding: "6px 16px",
            backgroundColor: submitting ? "#a5b4fc" : "#4f46e5",
            color: "#fff", border: "none", borderRadius: 6,
            cursor: submitting ? "default" : "pointer",
            fontSize: 13, fontWeight: 500,
          }}
        >
          {submitting ? "推荐中..." : "确认推荐"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 16px",
            backgroundColor: "transparent",
            color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 6,
            cursor: "pointer", fontSize: 13,
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
};

// ─── History Item Card ────────────────────────────────────────────────────────

const HistoryCard: React.FC<{
  item: HistoryItem;
  onIgnore: (id: number) => void;
  onRecommendDone: (id: number) => void;
}> = ({ item, onIgnore, onRecommendDone }) => {
  const [showRecommend, setShowRecommend] = useState(false);

  const resourceUrl =
    item.type === "pdf"
      ? `/pdf-viewer?file=${encodeURIComponent(item.identifier)}&page=${item.page_number}`
      : item.type === "video"
      ? `/video-viewer?file=${encodeURIComponent(item.identifier)}&t=${item.page_number}`
      : item.identifier;

  const classifiedUrl =
    item.classified_page == null
      ? null
      : item.type === "pdf"
      ? `/pdf-viewer?file=${encodeURIComponent(item.identifier)}&page=${item.classified_page}`
      : item.type === "video"
      ? `/video-viewer?file=${encodeURIComponent(item.identifier)}&t=${item.classified_page}`
      : null;

  const typeStyle = TYPE_COLOR[item.type] || { bg: "#f3f4f6", text: "#374151" };

  return (
    <div style={{
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "14px 16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Type badge */}
        <span style={{
          backgroundColor: typeStyle.bg, color: typeStyle.text,
          padding: "3px 8px", borderRadius: 5,
          fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 2,
        }}>
          {TYPE_LABEL[item.type] || item.type}
        </span>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={resourceUrl}
            style={{
              fontWeight: 600, fontSize: 14, color: "#1a1a2e",
              textDecoration: "none", display: "block",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </a>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            最近阅读 {timeAgo(item.updated_at)}
            {item.type === "pdf" && ` · 第 ${item.page_number} 页`}
            {item.type === "video" && ` · ${fmtVideoTime(item.page_number)}`}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {!item.is_recommended && (
            <ActionBtn
              active={showRecommend}
              onClick={() => setShowRecommend(v => !v)}
            >
              推荐
            </ActionBtn>
          )}
          {item.is_recommended && (
            <span style={{
              padding: "5px 10px", borderRadius: 6,
              backgroundColor: "#f0fdf4", color: "#15803d",
              fontSize: 12, fontWeight: 500,
            }}>
              已推荐 ✓
            </span>
          )}
          <ActionBtn onClick={() => onIgnore(item.id)}>忽略</ActionBtn>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 4, backgroundColor: "#f3f4f6", borderRadius: 2 }}>
          <div style={{
            width: `${Math.min(100, item.progress_percent)}%`,
            height: "100%",
            backgroundColor: "#4f46e5",
            borderRadius: 2,
            transition: "width 0.3s",
          }} />
        </div>
        <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>
          {Math.round(item.progress_percent)}%
        </span>
      </div>

      {/* Classified position info */}
      {item.classified_at && item.classified_page != null && (
        <div style={{
          marginTop: 8, fontSize: 12, color: "#6b7280",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          </svg>
          已归类 · 归类时位置：
          {(() => {
            const label = item.type === "video"
              ? `${fmtVideoTime(item.classified_page ?? 0)}（${Math.round(item.classified_progress ?? 0)}%）`
              : `第 ${item.classified_page} 页（${Math.round(item.classified_progress ?? 0)}%）`;
            return classifiedUrl ? (
              <a href={classifiedUrl} style={{ color: "#4f46e5", textDecoration: "none" }}>
                {label} → 跳转
              </a>
            ) : (
              <span>{label}</span>
            );
          })()}
        </div>
      )}

      {/* Recommend panel */}
      {showRecommend && (
        <RecommendPanel
          resourceId={item.id}
          resourceType={item.type}
          onDone={() => { setShowRecommend(false); onRecommendDone(item.id); }}
          onCancel={() => setShowRecommend(false)}
        />
      )}
    </div>
  );
};

const ActionBtn: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}> = ({ children, onClick, active }) => (
  <button
    onClick={onClick}
    style={{
      padding: "5px 12px",
      backgroundColor: active ? "#ede9fe" : "transparent",
      color: active ? "#4f46e5" : "#6b7280",
      border: `1px solid ${active ? "#4f46e5" : "#e5e7eb"}`,
      borderRadius: 6, cursor: "pointer",
      fontSize: 12, fontWeight: 500,
      transition: "all 0.15s",
    }}
    onMouseEnter={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.borderColor = "#4f46e5";
        (e.currentTarget as HTMLElement).style.color = "#4f46e5";
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb";
        (e.currentTarget as HTMLElement).style.color = "#6b7280";
      }
    }}
  >
    {children}
  </button>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReadingInboxPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const authHeader = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await axios.get(
        "http://localhost:3001/api/resources/history",
        { headers: authHeader }
      );
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleIgnore = (resourceId: number) => {
    setItems(prev => prev.filter(i => i.id !== resourceId));
  };

  const handleRecommendDone = (resourceId: number) => {
    setItems(prev =>
      prev.map(i => i.id === resourceId ? { ...i, is_recommended: true } : i)
    );
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb" }}>
      <TopNav />
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "80px 24px 40px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>
            阅览整理
          </h1>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
            你最近阅读过的资源。可以推荐到主页、归类到笔记板，或从列表中移除。
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>
            <div style={{
              width: 32, height: 32,
              border: "3px solid #e5e7eb", borderTop: "3px solid #4f46e5",
              borderRadius: "50%", animation: "spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "#9ca3af" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ marginBottom: 16 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p style={{ fontSize: 15 }}>暂无阅读记录</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              打开一个 PDF 开始阅读，系统会自动记录你的进度
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(item => (
              <HistoryCard
                key={item.id}
                item={item}
                onIgnore={handleIgnore}
                onRecommendDone={handleRecommendDone}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
