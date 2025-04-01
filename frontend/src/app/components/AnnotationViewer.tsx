import React, { useMemo } from "react";
import axios from "axios";

export interface Annotation {
  id?: number;
  pdfFile?: string;
  pageNumber?: number;
  text: string;
  userName: string;
  // 新版 pdf-viewer 模式使用的字段
  yPosition?: number;
  createdAt?: string;
  // 帖子模式使用的字段
  replyId?: number;
}

export interface ViewportState {
  scrollTop: number;
  height: number;
  pageDimensions: Array<{ width: number; height: number }>;
  scale: number;
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  // pdf-viewer 模式相关属性
  viewport?: ViewportState;
  // 帖子（回复）模式相关属性
  currentPage?: number;
  file?: string;
  replyId?: number | null;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  viewport,
  currentPage,
  file,
  replyId,
}) => {
  // 双击批注统一处理逻辑
  const handleAnnotationDoubleClick = async (annotationId: number) => {
    console.log("Double clicked annotation ID:", annotationId);
    try {
      const existingResponse = await axios.get(
        `http://localhost:3001/api/threads/${annotationId}`
      );
      if (existingResponse.status === 200) {
        const threadId = existingResponse.data.id;
        window.open(`http://localhost:3002/threads/${threadId}`, "_blank");
        return;
      }
    } catch (error) {
      console.log("No existing thread found, creating a new one...");
    }
    try {
      const response = await axios.post(
        "http://localhost:3001/api/threads/create",
        {
          annotationId: annotationId,
          userName: "Current User", // TODO: 替换为真实用户信息
        }
      );
      const threadId = response.data.threadId;
      window.open(`http://localhost:3002/threads/${threadId}`, "_blank");
    } catch (error) {
      console.error("Error creating thread:", error);
    }
  };

  // 如果传入了 viewport，则认为当前为 pdf-viewer 模式
  if (viewport) {
    // 使用新版定位逻辑计算批注的样式位置
    const positionedAnnotations = useMemo(() => {
      return annotations.map((anno) => {
        // 若 pageNumber 或 yPosition 未传入，则采用默认值
        const pageNumber = anno.pageNumber || 1;
        const yPosition = anno.yPosition || 0;
        const { pageDimensions, scrollTop, scale } = viewport;

        console.log("scrollTop:", scrollTop); // 打印 scrollTop 确认是否正确更新

        // 计算当前页之前的累计高度（不受缩放影响）
        const pageOffset = pageDimensions
          .slice(0, pageNumber - 1)
          .reduce((acc, curr) => acc + curr.height, 0);

        // 获取当前页实际高度（默认值842）
        const pageHeight = pageDimensions[pageNumber - 1]?.height || 842;
        // 计算批注在当前页面内的实际位置
        const normalizedY = (yPosition / 842) * pageHeight;
        // 计算批注相对于整个文档的绝对位置并应用缩放
        const top = (pageOffset + normalizedY - scrollTop) * scale;
        // 固定批注区距离页面左侧的位置（例如：页面宽度+偏移24px）
        const left = (pageDimensions[0]?.width || 612) * scale + 24;

        return {
          ...anno,
          style: {
            left: `${left}px`,
            top: `${top}px`,
            width: "280px",
            opacity: 1,
          },
        };
      });
    }, [annotations, viewport]);

    const visibleAnnotations = useMemo(() => {
      const { scrollTop, height } = viewport;
      return positionedAnnotations.filter((anno) => {
        const top = parseFloat(anno.style.top);
        return top >= scrollTop - height && top <= scrollTop + height * 2;
      });
    }, [positionedAnnotations, viewport]);

    return (
      <div style={containerStyle}>
        {positionedAnnotations.map((anno) => (
          <div
            key={anno.id || `annotation-${anno.text}`}
            id={`anno-${anno.id}`}
            style={{
              ...annotationStyle,
              left: "calc(100% - 300px)",
              top: anno.style.top,
              width: anno.style.width,
            }}
            onDoubleClick={() => {
              if (anno.id !== undefined) {
                handleAnnotationDoubleClick(anno.id);
              } else {
                console.error("Annotation ID is undefined:", anno);
              }
            }}
          >
            <div className="annotation-content">
              <strong>{anno.userName}</strong>
              <p>{anno.text}</p>
              {anno.createdAt && (
                <time>{new Date(anno.createdAt).toLocaleString()}</time>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    // 帖子模式：根据传入的 file/currentPage 或 replyId 筛选对应的批注
    const filteredAnnotations = annotations.filter((annotation) => {
      if (file) {
        return (
          annotation.pdfFile === file && annotation.pageNumber === currentPage
        );
      }
      if (replyId !== null && replyId !== undefined) {
        return annotation.replyId === replyId;
      }
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
              key={annotation.id || `annotation-${annotation.text}`}
              style={{
                position: "absolute", // 绝对定位，可根据需要调整
                top: annotation.yPosition ? `${annotation.yPosition}%` : "0",
                backgroundColor: "#d3d3d3",
                marginBottom: "5px",
                padding: "5px",
                borderRadius: "3px",
                cursor: "pointer",
              }}
              onDoubleClick={() => {
                if (annotation.id) {
                  handleAnnotationDoubleClick(annotation.id);
                }
              }}
            >
              <p style={{ margin: 0 }}>
                <strong>{annotation.userName}</strong>: {annotation.text}
              </p>
            </div>
          ))
        )}
      </div>
    );
  }
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
  backgroundColor: "rgba(245, 245, 245, 0.95)", // 淡灰色背景带透明度
  color: "#000000", // 字体颜色设置为黑色
  borderLeft: "4px solid #FFC107",
  padding: "12px",
  borderRadius: "6px",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
  transition: "transform 0.15s ease-out",
  zIndex: 1000,
  pointerEvents: "auto",
  backdropFilter: "blur(2px)",
  fontSize: "20px", // 调大字体尺寸（原浏览器默认16px）
};

export default AnnotationViewer;
