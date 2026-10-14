"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import UploadModal from "../../../components/UploadModal";

const NavBtn: React.FC<{
  src: string;
  title: string;
  size?: number;
  onClick?: () => void;
}> = ({ src, title, size = 26, onClick }) => (
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

const TopNav: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`);
  };

  const handleProfile = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    router.push(token ? "/profile" : "/login");
  };

  return (
    <>
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: 78, background: "#192D10",
        display: "grid", gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center", padding: "0 20px",
        zIndex: 9000,
      }}>
        {/* 左区：主页 动态 上传 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <NavBtn src="/Topframe_style/主页.png" title="主页" onClick={() => router.push("/")} />
          <NavBtn src="/Topframe_style/动态.png" title="动态" onClick={() => router.push("/movement")} />
          <NavBtn src="/Topframe_style/上传.png" title="上传/推荐资源" onClick={() => setShowUpload(true)} />
        </div>

        {/* 中区：搜索栏（三列 grid 自动居中） */}
        <form onSubmit={handleSearch} style={{
          width: 425,
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 9999, padding: "0 20px", height: 32,
        }}>
          <img src="/Topframe_style/Search.png" alt="搜索"
            style={{ width: 15, height: 15, opacity: 0.50, flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{
              border: "none", background: "transparent", outline: "none",
              color: "rgba(255,255,255,0.75)", fontSize: 13, flex: 1,
              caretColor: "rgba(255,255,255,0.75)", fontFamily: "inherit",
            }}
          />
        </form>

        {/* 右区：五个图标靠右 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end" }}>
          <NavBtn src="/Topframe_style/通知信息.png" title="通知邮件箱" />
          <NavBtn src="/Topframe_style/求助通知.png" title="求助邮件箱" />
          <Sep src="/Topframe_style/Line.png" />
          <NavBtn src="/Topframe_style/个人主页.png" title="个人主页"
            onClick={handleProfile} />
          <Sep src="/Topframe_style/Line-1.png" />
          <NavBtn src="/Topframe_style/足迹历史.png" title="历史记录"
            onClick={() => router.push("/reading-inbox")} />
          <NavBtn src="/Topframe_style/笔记板页面.png" title="笔记板"
            onClick={() => router.push("/noteboard")} />
        </div>
      </nav>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </>
  );
};

export default TopNav;
