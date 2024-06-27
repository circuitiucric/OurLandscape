"use client";
import React, { useEffect, useState } from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { useSearchParams } from "next/navigation";

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file"); // 使用可选链操作符处理 null 情况
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

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
  }, [fileUrl]);

  return (
    <div style={{ height: "100vh" }}>
      <Worker
        workerUrl={`https://unpkg.com/pdfjs-dist@3.0.279/build/pdf.worker.min.js`}
      >
        <Viewer fileUrl={fileUrl} plugins={[defaultLayoutPluginInstance]} />
      </Worker>
    </div>
  );
};

export default PdfViewer;
