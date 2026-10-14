"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";

interface Group {
  id: number;
  name: string;
  is_default: number;
  sort_order: number;
  member_count: number;
}

interface FollowState {
  following: boolean;
  group_ids?: number[];
}

interface UserAvatarProps {
  userName: string;
  avatarPath?: string | null;
  size?: number;
  showFollowButton?: boolean;
  onFollowChange?: () => void;
  /** Override default navigation. If false, avatar click is no-op (use with showFollowButton only). */
  onClick?: (() => void) | false;
}

const NAV_COLOR = "#192D10";

const parseJwt = (token: string): { userName?: string } => {
  try {
    const part = token.split(".")[1];
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return {}; }
};

const UserAvatar: React.FC<UserAvatarProps> = ({
  userName, avatarPath, size = 36,
  showFollowButton = true, onFollowChange, onClick,
}) => {
  const [hovered, setHovered] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [follow, setFollow] = useState<FollowState>({ following: false });
  const [groups, setGroups] = useState<Group[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) setMe(parseJwt(token).userName || null);
  }, []);

  const isSelf = me === userName;
  const canFollow = showFollowButton && me && !isSelf;

  // Lazy fetch follow status when needed
  const fetchStatus = useCallback(async () => {
    if (!canFollow) return;
    const token = localStorage.getItem("token");
    try {
      const r = await axios.get(`http://localhost:3001/api/follows/check/${encodeURIComponent(userName)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFollow(r.data);
    } catch (err) { console.error(err); }
  }, [canFollow, userName]);

  const fetchGroups = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      const r = await axios.get("http://localhost:3001/api/follows/groups", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(r.data.groups || []);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { if (canFollow) fetchStatus(); }, [canFollow, fetchStatus]);

  const openPanel = async () => {
    setPanelOpen(true);
    await fetchGroups();
    await fetchStatus();
  };

  // Click outside to close
  useEffect(() => {
    if (!panelOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [panelOpen]);

  const toggleGroup = (gid: number) => {
    const current = follow.group_ids || [];
    const next = current.includes(gid)
      ? current.filter((x) => x !== gid)
      : [...current, gid];
    setFollow({ ...follow, group_ids: next });
  };

  const saveFollow = async () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    try {
      await axios.post("http://localhost:3001/api/follows",
        {
          target_user: userName,
          group_ids: follow.group_ids || [],
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchStatus();
      onFollowChange?.();
      setPanelOpen(false);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const unfollow = async () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    try {
      await axios.delete(`http://localhost:3001/api/follows/${encodeURIComponent(userName)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFollow({ following: false });
      onFollowChange?.();
      setPanelOpen(false);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCreatingGroup(true);
    const token = localStorage.getItem("token");
    try {
      const r = await axios.post("http://localhost:3001/api/follows/groups",
        { name },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroups((gs) => [...gs, { ...r.data }]);
      setFollow((f) => ({ ...f, group_ids: [...(f.group_ids || []), r.data.id] }));
      setNewGroupName("");
    } catch (err) { console.error(err); }
    finally { setCreatingGroup(false); }
  };

  const avatarUrl = avatarPath ? `http://localhost:3001${avatarPath}` : null;
  const initial = userName?.charAt(0).toUpperCase() || "?";

  const handleAvatarClick = () => {
    if (onClick === false) return;
    if (typeof onClick === "function") { onClick(); return; }
    // Works in both app router and pages router pages without needing a router context
    if (typeof window !== "undefined") {
      window.location.href = `/profile?u=${encodeURIComponent(userName)}`;
    }
  };
  const clickable = onClick !== false;

  return (
    <div
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={clickable ? handleAvatarClick : undefined}
        title={clickable ? `查看 ${userName} 的主页` : undefined}
        style={{
          width: size, height: size, borderRadius: "50%",
          background: "linear-gradient(135deg, #e8e6dd, #f5f4ee)",
          overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
          cursor: clickable ? "pointer" : "default",
        }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: Math.round(size * 0.42), color: "#999" }}>{initial}</span>
        )}
      </div>

      {canFollow && (hovered || panelOpen) && (
        <button
          onClick={(e) => { e.stopPropagation(); openPanel(); }}
          title={follow.following ? "管理关注" : "关注"}
          style={{
            position: "absolute",
            right: -2, bottom: -2,
            width: Math.max(14, Math.round(size * 0.38)),
            height: Math.max(14, Math.round(size * 0.38)),
            borderRadius: "50%",
            background: follow.following ? NAV_COLOR : "#fff",
            border: `1.5px solid ${follow.following ? NAV_COLOR : "#888"}`,
            color: follow.following ? "#fff" : "#444",
            cursor: "pointer",
            padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: Math.round(size * 0.28),
            fontWeight: 600, lineHeight: 1,
            boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          }}
        >
          {follow.following ? "✓" : "+"}
        </button>
      )}

      {panelOpen && (
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: size + 8,
            left: -10,
            width: 240,
            background: "#fff",
            borderRadius: 8,
            padding: 12,
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            zIndex: 9500,
            fontSize: 12, color: "#333",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#222" }}>
            {follow.following ? `已关注 ${userName}` : `关注 ${userName}`}
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ color: "#666", marginBottom: 5 }}>加入分组：</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 140, overflowY: "auto" }}>
              {groups.map((g) => {
                const checked = (follow.group_ids || []).includes(g.id);
                return (
                  <label key={g.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 4px", borderRadius: 3,
                    cursor: "pointer",
                    background: checked ? "rgba(25,45,16,0.06)" : "transparent",
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span style={{ flex: 1, fontSize: 12 }}>{g.name}</span>
                    {g.is_default ? <span style={{ fontSize: 9, color: "#bbb" }}>默认</span> : null}
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
              placeholder="新建分组..."
              style={{
                flex: 1, fontSize: 11, padding: "4px 6px",
                border: "1px solid #ddd", borderRadius: 3,
              }}
            />
            <button onClick={createGroup} disabled={creatingGroup || !newGroupName.trim()}
              style={{
                fontSize: 11, padding: "4px 8px",
                background: "#f4f4ec", border: "1px solid #ddd",
                borderRadius: 3, cursor: "pointer",
              }}
            >+</button>
          </div>

          <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
            {follow.following ? (
              <button onClick={unfollow} disabled={loading}
                style={{
                  fontSize: 11, padding: "5px 10px",
                  background: "none", color: "#c44",
                  border: "1px solid #ddd", borderRadius: 4, cursor: "pointer",
                }}>取消关注</button>
            ) : <span />}
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setPanelOpen(false)} disabled={loading}
                style={{
                  fontSize: 11, padding: "5px 10px",
                  background: "none",
                  border: "1px solid #ddd", borderRadius: 4, cursor: "pointer",
                }}>取消</button>
              <button onClick={saveFollow} disabled={loading}
                style={{
                  fontSize: 11, padding: "5px 12px",
                  background: NAV_COLOR, color: "#fff",
                  border: "none", borderRadius: 4, cursor: "pointer",
                }}>{follow.following ? "保存" : "关注"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserAvatar;
