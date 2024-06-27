"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const PdfViewer: React.FC = () => {
  const searchParams = useSearchParams();

  // 如果 searchParams 为空，则返回一个错误信息
  if (!searchParams) {
    return <div>Invalid search parameters</div>;
  }

  const file = searchParams.get("file");

  if (!file) {
    return <div>No PDF file specified</div>;
  }

  const pdfUrl = `http://localhost:3001/pdf/${decodeURIComponent(file)}`;

  return (
    <div>
      <h1>PDF Viewer</h1>
      <iframe src={pdfUrl} width="100%" height="600px" />
      <Link href="/select-pdf">Back to PDF list</Link>
    </div>
  );
};

export default PdfViewer;
