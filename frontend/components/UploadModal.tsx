"use client";

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const PRIMARY_TAGS = [
  "科学·大类",
  "计算机与软件使用",
  "家务与健康",
  "行政与社会生活",
  "哲学、社会学与心理",
  "文学与美学",
] as const;

interface UploadModalProps {
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#555",
  marginBottom: 8,
};

const isVideoFile = (f: File) =>
  f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogg)$/i.test(f.name);

async function extractPdfCover(pdfFile: File): Promise<Blob | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88)
    );
  } catch {
    return null;
  }
}

// Grab a representative frame from a video file as the cover
async function extractVideoCover(videoFile: File): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement("video");
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.preload = "metadata";
      video.src = url;

      const cleanup = () => URL.revokeObjectURL(url);
      let seeked = false;

      video.onloadedmetadata = () => {
        // Seek a little in so we skip black intro frames
        const target = Math.min(1, (video.duration || 2) * 0.1);
        video.currentTime = isFinite(target) ? target : 0;
      };
      video.onseeked = () => {
        if (seeked) return;
        seeked = true;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => { cleanup(); resolve(b); }, "image/jpeg", 0.85);
        } catch {
          cleanup();
          resolve(null);
        }
      };
      video.onerror = () => { cleanup(); resolve(null); };
    } catch {
      resolve(null);
    }
  });
}

type Tab = "link" | "pdf" | "video";

