import React from "react";
import axios from "axios";

interface Annotation {
  id?: number;
  pdfFile?: string;
  pageNumber?: number;
  text: string;
  userName: string;
  replyId?: number;
  positionY?: number; // 添加 positionY 字段
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  currentPage?: number;
  file?: string;
  replyId?: number | null;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  currentPage,
  file,
  replyId,
}) => {
  // 过滤出当前页和相关批注
  const filteredAnnotations = annotations.filter((annotation) => {
    console.log(
      `Checking annotation.replyId: ${annotation.replyId} against replyId: ${replyId}`
    );

    if (file) {
      console.log("Filtering based on file and pageNumber...");
      console.log(
        `Checking if annotation.pdfFile === ${file} and annotation.pageNumber === ${currentPage}`
      );
      return (
        annotation.pdfFile === file && annotation.pageNumber === currentPage
      );
    }

    if (replyId !== null && replyId !== undefined) {
      console.log(`Checking if ${annotation.replyId} === ${replyId}`);
      return annotation.replyId === replyId;
    }

    return false;
  });

  console.log("Filtered annotations:", filteredAnnotations);
  if (filteredAnnotations.length === 0) {
    console.log("No annotations found for this replyId:", replyId);
  }

  const handleAnnotationDoubleClick = async (annotationId: number) => {
    console.log("Double clicked annotation ID:", annotationId);

    try {
      const existingResponse = await axios.get(
        `http://localhost:3001/api/threads/${annotationId}`
      );
      if (existingResponse.status === 200) {
        const threadId = existingResponse.data.id;
        const targetUrl = `http://localhost:3002/threads/${threadId}`;
        window.open(targetUrl, "_blank");
        return;
      }
    } catch (error) {
      console.log("No existing thread found, creating a new one...");
    }

    try {
      console.log(
        "Preparing to create thread with annotation ID:",
        annotationId
      );
      const response = await axios.post(
        "http://localhost:3001/api/threads/create",
        {
          annotationId: annotationId,
          userName: "Current User", // TODO: 使用真实用户信息
        }
      );
      const threadId = response.data.threadId;
      const targetUrl = `http://localhost:3002/threads/${threadId}`;
      window.open(targetUrl, "_blank");
    } catch (error) {
      console.error("Error creating thread:", error);
    }
  };

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
              position: "absolute", // 设置绝对定位
              top: annotation.positionY ? `${annotation.positionY}%` : "0", // 使用 positionY 来调整高度
              backgroundColor: "#d3d3d3",
              marginBottom: "5px",
              padding: "5px",
              borderRadius: "3px",
              cursor: "pointer",
            }}
            onDoubleClick={() => {
              console.log("Double clicked annotation:", annotation);
              handleAnnotationDoubleClick(annotation.id!); // 双击事件
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
};

export default AnnotationViewer;
