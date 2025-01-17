import React from "react";
import axios from "axios";

interface Annotation {
  id?: number;
  pdfFile: string;
  pageNumber: number;
  text: string;
  userName: string;
  replyId?: number; // 只关注 replyId
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  currentPage: number;
  file?: string;
  replyId?: string; // 只需要 replyId 来过滤批注
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  currentPage,
  file,
  replyId,
}) => {
  // 过滤出当前页和相关批注
  const filteredAnnotations = annotations.filter((annotation) => {
    if (file) {
      return (
        annotation.pdfFile === file && annotation.pageNumber === currentPage
      );
    }
    if (replyId) {
      return annotation.replyId === parseInt(replyId, 10); // 只根据 replyId 来过滤
    }
    return false;
  });

  const handleAnnotationDoubleClick = async (annotationId: number) => {
    console.log("Double clicked annotation ID:", annotationId);

    try {
      // 查询现有帖子
      const existingResponse = await axios.get(
        `http://localhost:3001/api/threads/${annotationId}`
      );
      if (existingResponse.status === 200) {
        // 如果已有帖子，跳转到该帖子页面
        const threadId = existingResponse.data.id;
        const targetUrl = `http://localhost:3002/threads/${threadId}`;
        window.open(targetUrl, "_blank");
        return;
      }
    } catch (error) {
      // 如果找不到现有帖子，则继续创建新帖子
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
          annotationId: annotationId, // 确保键名与后端一致
          userName: "Current User", // TODO: 使用真实用户信息
        }
      );
      const threadId = response.data.threadId;

      // 跳转到新页面并传递 threadId
      const targetUrl = `http://localhost:3002/threads/${threadId}`;
      window.open(targetUrl, "_blank");
    } catch (error) {
      console.error("Error creating thread:", error);
    }
  };

  return (
    <div>
      <h3>Annotations</h3>
      {/* 如果没有批注显示提示 */}
      {filteredAnnotations.length === 0 ? (
        <p>No annotations for this page.</p>
      ) : (
        filteredAnnotations.map((annotation) => (
          <div
            key={annotation.id || `annotation-${annotation.text}`}
            style={{
              backgroundColor: "#d3d3d3",
              marginBottom: "5px",
              padding: "5px",
              borderRadius: "3px",
              cursor: "pointer",
            }}
            onDoubleClick={() => handleAnnotationDoubleClick(annotation.id!)} // 双击事件
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
