import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const pdfViewer = (url, annotations) => {
  const loadingTask = pdfjsLib.getDocument(url);

  loadingTask.promise.then(
    (pdf) => {
      console.log("PDF loaded");

      const container = document.getElementById("pdf-viewer");
      container.innerHTML = ""; // Clear the container

      for (let i = 1; i <= pdf.numPages; i++) {
        pdf.getPage(i).then((page) => {
          const viewport = page.getViewport({ scale: 1.5 });

          const pageContainer = document.createElement("div");
          pageContainer.className = "page-container";
          pageContainer.style.position = "relative";
          pageContainer.style.marginBottom = "10px";
          container.appendChild(pageContainer);

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          pageContainer.appendChild(canvas);

          page.render({ canvasContext: context, viewport: viewport });

          // Add annotations
          annotations
            .filter((ann) => ann.page === i)
            .forEach((ann) => {
              const annotationDiv = document.createElement("div");
              annotationDiv.className = "annotation";
              annotationDiv.style.position = "absolute";
              annotationDiv.style.top = `${ann.y}px`;
              annotationDiv.style.left = `${viewport.width + 20}px`;
              annotationDiv.textContent = ann.text;
              pageContainer.appendChild(annotationDiv);
            });
        });
      }
    },
    (reason) => {
      console.error("Error loading PDF", reason);
    }
  );
};

export default pdfViewer;
