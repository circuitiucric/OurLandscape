import React from "react";
import axios from "axios";

interface Annotation {
  id?: number;
  pdfFile?: string;
  pageNumber?: number;
  text: string;
  userName: string;
  replyId?: number; // 只关注 replyId
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  currentPage?: number;
  file?: string;
  replyId?: number | null; // 修改为 number | null
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  currentPage,
  file,
  replyId,
}) => {
  // 打印传递给 AnnotationViewer 的 replyId 和 annotations
  console.log("Current replyId passed to AnnotationViewer:", replyId);
  console.log("Annotations received by AnnotationViewer:", annotations);

  // 过滤出当前页和相关批注
  const filteredAnnotations = annotations.filter((annotation) => {
    console.log(
      "Comparing annotation.replyId:",
      annotation.replyId,
      "with replyId:",
      replyId
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
      // 直接比较 replyId 和 annotation.replyId
      console.log(`Checking if ${annotation.replyId} === ${replyId}`); // 增加调试信息
      return annotation.replyId === replyId;
    }

    return false;
  });

  // 打印过滤后的批注数据
  console.log("Filtered annotations:", filteredAnnotations);
  console.log("replyId type:", typeof replyId); // 查看传递的 replyId 的类型

  // 如果过滤后没有找到批注，打印相关信息
  if (filteredAnnotations.length === 0) {
    console.log("No annotations found for this replyId:", replyId);
  }

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
        <p>No annotations for this reply.</p>
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
