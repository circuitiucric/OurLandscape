import React from "react";

interface Annotation {
  id?: number;
  pdfFile: string;
  pageNumber: number;
  text: string;
  userName: string;
}

interface AnnotationViewerProps {
  annotations: Annotation[];
  currentPage: number;
  file: string;
  onAnnotationDoubleClick: (annotationId: number) => void;
}

const AnnotationViewer: React.FC<AnnotationViewerProps> = ({
  annotations,
  currentPage,
  file,
  onAnnotationDoubleClick,
}) => {
  // 过滤出当前页面和当前PDF文件的批注
  const filteredAnnotations = annotations.filter(
    (annotation) =>
      annotation.pageNumber === currentPage && annotation.pdfFile === file
  );

  return (
    <div>
      <h3>Annotations for page {currentPage}</h3>
      {/* 如果没有批注显示提示 */}
      {filteredAnnotations.length === 0 ? (
        <p>No annotations for this page.</p>
      ) : (
        filteredAnnotations.map((annotation) => (
          <div
            key={
              annotation.id ||
              `annotation-${annotation.pageNumber}-${annotation.text}`
            }
            style={{
              backgroundColor: "#d3d3d3",
              marginBottom: "5px",
              padding: "5px",
              borderRadius: "3px",
              cursor: "pointer",
            }}
            onDoubleClick={() => onAnnotationDoubleClick(annotation.id!)} // 双击事件
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
