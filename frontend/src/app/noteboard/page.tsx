"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import TopNav from "../components/TopNav";

export default function NoteboardIndex() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("我的笔记板");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    axios.get("http://localhost:3001/api/noteboards", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (r.data.length > 0) {
        router.replace(`/noteboard/${r.data[0].id}`);
      } else {
        setLoading(false);
      }
    }).catch(err => {
      if (err?.response?.status === 401) {
        localStorage.removeItem("token");
        router.push("/login");
      } else {
        setLoading(false);
      }
    });
  }, []); // eslint-disable-line

  const handleCreate = async () => {
    const token = localStorage.getItem("token");
    if (!token || !newTitle.trim()) return;
    setCreating(true);
    try {
      const r = await axios.post(
        "http://localhost:3001/api/noteboards",
        { title: newTitle.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      router.push(`/noteboard/${r.data.id}`);
    } catch (err) {
      console.error(err);
      setCreating(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
      加载中…
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh",
      background: "#f5f5f0", fontFamily: "sans-serif" }}>
      <TopNav />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          background: "#fff", borderRadius: 12,
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          padding: "36px 40px", width: 320, textAlign: "center",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1a2e1a"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1a2e1a", marginBottom: 6 }}>
            还没有笔记板
          </h2>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 24 }}>
            创建第一个笔记板，开始整理你的知识
          </p>
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "8px 12px", fontSize: 14,
              border: "1px solid #d1d5db", borderRadius: 8,
              outline: "none", marginBottom: 12,
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newTitle.trim()}
            style={{
              width: "100%", padding: "9px 0", fontSize: 14, fontWeight: 500,
              background: newTitle.trim() ? "#1a2e1a" : "#d1d5db",
              color: "#fff", border: "none", borderRadius: 8,
              cursor: newTitle.trim() ? "pointer" : "default",
            }}
          >
            {creating ? "创建中…" : "创建笔记板"}
          </button>
        </div>
      </div>
    </div>
  );
}
