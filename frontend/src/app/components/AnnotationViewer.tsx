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
  displayMode?: "text" | "mark";
  wheelDelta?: number;
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
    const threshold = 80;
    const indentStep = 360;
    annos.forEach((anno, i) => {
      let indent = 0;
      for (let j = 0; j < i; j++) {
        if (Math.abs(anno.style.top - annos[j].style.top) < threshold) {
          indent = Math.max(indent, (annos[j].indentOffset || 0) + indentStep);
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
            color: "red",
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
            color: "red",
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
              color: "blue",
              pointerEvents: "none",
              zIndex: 1100,
            }}
          >
            「
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
              color: "blue",
              pointerEvents: "none",
              zIndex: 1100,
            }}
          >
            」
          </div>
        );
      }
    });
    return markers;
  }, [annotations, viewport, leftOffset, isReadyToRender]);

  // 渲染文字模式
  if (displayMode === "text") {
    return (
      <div style={containerStyle}>
        {computedAnnotations.map((anno) => {
          const overallLeft = (wheelDelta || 0) + (anno.indentOffset || 0);
          return (
            <div
              key={anno.id}
              id={`anno-${anno.id}`}
              style={{
                ...annotationStyle,
                left: `${overallLeft}px`,
                top: `${anno.style.top}px`,
                maxWidth: "360px",
                minWidth: "240px",
                width: "fit-content",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              onDoubleClick={() => handleAnnotationDoubleClick(anno.id!)}
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
    if (file)
      return (
        annotation.pdfFile === file && annotation.pageNumber === currentPage
      );
    if (replyId != null) return annotation.replyId === replyId;
    return false;
  });

  return (
    <div>
      <h3>Annotations</h3>
      {filteredAnnotations.length === 0 ? (
        <p>No annotations for this reply.</p>
      ) : (
        filteredAnnotations.map((annotation) => (
          <div
            key={annotation.id}
            style={{
              position: "absolute",
              top: annotation.yPosition ? `${annotation.yPosition}%` : "0",
              backgroundColor: "#d3d3d3",
              marginBottom: 5,
              padding: 5,
              borderRadius: 3,
              cursor: "pointer",
            }}
            onDoubleClick={() => handleAnnotationDoubleClick(annotation.id!)}
          >
            <strong>{annotation.userName}</strong>
            {annotation.text.split("\n").map((para, idx) => (
              <p key={idx} style={{ margin: 0 }}>
                {para}
              </p>
            ))}
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
  padding: 16,
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  transition: "transform 0.15s ease-out",
  zIndex: 1000,
  pointerEvents: "auto",
  backdropFilter: "blur(2px)",
  fontSize: 16,
  lineHeight: 1.6,
  fontFamily: "sans-serif",
  width: 360,
};

export default AnnotationViewer;
