import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";

export interface Annotation {
  id?: number;
  pdfFile?: string;
  pageNumber?: number;
  text: string;
  userName: string;
  yPosition?: number;
  createdAt?: string;
  replyId?: number;
  x1Position?: number;
  y2Position?: number;
  x2Position?: number;
  indentOffset?: number;
  expectedWidth?: number;
  selectedText?: string;
  textStartOffset?: number;
  textEndOffset?: number;
}

export interface ViewportState {
  scrollTop: number;
  height: number;
  pageDimensions: Array<{ 
    width: number; 
    height: number;
    pdfWidth?: number;
    pdfHeight?: number;
    top?: number;
  }>;
  scale: number;
  pdfScale: number;
  containerRect?: DOMRect;
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  viewport?: ViewportState;
  currentPage?: number;
  visiblePages?: number[];
  file?: string;
  replyId?: number | null;
  startMark?: { 
    x: number; 
    y: number; 
    pageNumber: number;
    canvasX?: number;
    canvasY?: number;
  } | null;
  endMark?: { 
    x: number; 
    y: number; 
    pageNumber: number;
    canvasX?: number;
    canvasY?: number;
  } | null;
  leftOffset?: number;
  displayMode?: "text" | "mark" | "thread";
  wheelDelta?: number;
  hoveredAnnotationId?: number | null;
  onAnnotationHover?: (id: number | null) => void;
  onWheelDeltaChange?: (delta: number) => void;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  viewport,
  currentPage = 1,
  visiblePages = [currentPage],
  file,
  replyId,
  startMark,
  endMark,
  leftOffset = 0,
  displayMode = "text",
  wheelDelta = 0,
  hoveredAnnotationId,
  onAnnotationHover,
  onWheelDeltaChange,
}) => {
  const [isReadyToRender, setIsReadyToRender] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [scrollRange, setScrollRange] = useState({ min: 0, max: 0 });

  // ── 部署信息悬停弹窗 ────────────────────────────────────────────────────────
  const [deployHover, setDeployHover] = useState<{
    x: number; y: number;
    data: Array<{ board_title: string; user_name: string }> | null;
  } | null>(null);
  const deployCache = useRef<Map<number, Array<{ board_title: string; user_name: string }>>>(new Map());

  const showDeployHover = async (e: React.MouseEvent, annoId: number) => {
    const cached = deployCache.current.get(annoId);
    setDeployHover({ x: e.clientX, y: e.clientY, data: cached ?? null });
    if (cached !== undefined) return;
    try {
      const r = await axios.get("http://localhost:3001/api/noteboards/deployments", {
        params: { item_type: "annotation", resource_id: annoId },
      });
      deployCache.current.set(annoId, r.data);
      setDeployHover(prev => prev ? { ...prev, data: r.data } : null);
    } catch {}
  };

  // ── 归类面板状态 ────────────────────────────────────────────────────────────
  const [classifyTarget, setClassifyTarget] = useState<Annotation | null>(null);
  const [classifyPos, setClassifyPos] = useState({ x: 0, y: 0 });
  const [classifyBoards, setClassifyBoards] = useState<{ id: number; title: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [classifying, setClassifying] = useState(false);

  useEffect(() => {
    if (!classifyTarget) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.get("http://localhost:3001/api/noteboards", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => setClassifyBoards(r.data)).catch(console.error);
  }, [classifyTarget]);

  const handleClassifyIconClick = (e: React.MouseEvent, anno: Annotation) => {
    e.stopPropagation();
    setClassifyTarget(anno);
    setSelectedBoardId(null);
    setNewBoardTitle("");
    // 面板出现在点击位置左侧
    const x = Math.min(e.clientX + 12, window.innerWidth - 280);
    const y = Math.min(e.clientY - 10, window.innerHeight - 320);
    setClassifyPos({ x, y });
  };

  const handleClassify = async () => {
    if (!classifyTarget) return;
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
          item_type: "annotation",
          resource_id: classifyTarget.id ?? null,
          text_content: classifyTarget.text,
          title: classifyTarget.text.slice(0, 40),
          reading_progress: { pdfFile: classifyTarget.pdfFile, pageNumber: classifyTarget.pageNumber },
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

  // 等待 viewport 初始化
  useEffect(() => {
    if (viewport && viewport.scale > 0 && viewport.pageDimensions.length > 0) {
      setIsReadyToRender(true);
    }
  }, [viewport]);

  // 新窗口打开帖子（POST /create 已处理"有则返回、无则新建"）
  const handleAnnotationDoubleClick = async (annotationId: number) => {
    try {
      const response = await axios.post(
        "http://localhost:3001/api/threads/create",
        { annotationId, userName: "Current User" }
      );
      // 以普通新标签页打开，保留浏览器的历史、收藏、前进/后退等功能（不要用带尺寸的弹窗）
      // sw=150 → 让帖子页的批注栏以最小宽度的 1/3 初始展开
      window.open(
        `http://localhost:3002/threads/${response.data.threadId}?sw=150`,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (err) {
      console.error(err);
    }
  };

  // 筛选可见页面范围内的批注 - 修复：确保始终有值
  const visibleAnnotations = useMemo(() => {
    const pagesToShow = visiblePages && visiblePages.length > 0 ? visiblePages : [currentPage];
    return annotations.filter(anno =>
      anno.pageNumber && pagesToShow.includes(anno.pageNumber)
    );
  }, [annotations, visiblePages, currentPage]);

  // 预计算位置
  const positionedAnnotations = useMemo(() => {
    if (!viewport || !isReadyToRender || viewport.pageDimensions.length === 0) {
      return [];
    }

    const { pageDimensions, scrollTop } = viewport;

    if (visibleAnnotations.length === 0) {
      return [];
    }
    
    return visibleAnnotations.map((anno) => {
      const { yPosition, id, pageNumber } = anno;
      
      if (yPosition === undefined || pageNumber === undefined) {
        return { 
          ...anno, 
          style: { 
            left: 0, 
            top: 0, 
            width: 360, 
            opacity: 1,
            pdfY: 0
          } 
        };
      }
      
      const pageIndex = pageNumber - 1;
      const pageDimension = pageDimensions[pageIndex];
      
      if (!pageDimension) {
        return {
          ...anno, 
          style: { 
            left: 0, 
            top: 0, 
            width: 360, 
            opacity: 1,
            pdfY: 0
          } 
        };
      }
      
      const { height: pageHeight, pdfHeight = 842, top: pageTop = 0 } = pageDimension;
      
      // 计算PDF坐标到渲染坐标的转换
      const pdfToRenderRatio = pageHeight / pdfHeight;
      
      // 从PDF坐标系（左下角原点）转换为网页坐标系（左上角原点）
      const renderYFromTop = pageHeight - (yPosition * pdfToRenderRatio);
      
      // 计算绝对位置
      const absoluteTop = pageTop + renderYFromTop;
      
      // 计算相对于视口的位置。
      // 注意：pageHeight / pageTop / scrollTop 已经是「缩放后」的渲染像素
      //（page.tsx 中页尺寸取自 getViewport({ scale: currentScale })，top 为其累加值，
      // scrollTop 为 DOM 容器滚动量）。因此 viewportRelativeTop 本身就是标识符在
      // 可视区内的真实屏幕偏移，与右栏 top 同一坐标系——不能再乘一次 scale，
      // 否则会按 viewportRelativeTop*(scale-1) 的量随下移逐渐偏低、与标识符错位。
      const finalTop = absoluteTop - scrollTop;
      
      return {
        ...anno,
        style: { 
          left: 0,  // 初始left，后续计算
          top: finalTop, 
          width: 360, 
          opacity: 1,
          pdfY: yPosition,
          pageNumber
        },
      };
    });
  }, [visibleAnnotations, viewport, isReadyToRender]);

  // 计算重叠偏移和初始位置
  const computedAnnotations = useMemo(() => {
    if (!positionedAnnotations.length) {
      return [];
    }
    
    const annos = [...positionedAnnotations];
    
    // 按垂直位置排序
    annos.sort((a, b) => a.style.top - b.style.top);
    
    // 计算每个批注的预期宽度
    annos.forEach((anno) => {
      const textWidth = anno.text.split("").reduce((width, char) => {
        return width + (/[\u4e00-\u9fa5]/.test(char) ? 18 : 9);
      }, 0);

      const contentWidth = Math.min(Math.max(textWidth + 64, 120), 360);
      anno.expectedWidth = contentWidth;
    });

    const threshold = 20; // 垂直方向的检测阈值
    const occupiedRegions: Array<{ left: number; width: number; bottom: number; pageNumber: number }> = [];
    
    // 第一轮：计算每个批注的水平偏移
    annos.forEach((anno, i) => {
      let indent = 0;
      const annoTop = anno.style.top;
      const annoHeight = 100; // 估计的批注高度
      const annoBottom = annoTop + annoHeight;
      const annoPage = anno.style.pageNumber || 1;
      
      // 检查与之前批注的重叠
      for (let j = 0; j < i; j++) {
        const prevAnno = annos[j];
        const prevTop = prevAnno.style.top;
        const prevHeight = 100;
        const prevBottom = prevTop + prevHeight;
        const prevPage = prevAnno.style.pageNumber || 1;
        
        // 垂直方向重叠检测（只检测同一页面的批注）
        if (annoPage === prevPage && !(annoBottom <= prevTop || annoTop >= prevBottom)) {
          const prevLeft = prevAnno.indentOffset || 0;
          const prevWidth = prevAnno.expectedWidth || 360;
          
          occupiedRegions.push({
            left: prevLeft,
            width: prevWidth,
            bottom: Math.max(annoBottom, prevBottom),
            pageNumber: prevPage
          });
        }
      }

      // 寻找可用位置
      if (occupiedRegions.length > 0) {
        // 只考虑同一页面的区域
        const samePageRegions = occupiedRegions.filter(region => region.pageNumber === annoPage);
        
        if (samePageRegions.length > 0) {
          samePageRegions.sort((a, b) => a.left - b.left);
          
          let testPosition = 0;
          let found = false;
          const maxAttempts = 5;
          let attempts = 0;

          while (!found && attempts < maxAttempts) {
            found = true;
            for (const region of samePageRegions) {
              if (
                testPosition < region.left + region.width &&
                testPosition + (anno.expectedWidth || 360) > region.left
              ) {
                testPosition = region.left + region.width + 20;
                found = false;
                attempts++;
                break;
              }
            }
          }
          indent = testPosition;
        }
      }

      anno.indentOffset = indent;
    });
    
    return annos;
  }, [positionedAnnotations]);

  // 从 computedAnnotations 推导滚动范围（不能在 useMemo 内调用 setState）
  useEffect(() => {
    if (computedAnnotations.length === 0) {
      setScrollRange({ min: 0, max: 0 });
      return;
    }
    const minLeft = Math.min(...computedAnnotations.map(a => a.indentOffset || 0));
    const maxLeft = Math.max(...computedAnnotations.map(a =>
      (a.indentOffset || 0) + (a.expectedWidth || 360)
    ));
    setScrollRange({ min: minLeft, max: maxLeft });
  }, [computedAnnotations]);

  // 初始加载：确保第一个批注可见
  useEffect(() => {
    if (computedAnnotations.length > 0 && !initialLoadDone) {
      const leftmostAnno = computedAnnotations.reduce((prev, curr) =>
        (prev.indentOffset || 0) < (curr.indentOffset || 0) ? prev : curr
      );
      if (leftmostAnno.indentOffset !== undefined && onWheelDeltaChange) {
        onWheelDeltaChange(-leftmostAnno.indentOffset);
      }
      setInitialLoadDone(true);
    }
  }, [computedAnnotations, initialLoadDone, onWheelDeltaChange]);

  // 修复悬停高亮Bug
  const getFadedState = (annotationId?: number) => {
    if (hoveredAnnotationId === null || hoveredAnnotationId === undefined) {
      return false; // 没有悬停任何批注，都不半透明
    }
    return hoveredAnnotationId !== annotationId; // 只有悬停的批注不高亮，其他半透明
  };

  // 始终持有最新的滚动状态，供回调 ref 中的闭包读取
  const wheelStateRef = useRef({ wheelDelta: wheelDelta || 0, scrollRange, onWheelDeltaChange });
  useEffect(() => {
    wheelStateRef.current = { wheelDelta: wheelDelta || 0, scrollRange, onWheelDeltaChange };
  });

  // 回调 ref：节点挂载时立即注册监听，卸载时清理，无需猜测时序
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (containerRef.current) {
      (containerRef.current as any)._wheelCleanup?.();
    }
    containerRef.current = node;
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const { wheelDelta: cur, scrollRange: range, onWheelDeltaChange: onChange } = wheelStateRef.current;
      const containerWidth = node.clientWidth || 400;
      const newDelta = cur - e.deltaY;
      const maxScroll = Math.max(0, range.max - containerWidth);
      const constrained = Math.max(-maxScroll, Math.min(0, newDelta));
      onChange?.(constrained);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    (node as any)._wheelCleanup = () => node.removeEventListener('wheel', onWheel);
  }, []);

  // 渲染文字模式
  if (displayMode === "text") {
    if (!isReadyToRender || !viewport || viewport.pageDimensions.length === 0) {
      return <div style={{ padding: '20px', color: '#666' }}>加载中...</div>;
    }
    
    if (computedAnnotations.length === 0) {
      return <div style={{ color: '#666', fontStyle: 'italic', padding: '20px' }}>当前页面暂无批注</div>;
    }

    return (
      <>
      <div
        ref={setContainerRef}
        style={{
          position: 'relative',
          height: '100%',
          overflow: 'hidden',
          cursor: 'default',
          backgroundColor: 'transparent'
        }}
      >
        {/* 批注容器 */}
        <div style={{ 
          position: 'relative',
          height: '100%',
          width: '100%',
          minHeight: '500px'
        }}>
          {computedAnnotations.map((anno) => {
            const overallLeft = (anno.indentOffset || 0) + (wheelDelta || 0);
            const isHovered = hoveredAnnotationId === anno.id;
            const faded = getFadedState(anno.id);
            const pageNumber = anno.style.pageNumber || 1;
            
            return (
              <div
                key={anno.id}
                style={{
                  ...annotationStyle,
                  left: `${overallLeft}px`,
                  top: `${anno.style.top - 50}px`,
                  width: anno.expectedWidth
                    ? `${anno.expectedWidth}px`
                    : "fit-content",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowY: "auto",
                  boxShadow: isHovered
                    ? "2px 6px 12px rgba(0,0,0,0.32)"
                    : annotationStyle.boxShadow,
                  borderLeft: annotationStyle.borderLeft,
                  zIndex: isHovered ? 2000 : 1000 + pageNumber,
                  transition:
                    "box-shadow 0.2s, border-left 0.2s, z-index 0.2s, opacity 0.2s, left 0.1s",
                  opacity: faded ? 0.25 : 1,
                  position: "absolute",
                  pointerEvents: 'auto',
                  // 隐藏太远不可见的批注
                  visibility: anno.style.top < -100 || anno.style.top > 2000 ? 'hidden' : 'visible'
                }}
                onDoubleClick={() => anno.id && handleAnnotationDoubleClick(anno.id)}
                onMouseEnter={() => anno.id && onAnnotationHover?.(anno.id)}
                onMouseLeave={() => onAnnotationHover?.(null)}
              >
                {/* 用户名 + 进度标识符（居中） + 日期 */}
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#173708" }}>{anno.userName}</span>
                  <img
                    src="/Annotations_style/进度标记符.png"
                    alt="收录" title="收录到笔记板"
                    style={{ width: 13, height: 13, opacity: 0.35, cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0 }}
                    onClick={e => handleClassifyIconClick(e, anno)}
                    onMouseEnter={e => { (e.currentTarget.style.opacity = "0.85"); if (anno.id) showDeployHover(e, anno.id); }}
                    onMouseLeave={e => { (e.currentTarget.style.opacity = "0.35"); setDeployHover(null); }}
                  />
                  <span style={{ flex: 1, fontSize: 9, color: "#bbb", textAlign: "right" }}>
                    {anno.createdAt ? new Date(anno.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
                {/* 正文 */}
                <div style={{ fontSize: 12, lineHeight: 1.65, color: "#333" }}>
                  {anno.text.split("\n").map((para, idx) => (
                    <p key={idx} style={{ margin: 0 }}>{para}</p>
                  ))}
                </div>
                {/* 底部：快捷指标 + 更多 */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[
                      { label: "有用", src: "/Annotations_style/有用的-批注指标.png" },
                      { label: "有启发", src: "/Annotations_style/有启发的-批注指标.png" },
                    ].map(({ label, src }) => (
                      <button
                        key={label}
                        title={label}
                        style={{ display: "flex", alignItems: "center", gap: 3, padding: "1px 3px", border: "1px solid transparent", borderRadius: 3, background: "none", cursor: "pointer" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <img src={src} alt={label} style={{ width: 12, height: 12, opacity: 0.65 }} />
                        <span style={{ fontSize: 9, color: "#bbb", minWidth: 12 }}>0</span>
                      </button>
                    ))}
                  </div>
                  <button
                    title="更多"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", opacity: 0.4, lineHeight: 1 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img src="/Annotations_style/更多.png" alt="更多" style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* 部署信息悬停弹窗 */}
      {deployHover?.data && deployHover.data.length > 0 && (
        <div style={{
          position: "fixed",
          left: Math.min(deployHover.x + 14, window.innerWidth - 220),
          top: Math.max(deployHover.y - 10, 8),
          zIndex: 9999,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
          padding: "8px 12px", minWidth: 180, pointerEvents: "none", fontFamily: "sans-serif",
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

      {/* 归类面板 */}
      {classifyTarget && (
        <div
          style={{
            position: "fixed", left: classifyPos.x, top: classifyPos.y,
            zIndex: 9999, background: "#fff",
            border: "1px solid #e5e7eb", borderRadius: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
            width: 248, padding: "14px 16px",
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
            批注：{classifyTarget.text.slice(0, 30)}{classifyTarget.text.length > 30 ? "…" : ""}
          </div>

          <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 10 }}>
            {classifyBoards.length === 0
              ? <div style={{ fontSize: 12, color: "#b0b0b0", padding: "4px 0" }}>暂无笔记板</div>
              : classifyBoards.map(b => (
                <label key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 6px", borderRadius: 6, cursor: "pointer",
                  background: selectedBoardId === b.id ? "#f0fdf4" : "transparent",
                  fontSize: 13, color: "#374151",
                }}>
                  <input type="radio" name="anno-board" checked={selectedBoardId === b.id}
                    onChange={() => { setSelectedBoardId(b.id); setNewBoardTitle(""); }}
                    style={{ accentColor: "#16a34a" }} />
                  {b.title}
                </label>
              ))
            }
          </div>

          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>新建笔记板</div>
            <input type="text" placeholder="输入名称…" value={newBoardTitle}
              onChange={e => { setNewBoardTitle(e.target.value); setSelectedBoardId(null); }}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 8px", fontSize: 12,
                border: `1px solid ${newBoardTitle ? "#16a34a" : "#d1d5db"}`,
                borderRadius: 6, outline: "none",
              }} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setClassifyTarget(null)} style={{
              flex: 1, padding: "6px 0", fontSize: 12,
              border: "1px solid #d1d5db", borderRadius: 6,
              background: "transparent", color: "#6b7280", cursor: "pointer",
            }}>取消</button>
            <button
              disabled={classifying || (!selectedBoardId && !newBoardTitle.trim())}
              onClick={handleClassify}
              style={{
                flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 500,
                border: "none", borderRadius: 6,
                background: (selectedBoardId || newBoardTitle.trim()) ? "#16a34a" : "#d1d5db",
                color: "#fff",
                cursor: (selectedBoardId || newBoardTitle.trim()) ? "pointer" : "default",
              }}>
              {classifying ? "归类中…" : "归类"}
            </button>
          </div>
        </div>
      )}
      </>
    );
  }

  // 渲染标记模式
  if (displayMode === "mark") {
    return null;
  }

  // 帖子模式
  const filteredAnnotations = annotations.filter((annotation) => {
    if (replyId != null) return annotation.replyId === replyId;
    if (file)
      return (
        annotation.pdfFile === file && annotation.pageNumber === currentPage
      );
    return false;
  });

  return (
    <div style={{ padding: "10px" }}>
      {filteredAnnotations.length === 0 ? (
        <p>No annotations for this reply.</p>
      ) : (
        filteredAnnotations.map((annotation) => (
          <div
            key={annotation.id}
            style={{
              backgroundColor: "#f5f5f5",
              marginBottom: "10px",
              padding: "12px",
              borderRadius: "6px",
              borderLeft: "4px solid #4CAF50",
              position: "relative",
            }}
            onDoubleClick={() => annotation.id && handleAnnotationDoubleClick(annotation.id)}
          >
            {annotation.selectedText && (
              <div
                style={{
                  backgroundColor: "#e3f2fd",
                  padding: "8px",
                  marginBottom: "8px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  color: "#333",
                  fontStyle: "italic",
                }}
              >
                {annotation.selectedText}
              </div>
            )}
            <div style={{ marginBottom: "8px" }}>
              {annotation.text.split("\n").map((para, idx) => (
                <p key={idx} style={{ margin: "4px 0" }}>
                  {para}
                </p>
              ))}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#666",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{annotation.userName}</span>
              {annotation.createdAt && (
                <time>{new Date(annotation.createdAt).toLocaleString()}</time>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const annotationStyle: React.CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.96)",
  color: "#1a1a1a",
  borderLeft: "none",
  padding: "10px 12px 8px 12px",
  borderRadius: 5,
  boxShadow: "2px 4px 4px rgba(0,0,0,0.25)",
  transition: "box-shadow 0.18s, left 0.1s, opacity 0.15s",
  zIndex: 1000,
  pointerEvents: "auto",
  fontSize: 13,
  lineHeight: 1.65,
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  maxWidth: 360,
  maxHeight: 300,
  overflowY: "auto",
  width: "fit-content",
};

export default AnnotationViewer;