// src/app/pdf-viewer/page.tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { toolbarPlugin } from "@react-pdf-viewer/toolbar";
import { zoomPlugin } from "@react-pdf-viewer/zoom";
import "@react-pdf-viewer/toolbar/lib/styles/index.css";
import "@react-pdf-viewer/zoom/lib/styles/index.css";

interface Annotation {
  id?: number;
  pdfFile: string;
  pageNumber: number;
  text: string;
  userName: string;
}

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const annotationInputRef = useRef<HTMLTextAreaElement | null>(null);
  const toolbarPluginInstance = toolbarPlugin();
  const { Toolbar } = toolbarPluginInstance;
  const zoomPluginInstance = zoomPlugin();

  // 修改批注获取逻辑，统一字段名
  useEffect(() => {
    console.log("Fetching PDF file from:", fileUrl);
    fetch(fileUrl)
      .then((response) => {
        if (response.ok) {
          console.log("PDF file fetched successfully:", fileUrl);
        } else {
          console.error(
            "Failed to fetch PDF file:",
            response.status,
            response.statusText
          );
        }
      })
      .catch((error) => {
        console.error("Error fetching PDF file:", error);
      });

    // 获取批注
    axios
      .get(`http://localhost:3001/api/annotations?pdfFile=${file}`)
      .then((response) => {
        const fetchedAnnotations = response.data.map((annotation) => ({
          id: annotation.id,
          pdfFile: annotation.pdf_file, // 保证字段名一致
          pageNumber: annotation.page_number, // 保证字段名一致
          text: annotation.text,
          userName: annotation.userName,
          createdAt: annotation.created_at,
        }));
        console.log("Fetched annotations:", fetchedAnnotations);
        setAnnotations(fetchedAnnotations);
      })
      .catch((error) => {
        console.error("Error fetching annotations:", error);
      });
  }, [fileUrl]);

  const handleAnnotationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (currentPage === null || !file) {
      return;
    }

    const text = annotationInputRef.current?.value;
    if (text) {
      const newAnnotation = { pdfFile: file, pageNumber: currentPage, text };

      axios
        .post("http://localhost:3001/api/annotations", newAnnotation, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
        .then((response) => {
          console.log("Added annotation:", response.data);
          setAnnotations([...annotations, response.data]);
          if (annotationInputRef.current) {
            annotationInputRef.current.value = "";
          }
        })
        .catch((error) => {
          console.error("Error adding annotation:", error);
        });
    }
  };

  const handleDocumentLoad = () => {
    console.log("Document loaded");
  };

  const handlePageChange = (pageNumber: number) => {
    setCurrentPage(pageNumber);
    console.log("Current page:", pageNumber);
  };

  useEffect(() => {
    console.log("Current page changed to:", currentPage);
    console.log("Annotations before filtering:", annotations);
    const pageAnnotations = annotations.filter(
      (annotation) => annotation.pageNumber === currentPage
    );
    console.log("Annotations for current page:", pageAnnotations);
  }, [currentPage, annotations]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Worker
        workerUrl={`https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`}
      >
        <div style={{ flex: 1 }}>
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            onDocumentLoad={handleDocumentLoad}
            onPageChange={(e) => handlePageChange(e.currentPage + 1)}
          />
        </div>
      </Worker>
      <div
        style={{
          width: "300px",
          overflowY: "auto",
          backgroundColor: "#f0f0f0",
          padding: "10px",
        }}
      >
        <h3>Annotations for page {currentPage}</h3>
        {annotations
          .filter((annotation) => annotation.pageNumber === currentPage)
          .map((annotation) => (
            <div
              key={annotation.id}
              style={{ backgroundColor: "#d3d3d3", marginBottom: "5px" }} // 灰色背景
            >
              {annotation.text} - {annotation.userName}
            </div>
          ))}
      </div>
      <form
        onSubmit={handleAnnotationSubmit}
        style={{
          position: "absolute", // 使用 absolute 定位
          bottom: 10, // 固定在容器的底部
          right: 10,
          width: "280px", // 设置宽度为右侧列的宽度
        }}
      >
        <textarea
          ref={annotationInputRef}
          placeholder="Enter annotation text"
          style={{
            width: "100%", // 宽度占满容器
            height: "60px", // 初始高度
            color: "black",
            resize: "none", // 禁止手动调整大小
          }}
        />
        <button
          type="submit"
          style={{
            width: "100%", // 按钮宽度与输入框一致
            marginTop: "5px", // 与输入框保持一定距离
          }}
        >
          Add Annotation
        </button>
      </form>
    </div>
  );
};

export default PdfViewer;
