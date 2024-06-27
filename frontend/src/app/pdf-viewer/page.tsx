"use client";
import React from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { useSearchParams } from "next/navigation";

const PdfViewer = () => {
  const searchParams = useSearchParams();
  const file = searchParams ? searchParams.get("file") : null;
  const fileUrl = file ? `/pdf/${file}` : null;

  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  return (
    <div style={{ height: "100vh" }}>
      <Worker
        workerUrl={`https://unpkg.com/pdfjs-dist@3.0.279/build/pdf.worker.min.js`}
      >
        {fileUrl ? (
          <Viewer fileUrl={fileUrl} plugins={[defaultLayoutPluginInstance]} />
        ) : (
          <div>文件未找到或未指定。</div>
        )}
      </Worker>
    </div>
  );
};

export default PdfViewer;
