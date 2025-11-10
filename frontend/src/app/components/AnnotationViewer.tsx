import React, { useMemo, useState, useEffect } from "react";
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
  pageDimensions: Array<{ width: number; height: number }>;
  scale: number;
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  viewport?: ViewportState;
  currentPage?: number;
  file?: string;
  replyId?: number | null;
  startMark?: { x: number; y: number } | null;
  endMark?: { x: number; y: number } | null;
  leftOffset?: number;
  displayMode?: "text" | "mark" | "thread";
  wheelDelta?: number;
  hoveredAnnotationId?: number | null;
  onAnnotationHover?: (id: number | null) => void;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  viewport,
  currentPage,
  file,
  replyId,
  startMark,
  endMark,
  leftOffset,
  displayMode = "text",
  wheelDelta = 0,
  hoveredAnnotationId,
  onAnnotationHover,
}) => {
  const [isReadyToRender, setIsReadyToRender] = useState(false);

  // 等待 viewport.scale 初始化
  useEffect(() => {
    if (viewport && viewport.scale > 0) {
      setIsReadyToRender(true);
    }
  }, [viewport]);

  //新窗口打开帖子
  const handleAnnotationDoubleClick = async (annotationId: number) => {
    const popupWidth = 600;
    const popupHeight = 600;
    const left = window.innerWidth - popupWidth - 20;
    const top = (window.innerHeight - popupHeight) / 2;

    const windowFeatures = `width=${popupWidth},height=${popupHeight},left=${left},top=${top},noopener,noreferrer`;

    try {
      const existingResponse = await axios.get(
        `http://localhost:3001/api/threads/${annotationId}`
      );
      if (existingResponse.status === 200) {
        const threadId = existingResponse.data.id;
        window.open(
          `http://localhost:3002/threads/${threadId}`,
          "_blank",
          windowFeatures
        );
        return;
      }
    } catch {
      // no existing thread
    }
    try {
      const response = await axios.post(
        "http://localhost:3001/api/threads/create",
        { annotationId, userName: "Current User" }
      );
      window.open(
        `http://localhost:3002/threads/${response.data.threadId}`,
        "_blank",
        windowFeatures
      );
    } catch (err) {
      console.error(err);
    }
  };

  // 预计算位置
  const positionedAnnotations = useMemo(() => {
    if (!viewport || !isReadyToRender) return [];
    return annotations.map((anno) => {
      const pageNumber = anno.pageNumber || 1;
      const yPosition = anno.yPosition || 0;
      const { pageDimensions, scrollTop, scale } = viewport;

      const pageOffset = pageDimensions
        .slice(0, pageNumber - 1)
        .reduce((acc, curr) => acc + curr.height, 0);
      const pageHeight = pageDimensions[pageNumber - 1]?.height || 842;
      const normalizedY = (yPosition / 842) * pageHeight;
      const top = (pageOffset + normalizedY - scrollTop) * scale;
      const baseLeft = (pageDimensions[0]?.width || 612) * scale + 24;

      return {
        ...anno,
        style: { baseLeft, top, width: 360, opacity: 1 },
      };
    });
  }, [annotations, viewport, isReadyToRender]);

  // 计算重叠偏移
  const computedAnnotations = useMemo(() => {
    if (!positionedAnnotations.length) return [];
    const annos = [...positionedAnnotations];
    annos.sort((a, b) => a.style.top - b.style.top);

    // 计算每个批注的预期宽度（基于文本长度）
    annos.forEach((anno) => {
      // 计算文本的预期宽度（假设每个中文字符约18px，英文字符约9px）
      const textWidth = anno.text.split("").reduce((width, char) => {
        return width + (/[\u4e00-\u9fa5]/.test(char) ? 18 : 9);
      }, 0);

      // 考虑padding和其他内容的空间，并确保宽度在合理范围内
      const contentWidth = Math.min(Math.max(textWidth + 64, 120), 360);
      anno.expectedWidth = contentWidth;
    });

    const threshold = 100; // 垂直方向的检测阈值

    // 计算避让偏移
    annos.forEach((anno, i) => {
      let indent = 0;
      // 记录当前位置已经被占用的区域
      const occupiedRegions: Array<{ left: number; width: number }> = [];

      // 检查之前的注释
      for (let j = 0; j < i; j++) {
        if (Math.abs(anno.style.top - annos[j].style.top) < threshold) {
          occupiedRegions.push({
            left: annos[j].indentOffset || 0,
            width: annos[j].expectedWidth || 360,
          });
        }
      }

      // 如果有重叠区域，寻找第一个可用的空间
      if (occupiedRegions.length > 0) {
        // 按照左边界排序
        occupiedRegions.sort((a, b) => a.left - b.left);

        // 从左到右查找可用空间
        let testPosition = 0;
        let found = false;

        while (!found) {
          found = true;
          for (const region of occupiedRegions) {
            // 检查当前位置是否与已占用区域重叠
            if (
              testPosition < region.left + region.width &&
              testPosition + (anno.expectedWidth || 360) > region.left
            ) {
              // 发现重叠，移动到下一个可能的位置
              testPosition = region.left + region.width + 20; // 添加间距
              found = false;
              break;
            }
          }
          if (found) {
            indent = testPosition;
          }
        }
      }

      anno.indentOffset = indent;
    });

    return annos;
  }, [positionedAnnotations]);

  // 标记元素
  const markerElements = useMemo<JSX.Element[]>(() => {
    if (!viewport || !isReadyToRender) return [];
    const markers: JSX.Element[] = [];
    const { scrollTop, scale } = viewport;
    if (startMark) {
      const top = (startMark.y - scrollTop + 10) * scale;
      const left = startMark.x * scale + (leftOffset || 0) + 20;
      markers.push(
        <div
          key="start-marker"
          style={{
            position: "absolute",
            top: `${top}px`,
            left: `${left}px`,
            fontSize: 42,
            color: "#4169E1",
            pointerEvents: "none",
            zIndex: 1100,
          }}
        >
          「
        </div>
      );
    }
    if (endMark) {
      const top = (endMark.y - scrollTop + 10) * viewport.scale - 34;
      const left = endMark.x * scale + (leftOffset || 0) + 32;
      markers.push(
        <div
          key="end-marker"
          style={{
            position: "absolute",
            top: `${top}px`,
            left: `${left}px`,
            fontSize: 42,
            color: "#4169E1",
            pointerEvents: "none",
            zIndex: 1100,
          }}
        >
          」
        </div>
      );
    }
    return markers;
  }, [startMark, endMark, viewport, leftOffset, isReadyToRender]);

  const historicalMarkers = useMemo<JSX.Element[]>(() => {
    if (!viewport || !isReadyToRender) return [];
    const markers: JSX.Element[] = [];
    const { scrollTop, scale } = viewport;
    annotations.forEach((anno) => {
      const isHovered = hoveredAnnotationId === anno.id;
      const faded =
        hoveredAnnotationId !== null && hoveredAnnotationId !== anno.id;
      if (
        typeof anno.yPosition === "number" &&
        typeof anno.x1Position === "number"
      ) {
        const top = (anno.yPosition - scrollTop + 10) * scale;
        const left = anno.x1Position * scale + (leftOffset || 0) + 20;
        markers.push(
          <div
            key={`anno-start-${anno.id}`}
            style={{
              position: "absolute",
              top: `${top}px`,
              left: `${left}px`,
              fontSize: 42,
              color: isHovered ? "#FF5722" : "#FFD700",
              pointerEvents: "auto",
              zIndex: isHovered ? 2000 : 1100,
              filter: isHovered ? "drop-shadow(0 0 12px #FF5722)" : "none",
              transition: "filter 0.2s, color 0.2s, z-index 0.2s, opacity 0.2s",
              cursor: "pointer",
              opacity: faded ? 0.25 : 1,
            }}
            onMouseEnter={() => onAnnotationHover?.(anno.id!)}
            onMouseLeave={() => onAnnotationHover?.(null)}
          >
            {"「"}
          </div>
        );
      }
      if (
        typeof anno.y2Position === "number" &&
        typeof anno.x2Position === "number"
      ) {
        const top = (anno.y2Position - scrollTop + 10) * scale - 34;
        const left = anno.x2Position * scale + (leftOffset || 0) + 32;
        markers.push(
          <div
            key={`anno-end-${anno.id}`}
            style={{
              position: "absolute",
              top: `${top}px`,
              left: `${left}px`,
              fontSize: 42,
              color: isHovered ? "#FF5722" : "#FFD700",
              pointerEvents: "auto",
              zIndex: isHovered ? 2000 : 1100,
              filter: isHovered ? "drop-shadow(0 0 12px #FF5722)" : "none",
              transition: "filter 0.2s, color 0.2s, z-index 0.2s, opacity 0.2s",
              cursor: "pointer",
              opacity: faded ? 0.25 : 1,
            }}
            onMouseEnter={() => onAnnotationHover?.(anno.id!)}
            onMouseLeave={() => onAnnotationHover?.(null)}
          >
            {"」"}
          </div>
        );
      }
    });
    return markers;
  }, [
    annotations,
    viewport,
    leftOffset,
    isReadyToRender,
    hoveredAnnotationId,
    onAnnotationHover,
  ]);

  // 渲染文字模式
  if (displayMode === "text") {
    return (
      <div style={containerStyle}>
        {computedAnnotations.map((anno) => {
          const overallLeft = (wheelDelta || 0) + (anno.indentOffset || 0);
          const isHovered = hoveredAnnotationId === anno.id;
          const faded =
            hoveredAnnotationId !== null && hoveredAnnotationId !== anno.id;
          return (
            <div
              key={anno.id}
              id={`anno-${anno.id}`}
              style={{
                ...annotationStyle,
                left: `${overallLeft}px`,
                top: `${anno.style.top}px`,
                width: anno.expectedWidth
                  ? `${anno.expectedWidth}px`
                  : "fit-content",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowY: "auto",
                boxShadow: isHovered
                  ? "0 0 24px 6px #FF5722"
                  : annotationStyle.boxShadow,
                borderLeft: isHovered
                  ? "6px solid #FF5722"
                  : annotationStyle.borderLeft,
                zIndex: isHovered ? 2000 : 1000,
                transition:
                  "box-shadow 0.2s, border-left 0.2s, z-index 0.2s, opacity 0.2s",
                opacity: faded ? 0.25 : 1,
              }}
              onDoubleClick={() => handleAnnotationDoubleClick(anno.id!)}
              onMouseEnter={() => onAnnotationHover?.(anno.id!)}
              onMouseLeave={() => onAnnotationHover?.(null)}
            >
              <div className="annotation-content">
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "bold",
                    marginBottom: 8,
                  }}
                >
                  {anno.text.split("\n").map((para, idx) => (
                    <p key={idx} style={{ margin: 0 }}>
                      {para}
                    </p>
                  ))}
                </div>
                {anno.createdAt && (
                  <div style={{ fontSize: "12px", color: "#555" }}>
                    <time>{new Date(anno.createdAt).toLocaleString()}</time>{" "}
                    {anno.userName}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 渲染标记模式
  if (displayMode === "mark") {
    return (
      <div style={containerStyle}>
        {[...markerElements, ...historicalMarkers]}
      </div>
    );
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
            onDoubleClick={() => handleAnnotationDoubleClick(annotation.id!)}
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

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  pointerEvents: "none",
  willChange: "transform",
};

const annotationStyle: React.CSSProperties = {
  position: "absolute",
  backgroundColor: "rgba(245, 245, 245, 0.95)",
  color: "#000",
  borderLeft: "4px solid #FFC107",
  padding: "16px",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  transition: "transform 0.15s ease-out",
  zIndex: 1000,
  pointerEvents: "auto",
  backdropFilter: "blur(2px)",
  fontSize: 16,
  lineHeight: 1.6,
  fontFamily: "sans-serif",
  maxWidth: 360,
  maxHeight: 300,
  overflowY: "auto",
  width: "fit-content",
};

export default AnnotationViewer;