const UploadModal: React.FC<UploadModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<Tab>("link");
  const [file, setFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [manualCover, setManualCover] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [comment, setComment] = useState("");
  const [primaryTag, setPrimaryTag] = useState("");
  const [extraTags, setExtraTags] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [msg, setMsg] = useState("");
  const coverBlobRef = useRef<Blob | null>(null);

  const tabIsVideo = tab === "video";

  // Auto-extract a cover from the chosen file, unless the user has set one manually.
  useEffect(() => {
    if (!file) { setCoverPreview(null); coverBlobRef.current = null; return; }
    if (manualCover) return;
    let cancelled = false;
    (async () => {
      const blob = isVideoFile(file)
        ? await extractVideoCover(file)
        : await extractPdfCover(file);
      if (cancelled) return;
      coverBlobRef.current = blob;
      if (blob) setCoverPreview(URL.createObjectURL(blob));
    })();
    return () => { cancelled = true; };
  }, [file, manualCover]);

  // User picks their own cover image, overriding the auto-extracted frame.
  const handleManualCover = (img: File | null) => {
    if (!img) return;
    coverBlobRef.current = img;
    setCoverPreview(URL.createObjectURL(img));
    setManualCover(true);
  };

  // Reset file + cover state when switching away from a file tab or between pdf/video.
  const switchTab = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    setFile(null);
    setCoverPreview(null);
    setManualCover(false);
    coverBlobRef.current = null;
    setMsg("");
  };

  const handleSubmit = async () => {
    if (!comment.trim()) { setMsg("请填写评论"); return; }
    if (!primaryTag) { setMsg("请选择一级标签"); return; }
    if (tab === "pdf" && !file) { setMsg("请选择 PDF 文件"); return; }
    if (tab === "video" && !file) { setMsg("请选择视频文件"); return; }
    if (tab === "link" && !linkUrl.trim()) { setMsg("请填写链接地址"); return; }
    if (tab === "link" && !linkName.trim()) { setMsg("请为链接命名"); return; }

    setStatus("loading");
    setMsg("");

    try {
      const token = localStorage.getItem("token");
      const authHeader = { Authorization: `Bearer ${token}` };
      let resource: { id: number };

      if (tab !== "link" && file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", file.name);
        if (coverBlobRef.current) {
          formData.append("cover", coverBlobRef.current, "cover.jpg");
        }
        const r = await axios.post("http://localhost:3001/api/resources/upload", formData, {
          headers: authHeader,
        });
        resource = r.data;
      } else {
        const r = await axios.post(
          "http://localhost:3001/api/resources/register",
          { type: "external_link", identifier: linkUrl.trim(), title: linkName.trim() },
          { headers: authHeader }
        );
        resource = r.data;
      }

      await axios.post(
        `http://localhost:3001/api/resources/${resource.id}/recommend`,
        {
          primaryTag,
          customName: tab === "link" ? linkName.trim() : undefined,
          evaluation: comment.trim(),
        },
        { headers: authHeader }
      );

      const tags = extraTags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        await axios.post(
          `http://localhost:3001/api/resources/${resource.id}/tags`,
          { tags },
          { headers: authHeader }
        );
      }

      setStatus("success");
      setMsg("✓ 已推荐到主页");
      setTimeout(onClose, 1400);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setStatus("error");
      setMsg(e.response?.data?.error ?? "提交失败，请重试");
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14,
          width: 520, maxHeight: "88vh",
          padding: "28px 32px",
          overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111" }}>推荐到主页</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#bbb", lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1.5px solid #f0f0f0", marginBottom: 20 }}>
          {([["link", "添加链接"], ["pdf", "上传 PDF"], ["video", "上传视频"]] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              style={{
                padding: "8px 18px", background: "none", border: "none",
                borderBottom: tab === t ? "2px solid #192D10" : "2px solid transparent",
                marginBottom: -1.5,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? "#192D10" : "#888",
                cursor: "pointer", fontSize: 13,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Link fields */}
        {tab === "link" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="链接地址（必填）" style={inputStyle} />
            <input value={linkName} onChange={(e) => setLinkName(e.target.value)}
              placeholder="链接命名（必填，将展示在主页）" style={inputStyle} />
          </div>
        )}

        {/* File picker (PDF / video) */}
        {tab !== "link" && (
          <div style={{ marginBottom: 18 }}>
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              padding: "22px 16px",
              border: `2px dashed ${file ? "#192D10" : "#d1d5db"}`,
              borderRadius: 10, cursor: "pointer", background: "#fafafa",
            }}>
              <input
                type="file"
                accept={tabIsVideo ? ".mp4,.webm,.mov,.m4v,video/*" : ".pdf,application/pdf"}
                style={{ display: "none" }}
                onChange={(e) => { setManualCover(false); setFile(e.target.files?.[0] ?? null); }}
              />
              {coverPreview ? (
                <img src={coverPreview} alt="封面预览"
                  style={tabIsVideo
                    ? { width: 160, height: 90, objectFit: "cover", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }
                    : { width: 90, height: 120, objectFit: "cover", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }} />
              ) : tabIsVideo ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#192D10" strokeWidth="1.5">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={file ? "#192D10" : "#9ca3af"} strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
              <span style={{ fontSize: 13, color: file ? "#192D10" : "#9ca3af", fontWeight: file ? 600 : 400 }}>
                {file ? file.name : tabIsVideo ? "点击选择视频文件" : "点击选择 PDF 文件"}
              </span>
            </label>

            {/* Manual cover override */}
            {file && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "#888" }}>
                  {manualCover ? "已使用自定义封面" : "封面自动生成"}
                </span>
                <label style={{ fontSize: 12, color: "#192D10", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => handleManualCover(e.target.files?.[0] ?? null)} />
                  更换封面
                </label>
                {manualCover && (
                  <button
                    type="button"
                    onClick={() => { setManualCover(false); }}
                    style={{ fontSize: 12, color: "#888", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    恢复自动
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Comment */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>评论（必填）</label>
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="为什么推荐这个资源？"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        {/* Primary tag */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>一级标签（必填）</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PRIMARY_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => setPrimaryTag(tag)}
                style={{
                  padding: "5px 13px", borderRadius: 20, fontSize: 12,
                  border: "1.5px solid",
                  borderColor: primaryTag === tag ? "#192D10" : "#e5e7eb",
                  background: primaryTag === tag ? "#192D10" : "transparent",
                  color: primaryTag === tag ? "#fff" : "#555",
                  cursor: "pointer", fontWeight: primaryTag === tag ? 600 : 400,
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Extra tags */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>附加标签（选填，逗号分隔）</label>
          <input value={extraTags} onChange={(e) => setExtraTags(e.target.value)}
            placeholder="例：入门, 推荐, 实用" style={inputStyle} />
        </div>

        {/* Message */}
        {msg && (
          <div style={{
            marginBottom: 12, fontSize: 13, textAlign: "center",
            color: status === "error" ? "#dc2626" : status === "success" ? "#16a34a" : "#555",
          }}>
            {msg}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={status === "loading" || status === "success"}
          style={{
            width: "100%", padding: "12px 0",
            background: status === "success" ? "#16a34a" : status === "loading" ? "#6b7280" : "#192D10",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 700,
            cursor: status === "loading" ? "wait" : "pointer",
          }}
        >
          {status === "loading" ? "提交中…" : status === "success" ? "✓ 已推荐" : "推荐"}
        </button>
      </div>
    </div>
  );
};

export default UploadModal;
