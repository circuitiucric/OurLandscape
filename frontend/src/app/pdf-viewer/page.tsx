"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import AnnotationViewer from "../components/AnnotationViewer";

const customStyles = `
  .rpv-core__inner-pages--vertical { overflow: auto !important; }
  .rpv-core__page-layer { margin: 0 !important; }
`;

interface Annotation {
  id: number;
  pdfFile: string;
  pageNumber: number;
  userName: string;
  text: string;
  yPosition: number;
  createdAt: string;
  x1Position?: number;
  y2Position?: number;
  x2Position?: number;
}

interface ViewportState {
  scrollTop: number;
  height: number;
  pageDimensions: { width: number; height: number }[];
  scale: number;
}

const PdfViewer: React.FC = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const initialPage = parseInt(searchParams?.get("page") || "1", 10);
  const fileUrl = `http://localhost:3001/pdf/${file}`;
  const scaleRef = useRef(1);

  // 标记模式
  const [startMark, setStartMark] = useState<{ x: number; y: number } | null>(
    null
  );
  const [endMark, setEndMark] = useState<{ x: number; y: number } | null>(null);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);

  // 文本模式
  const [annotationPanelWidth, setAnnotationPanelWidth] = useState(320);
  const [wheelDelta, setWheelDelta] = useState(0);
  const annotationPanelRef = useRef<HTMLDivElement>(null);

  // 批注数据
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [clickPosition, setClickPosition] = useState<{
    clientY: number;
    pdfY: number;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);

  // PDF viewport 信息
  const containerRef = useRef<HTMLDivElement>(null);
  const innerContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    scrollTop: 0,
    height: 0,
    pageDimensions: [],
    scale: 1,
  });

  // 用于控制什么时候开始渲染 AnnotationViewer
  const [viewportReady, setViewportReady] = useState(false);

  // 批注区左侧偏移
  const [leftOffset, setLeftOffset] = useState(0);

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  // 禁止整个页面滚动
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // 计算 leftOffset
  const computeLeftOffset = useCallback(() => {
    const c = containerRef.current;
    if (c) {
      setLeftOffset(c.getBoundingClientRect().left);
    }
  }, []);

  // 更新 viewport 数据
  const updateViewport = useCallback(() => {
    const c = innerContainerRef.current;
    if (!c) return;
    requestAnimationFrame(() => {
      const scale = scaleRef.current;
      setViewport({
        scrollTop: c.scrollTop / scale,
        height: c.clientHeight,
        scale,
        pageDimensions: Array.from(c.querySelectorAll(".rpv-core__page")).map(
          (p) => ({
            width: p.clientWidth,
            height: p.clientHeight,
          })
        ),
      });
    });
  }, []);

  // 初次挂载：找到内部滚动容器
  useEffect(() => {
    const find = () => {
      const c = document.querySelector(
        ".rpv-core__inner-pages--vertical"
      ) as HTMLDivElement;
      if (c) {
        innerContainerRef.current = c;
        computeLeftOffset();
        updateViewport();
        c.addEventListener("scroll", updateViewport);
      } else {
        setTimeout(find, 100);
      }
    };
    find();
    return () => {
      innerContainerRef.current?.removeEventListener("scroll", updateViewport);
    };
  }, [computeLeftOffset, updateViewport]);

  // 拖拽宽度后更新偏移
  useEffect(() => {
    computeLeftOffset();
  }, [annotationPanelWidth, computeLeftOffset]);

  // 窗口拉伸时更新偏移 & viewport
  useEffect(() => {
    const onResize = () => {
      computeLeftOffset();
      updateViewport();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [computeLeftOffset, updateViewport]);

  // 文档加载完成后，执行一次缩小操作，使annotationviewer读取到正确的scale
  const handleDocumentLoad = useCallback(() => {
    setTimeout(() => {
      // 1. 查找缩小按钮
      const zoomOutBtn = document.querySelector(
        'button[aria-label="Zoom out"]'
      ) as HTMLButtonElement;

      if (zoomOutBtn) {
        // 2. 点击缩小按钮
        zoomOutBtn.click();

        // 3. 等待 scale 更新完成（稍微延迟一点）
        setTimeout(() => {
          updateViewport(); // 确保 scale 是缩小后的
          setViewportReady(true); // 现在才允许渲染批注
        }, 300); // 可以根据实际插件缩放动画时间调整
      } else {
        console.warn("未找到缩小按钮，跳过自动缩放");
        updateViewport();
        setViewportReady(true);
      }
    }, 300); // 稍微等待 PDF 插件布局完成（如侧边栏等）
  }, [updateViewport]);

  // 用户缩放时更新 scale & viewport
  const handleZoom = useCallback(
    (zoom: { scale: number }) => {
      scaleRef.current = zoom.scale;
      updateViewport();
    },
    [updateViewport]
  );

  // 处理选点点击
  const handleDocumentClick = useCallback(
    (ev: MouseEvent) => {
      const c = innerContainerRef.current;
      if (!c || ev.ctrlKey) return;
      const rect = c.getBoundingClientRect();
      const scale = scaleRef.current;
      const x = (ev.clientX - rect.left) / scale;
      const y = (ev.clientY - rect.top) / scale;
      const pdfY = c.scrollTop / scale + y;

      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
        setStartMark(null);
        setEndMark(null);
        setClickPosition(null);
        return;
      }
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (!startMark) {
          setStartMark({ x, y: pdfY });
        } else {
          setEndMark({ x, y: pdfY });
          setClickPosition({ clientY: ev.clientY, pdfY });
        }
      }, 250);
    },
    [startMark]
  );
  useEffect(() => {
    const c = containerRef.current;
    if (c) {
      c.addEventListener("click", handleDocumentClick);
      return () => c.removeEventListener("click", handleDocumentClick);
    }
  }, [handleDocumentClick]);

  // 拉取批注
  useEffect(() => {
    if (!file) return;
    axios
      .get(`http://localhost:3001/api/annotations?pdfFile=${file}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      .then((r) => setAnnotations(r.data))
      .catch(console.error);
  }, [file]);

  // 批注区滚轮
  useEffect(() => {
    const p = annotationPanelRef.current;
    if (!p) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setWheelDelta((r) => r + e.deltaY);
    };
    p.addEventListener("wheel", onWheel, { passive: false });
    return () => p.removeEventListener("wheel", onWheel);
  }, []);

  // 拖拽改变宽度
  const handleDragMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = annotationPanelWidth;
    const onMove = (m: MouseEvent) => {
      const delta = startX - m.clientX;
      setAnnotationPanelWidth(Math.max(200, startW + delta));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 提交批注
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = new FormData(e.currentTarget as HTMLFormElement).get(
      "text"
    ) as string;
    if (!text.trim() || !startMark || !endMark) return;
    try {
      const r = await axios.post(
        "http://localhost:3001/api/annotations",
        {
          pdfFile: file,
          pageNumber: currentPage,
          text,
          yPosition: startMark.y,
          x1Position: startMark.x,
          y2Position: endMark.y,
          x2Position: endMark.x,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      setAnnotations((a) => [...a, r.data]);
      setClickPosition(null);
      setStartMark(null);
      setEndMark(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <style>{customStyles}</style>

      {/* 左侧占位 */}
      <div style={{ flex: 1, backgroundColor: "#f5f5f5" }} />

      {/* PDF 渲染区 */}
      <div
        ref={containerRef}
        style={{
          flex: 3,
          position: "relative",
          overflow: "auto",
          backgroundColor: "#f5f5f5",
        }}
      >
        <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            initialPage={initialPage - 1}
            onPageChange={({ currentPage }) => setCurrentPage(currentPage + 1)}
            onZoom={handleZoom}
            onDocumentLoad={handleDocumentLoad}
          />
        </Worker>
      </div>

      {/* 右侧批注区 */}
      <div
        ref={annotationPanelRef}
        style={{
          width: annotationPanelWidth,
          borderLeft: "1px solid #ddd",
          padding: 20,
          backgroundColor: "#f5f5f5",
          boxShadow: "-2px 0 5px rgba(0,0,0,0.1)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <h3>文档批注</h3>
        {viewportReady && (
          <AnnotationViewer
            annotations={annotations}
            viewport={viewport}
            leftOffset={leftOffset}
            displayMode="text"
            wheelDelta={wheelDelta}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 5,
            cursor: "col-resize",
            zIndex: 1000,
          }}
          onMouseDown={handleDragMouseDown}
        />
      </div>

      {/* PDF 上标记层 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {viewportReady && (
          <AnnotationViewer
            annotations={annotations}
            viewport={viewport}
            startMark={startMark}
            endMark={endMark}
            leftOffset={leftOffset}
            displayMode="mark"
          />
        )}
      </div>

      {/* 提交表单 */}
      {clickPosition && (
        <div
          style={{
            position: "fixed",
            left: `calc(${annotationPanelWidth}px + 30px)`,
            top: clickPosition.clientY,
            zIndex: 9999,
            background: "#fff",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            borderRadius: 8,
            padding: 16,
            width: 400,
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "stretch",
              height: 92,
            }}
          >
            <button type="submit">submit</button>
            <textarea
              name="text"
              placeholder="输入批注内容..."
              autoFocus
              required
              style={{
                flex: 1,
                height: 80,
                padding: 8,
                border: "1px solid #ddd",
                borderRadius: 4,
                resize: "vertical",
              }}
            />
          </form>
        </div>
      )}
    </div>
  );
};

export default PdfViewer;
