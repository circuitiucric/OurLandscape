"use client";
import React, { useEffect, useState } from "react";
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

import { parseHyperlinks } from "@/utils/hyperlinkParser";

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
  const page = parseInt(searchParams?.get("page") || "1", 10);
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDocumentLoaded, setIsDocumentLoaded] = useState<boolean>(false);

  const toolbarPluginInstance = toolbarPlugin();
  const { Toolbar } = toolbarPluginInstance;
  const zoomPluginInstance = zoomPlugin();

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.ctrlKey) {
        const targetElement = event.target as HTMLElement;
        if (targetElement && targetElement.innerText) {
          const text = targetElement.innerText;
          const linkData = parseHyperlinks(text);
          if (linkData) {
            const { fileName, pageNumber } = linkData;
            const targetUrl = `http://localhost:3002/pdf-viewer?file=${fileName}&page=${pageNumber}`;
            window.open(targetUrl, "_blank");
          }
        }
      }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  const handleDocumentLoad = () => {
    setIsDocumentLoaded(true);
    if (page) {
      setCurrentPage(page);
    }
  };

  useEffect(() => {
    fetch(fileUrl)
      .then((response) => {
        if (response.ok) {
          console.log("PDF file fetched successfully:", fileUrl);
        } else {
          console.error("Failed to fetch PDF file:", response.statusText);
        }
      })
      .catch((error) => console.error("Error fetching PDF file:", error));

    axios
      .get(`http://localhost:3001/api/annotations?pdfFile=${file}`)
      .then((response) => {
        const fetchedAnnotations = response.data.map((annotation) => ({
          id: annotation.id,
          pdfFile: annotation.pdf_file,
          pageNumber: annotation.page_number,
          text: annotation.text,
          userName: annotation.userName,
          createdAt: annotation.created_at,
        }));
        setAnnotations(fetchedAnnotations);
      })
      .catch((error) => console.error("Error fetching annotations:", error));
  }, [fileUrl]);

  useEffect(() => {
    if (isDocumentLoaded && page) {
      setCurrentPage(page);
    }
  }, [isDocumentLoaded, page]);

  const handleAnnotationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (currentPage === null || !file) {
      return;
    }

    const text = (event.target as any).elements.textarea?.value;
    if (text) {
      const newAnnotation = { pdfFile: file, pageNumber: currentPage, text };
      axios
        .post("http://localhost:3001/api/annotations", newAnnotation, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
        .then((response) => {
          setAnnotations([...annotations, response.data]);
        })
        .catch((error) => console.error("Error adding annotation:", error));
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
        <div style={{ flex: 1 }}>
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            onDocumentLoad={handleDocumentLoad}
            onPageChange={(e) => setCurrentPage(e.currentPage + 1)}
            initialPage={page - 1}
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
          .filter(
            (annotation) =>
              annotation.pageNumber === currentPage &&
              annotation.pdfFile === file
          )
          .map((annotation) => (
            <div
              key={
                annotation.id ||
                `annotation-${annotation.pageNumber}-${annotation.text}`
              }
              style={{ backgroundColor: "#d3d3d3", marginBottom: "5px" }}
            >
              {annotation.text} - {annotation.userName}
            </div>
          ))}
      </div>
      <form
        onSubmit={handleAnnotationSubmit}
        style={{ position: "absolute", bottom: 10, right: 10, width: "280px" }}
      >
        <textarea
          name="textarea"
          placeholder="Enter annotation text"
          style={{
            width: "100%",
            height: "60px",
            color: "black",
            resize: "none",
          }}
        />
        <button type="submit" style={{ width: "100%", marginTop: "5px" }}>
          Add Annotation
        </button>
      </form>
    </div>
  );
};

export default PdfViewer;
