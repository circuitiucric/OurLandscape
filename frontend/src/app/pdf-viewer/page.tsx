"use client";
import React, { useEffect, useRef, useState } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { useSearchParams } from "next/navigation";
import axios from "axios";

interface Annotation {
  id?: number;
  pdfFile: string;
  pageNumber: number;
  text: string;
}

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const annotationInputRef = useRef<HTMLInputElement | null>(null);

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
      .get("http://localhost:3001/api/annotations")
      .then((response) => {
        setAnnotations(response.data);
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
        .post("http://localhost:3001/api/annotations", newAnnotation)
        .then((response) => {
          setAnnotations([...annotations, response.data]);
          console.log("Annotation added:", response.data);
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
              style={{ backgroundColor: "yellow", marginBottom: "5px" }}
            >
              {annotation.text}
            </div>
          ))}
      </div>
      <form
        onSubmit={handleAnnotationSubmit}
        style={{ position: "fixed", top: 10, right: 10 }}
      >
        <input
          type="text"
          ref={annotationInputRef}
          placeholder="Enter annotation text"
          style={{ color: "black" }}
        />
        <button type="submit">Add Annotation</button>
      </form>
    </div>
  );
};

export default PdfViewer;
