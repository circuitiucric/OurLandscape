import React, { useState, useEffect } from "react";
import pdfViewer from "./path/to/customPdfViewer";

const PdfViewerComponent = ({ fileUrl }) => {
  const [annotations, setAnnotations] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState(null);

  useEffect(() => {
    // Load annotations from local storage or server
    const savedAnnotations = JSON.parse(localStorage.getItem(fileUrl)) || [];
    setAnnotations(savedAnnotations);

    pdfViewer(fileUrl, savedAnnotations);
  }, [fileUrl]);

  const handleKeyDown = (event) => {
    if (event.ctrlKey && event.key === ".") {
      setIsEditing(true);
    } else if (event.key === "Escape") {
      setIsEditing(false);
      setNewAnnotation(null);
    } else if (event.ctrlKey && event.key === "s" && newAnnotation) {
      const updatedAnnotations = [...annotations, newAnnotation];
      setAnnotations(updatedAnnotations);
      localStorage.setItem(fileUrl, JSON.stringify(updatedAnnotations));
      setNewAnnotation(null);
      setIsEditing(false);
      pdfViewer(fileUrl, updatedAnnotations);
    }
  };

  const handleMouseClick = (event) => {
    if (isEditing) {
      const { clientX, clientY } = event;
      const annotationText = prompt("Enter annotation text:");
      if (annotationText) {
        setNewAnnotation({
          page: 1,
          x: clientX,
          y: clientY,
          text: annotationText,
        }); // Assuming single page for simplicity
      }
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleMouseClick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleMouseClick);
    };
  }, [isEditing, newAnnotation]);

  return (
    <div
      id="pdf-viewer"
      style={{ height: "100vh", position: "relative" }}
    ></div>
  );
};

export default PdfViewerComponent;
