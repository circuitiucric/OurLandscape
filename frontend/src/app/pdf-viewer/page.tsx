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
}

interface ViewportState {
  scrollTop: number;
  height: number;
  pageDimensions: PageDimension[];
  scale: number;
}

interface PageDimension {
  width: number;
  height: number;
}

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const initialPage = parseInt(searchParams?.get("page") || "1", 10);
  const fileUrl = `http://localhost:3001/pdf/${file}`;
  const scaleRef = useRef(1);

  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [clickPosition, setClickPosition] = useState<{
    clientY: number;
    pdfY: number;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerContainerRef = useRef<HTMLDivElement | null>(null);

  const [viewport, setViewport] = useState<ViewportState>({
    scrollTop: 0,
    height: 0,
    pageDimensions: [],
    scale: 1,
  });

  const getAuthHeader = () => {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("请先登录");
      window.location.href = "/login";
      return {};
    }
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  useEffect(() => {
    const findScrollContainer = () => {
      const container = document.querySelector(
        ".rpv-core__inner-pages--vertical"
      ) as HTMLDivElement;
      if (container) {
        innerContainerRef.current = container;
        updateViewport();
        container.addEventListener("scroll", handleScroll);
      } else {
        setTimeout(findScrollContainer, 100);
      }
    };
    findScrollContainer();

    return () => {
      innerContainerRef.current?.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // 修改视口状态更新逻辑
  const updateViewport = useCallback(() => {
    const container = innerContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      const scale = scaleRef.current;
      setViewport((prev) => ({
        ...prev,
        // 存储未缩放的滚动位置
        scrollTop: container.scrollTop / scale,
        height: container.clientHeight,
        scale: scale,
        pageDimensions: Array.from(
          container.querySelectorAll(".rpv-core__page")
        ).map((page) => ({
          width: page.clientWidth,
          height: page.clientHeight,
        })),
      }));
    });
  }, []);

  const handleScroll = useCallback(() => {
    updateViewport();
  }, [updateViewport]);

  // 关键修改：删除所有滚动位置补偿逻辑
  const handleZoom = useCallback(
    (zoom: { scale: number }) => {
      scaleRef.current = zoom.scale;
      updateViewport();
    },
    [updateViewport]
  );

  // 修改点击位置计算逻辑
  const handleDocumentClick = useCallback((event: MouseEvent) => {
    const container = innerContainerRef.current;
    if (!container || event.ctrlKey) return;

    const rect = container.getBoundingClientRect();
    const scale = scaleRef.current;

    // 计算点击位置相对于视口的Y坐标
    const clickYRelative = event.clientY - rect.top;

    // 如果点击位置距离顶部小于75px，则不显示批注框
    if (clickYRelative < 75) {
      return;
    }

    // 点击位置转换到未缩放坐标系
    const clickY = (event.clientY - rect.top) / scale;

    // 滚动位置转换到未缩放坐标系
    const scrollTopRaw = container.scrollTop / scale;

    // 最终保存的批注位置（统一基于原始文档坐标系）
    const pdfY = scrollTopRaw + clickY;

    setClickPosition({
      clientY: event.clientY,
      pdfY: pdfY, // 这个值将作为yPosition传给后端
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const text = formData.get("text") as string;

    if (!text.trim() || !clickPosition) return;

    try {
      const response = await axios.post(
        "http://localhost:3001/api/annotations",
        {
          pdfFile: file,
          pageNumber: currentPage,
          text: text,
          yPosition: clickPosition.pdfY,
        },
        getAuthHeader()
      );

      setAnnotations([...annotations, response.data]);
      setClickPosition(null);
    } catch (error) {
      console.error("批注提交失败:", error);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("click", handleDocumentClick);
    return () => container.removeEventListener("click", handleDocumentClick);
  }, [handleDocumentClick]);

  useEffect(() => {
    if (!file) return;
    axios
      .get(
        `http://localhost:3001/api/annotations?pdfFile=${file}`,
        getAuthHeader()
      )
      .then((response) => {
        setAnnotations(
          response.data.map((a: any) => ({
            id: a.id,
            pdfFile: a.pdfFile,
            pageNumber: a.pageNumber,
            text: a.text,
            yPosition: a.yPosition,
            createdAt: a.createdAt,
            userName: a.userName,
          }))
        );
      })
      .catch(console.error);
  }, [file]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <style>{customStyles}</style>
      <div style={{ flex: 1, backgroundColor: "#f5f5f5" }} />

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
          />
        </Worker>
      </div>

      <div
        style={{
          flex: 1,
          borderLeft: "1px solid #ddd",
          padding: "20px",
          overflowY: "auto",
          backgroundColor: "#f5f5f5",
          boxShadow: "-2px 0 5px rgba(0,0,0,0.1)",
          position: "relative",
          minWidth: "320px",
        }}
      >
        <h3>文档批注（第 {currentPage} 页）</h3>
        <AnnotationViewer annotations={annotations} viewport={viewport} />
      </div>

      {clickPosition && (
        <div
          style={{
            position: "fixed",
            left: "calc(75% + 30px)",
            top: clickPosition.clientY,
            zIndex: 9999,
            background: "white",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            borderRadius: "8px",
            padding: "16px",
            width: "400px",
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "stretch", // 关键属性：拉伸子元素高度
              height: "92px", // 输入框80px + 边框2px*2
            }}
          >
            {/* 发送按钮 */}
            <button
              type="submit"
              style={{
                background: "#808080",
                color: "white",
                border: "none",
                padding: "0 20px",
                borderRadius: "4px",
                cursor: "pointer",
                flexShrink: 0,
                transition: "background 0.3s",
                // 设置与输入框相同的计算高度
                height: "calc(100% - 7px)", // 补偿容器边框
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#666")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#808080")}
            >
              submit
            </button>

            {/* 输入框 */}
            <textarea
              name="text"
              placeholder="输入批注内容..."
              autoFocus
              required
              style={{
                flex: 1,
                height: "80px", // 固定初始高度
                padding: "8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                color: "#000",
                resize: "vertical",
                boxSizing: "border-box", // 确保边框不增加总高度
              }}
            />
          </form>
        </div>
      )}
    </div>
  );
};

export default PdfViewer;
