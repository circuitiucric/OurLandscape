"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";

const SelectPDF: React.FC = () => {
  const [pdfFiles, setPdfFiles] = useState<string[]>([]);

  useEffect(() => {
    const fetchPDFs = async () => {
      try {
        const response = await axios.get("http://localhost:3001/pdfs");
        setPdfFiles(response.data);
      } catch (error) {
        console.error("Error fetching PDFs:", error);
      }
    };

    fetchPDFs();
  }, []);

  return (
    <div>
      <h1>Select a PDF</h1>
      <ul>
        {pdfFiles.map((file, index) => (
          <li key={index}>
            <Link href={`/pdf-viewer?file=${encodeURIComponent(file)}`}>
              {file}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SelectPDF;
