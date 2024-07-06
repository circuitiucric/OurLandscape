// src/app/pdf-viewer/page.tsx
"use client";

import React, { useEffect, useState } from "react";
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
  userName: string;
}

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [newAnnotation, setNewAnnotation] = useState<Partial<Annotation>>({
    pdfFile: file || "",
    pageNumber: 1,
    text: "",
  });
  const [currentPage, setCurrentPage] = useState(0);
  const [inputText, setInputText] = useState("");

  useEffect(() => {
    console.log("Fetching annotations...");
    axios
      .get("http://localhost:3001/api/annotations")
      .then((response) => {
        console.log("Annotations fetched:", response.data);
        setAnnotations(response.data);
      })
      .catch((error) => {
        console.error("Error fetching annotations:", error);
      });
  }, []);

  const handleAnnotationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = localStorage.getItem("token");

    console.log("Submitting annotation:", {
      ...newAnnotation,
      text: inputText,
      pageNumber: currentPage,
    });

    axios
      .post(
        "http://localhost:3001/api/annotations",
        { ...newAnnotation, text: inputText, pageNumber: currentPage },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      .then((response) => {
        console.log("Annotation added:", response.data);
        setAnnotations([...annotations, response.data]);
        setNewAnnotation({
          pdfFile: file || "",
          pageNumber: currentPage,
          text: "",
        });
        setInputText("");
      })
      .catch((error) => {
        console.error("Error adding annotation:", error);
      });
  };

  useEffect(() => {
    console.log("Current page changed:", currentPage);
  }, [currentPage]);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1 }}>
        <Worker
          workerUrl={`https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`}
        >
          <Viewer
            fileUrl={fileUrl}
            plugins={[defaultLayoutPluginInstance]}
            onPageChange={(e) => setCurrentPage(e.currentPage + 1)}
          />
        </Worker>
      </div>
      <div
        className="annotation-column"
        style={{
          width: "300px",
          overflowY: "auto",
          backgroundColor: "#f0f0f0",
        }}
      >
        <h3>Annotations</h3>
        <form onSubmit={handleAnnotationSubmit}>
          <input
            type="text"
            name="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Enter annotation text"
            style={{ color: "black" }}
          />
          <button type="submit">Add Annotation</button>
        </form>
        {annotations
          .filter((annotation) => annotation.pageNumber === currentPage)
          .map((annotation) => (
            <div
              key={annotation.id}
              className="annotation"
              style={{
                backgroundColor: "gray",
                marginBottom: "10px",
                padding: "5px",
              }}
            >
              {annotation.text} ——来自{annotation.userName || "匿名用户"}
            </div>
          ))}
      </div>
    </div>
  );
};

export default PdfViewer;
