"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import AnnotationViewer from "../components/AnnotationViewer";
import VisibilityPicker from "../components/VisibilityPicker";
import * as pdfjsLib from 'pdfjs-dist';

// 设置worker — 走本地静态文件，避免外网 CDN 阻塞首屏
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

interface Annotation {
  id: number;
  pdfFile: string;
  pageNumber: number;
  userName: string;
  text: string;
  yPosition: number;
  createdAt: string;
  x1Position?: number;
  y2Position?: number;
  x2Position?: number;
}

interface PdfPageInfo {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  viewport: pdfjsLib.PageViewport;
  pageNumber: number;
  top: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
}

// 新增：存储每个标识符的位置信息
interface MarkerRegion {
  annotationId: number;
  x: number;
  y: number;
  radius: number;
  isStart: boolean;
  pageNumber: number;
}

const PRIMARY_TAGS = [
  "科学·大类", "计算机与软件使用", "家务与健康",
  "行政与社会生活", "哲学、社会学与心理", "文学与美学",
];

const PdfViewer: React.FC = () => {
  const searchParams = useSearchParams();
  const file = searchParams?.get("file");
  const initialPage = parseInt(searchParams?.get("page") || "1", 10);
  const initialPdfY = parseFloat(searchParams?.get("pdfY") || "");
  const fileUrl = `http://localhost:3001/pdf/${file}`;

  // PDF文档和渲染状态
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [scale, setScale] = useState<number>(1.0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  
  // DOM引用
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  
  // 标记模式
  const [startMark, setStartMark] = useState<{ 
    x: number; 
    y: number; 
    pageNumber: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const [endMark, setEndMark] = useState<{ 
    x: number; 
    y: number; 
    pageNumber: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);
  
  // 文本模式
  const [annotationPanelWidth, setAnnotationPanelWidth] = useState(320);
  const [wheelDelta, setWheelDelta] = useState(0);
  const annotationPanelRef = useRef<HTMLDivElement>(null);
  
  // 批注数据
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationVisibility, setAnnotationVisibility] = useState<0 | 1 | 2>(2);
  const [clickPosition, setClickPosition] = useState<{
    clientY: number;
    pdfY: number;
    pageNumber: number;
  } | null>(null);
  
  // Viewport信息
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 0,
    pageDimensions: [] as Array<{ 
      width: number; 
      height: number; 
      pdfWidth: number; 
      pdfHeight: number;
      top: number;
    }>,
    scale: 1,
    pdfScale: 1,
  });
  const [viewportReady, setViewportReady] = useState(false);
  const [leftOffset, setLeftOffset] = useState(0);
  const [pageInfos, setPageInfos] = useState<PdfPageInfo[]>([]);
  
  // 悬停状态
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<number | null>(null);
  
  // 新增：可见页面状态
  const [visiblePages, setVisiblePages] = useState<number[]>([currentPage]);
  
  // 新增：存储标识符位置信息
  const [markerRegions, setMarkerRegions] = useState<MarkerRegion[]>([]);

  // PDF页面左边缘在容器内的X偏移（用于进度标记符贴文档左侧）
  const [pdfPageLeft, setPdfPageLeft] = useState(0);

  // 笔记板进度标记
  const [notepadMark, setNotepadMark] = useState<{
    pageNumber: number;
    contentY: number;
    pdfX: number;
    pdfY: number;
  } | null>(null);
  const [markingProgress, setMarkingProgress] = useState(false);
  const markingProgressRef = useRef(false);
  useEffect(() => { markingProgressRef.current = markingProgress; }, [markingProgress]);

  // 所有用户对此 PDF 的部署标记
  const [pdfDeployments, setPdfDeployments] = useState<Array<{
    board_id: number; board_title: string; user_name: string;
    reading_progress: Record<string, unknown> | null;
  }>>([]);
  const [deployHoverPage, setDeployHoverPage] = useState<number | null>(null);
  const [deployHoverPos, setDeployHoverPos] = useState({ x: 0, y: 0 });

  // 归类面板
  const [showClassify, setShowClassify] = useState(false);
  const [classifyBoards, setClassifyBoards] = useState<{ id: number; title: string }[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null);
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [classifyNoteText, setClassifyNoteText] = useState("");
  const [classifying, setClassifying] = useState(false);

  useEffect(() => {
    if (!showClassify) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.get("http://localhost:3001/api/noteboards", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => setClassifyBoards(r.data)).catch(console.error);
  }, [showClassify]);

  const handleClassify = async () => {
    if (!notepadMark || !resourceId) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    setClassifying(true);
    try {
      let boardId = selectedBoardId;
      // 如果用户填了新笔记板名称，先创建
      if (!boardId && newBoardTitle.trim()) {
        const r = await axios.post(
          "http://localhost:3001/api/noteboards",
          { title: newBoardTitle.trim() },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        boardId = r.data.id;
      }
      if (!boardId) return;
      await axios.post(
        `http://localhost:3001/api/noteboards/${boardId}/items`,
        {
          item_type: "pdf",
          resource_id: resourceId,
          title: file ? decodeURIComponent(file).replace(/\.pdf$/i, "") : "PDF",
          note_text: classifyNoteText.trim() || null,
          reading_progress: {
            pageNumber: notepadMark.pageNumber,
            contentY: notepadMark.contentY,
            pdfX: notepadMark.pdfX,
            pdfY: notepadMark.pdfY,
          },
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowClassify(false);
      setSelectedBoardId(null);
      setNewBoardTitle("");
      setClassifyNoteText("");
    } catch (err) {
      console.error("归类失败", err);
    } finally {
      setClassifying(false);
    }
  };

  // 资源状态（推荐 / 历史记录）
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [showRecommend, setShowRecommend] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);

  // 页面尺寸和位置信息
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const overlayRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // 像素渲染的代版本号 — scale 变化时旧渲染会被丢弃
  const renderGenerationRef = useRef(0);
  // setupPages 的代版本号 — 并发调用时晚到的覆盖早到的，早到的放弃自身副作用
  const setupGenerationRef = useRef(0);
  // 跟踪每页活动的 RenderTask，缩放时主动取消
  const activeRenderTasks = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  // scaleRef — 让 loadPDF 不依赖 scale，避免 Ctrl+滚轮触发整文档重载
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  // 已加载过的文件名 — 防止 useSearchParams 在某些场景下（如双击批注弹窗关闭、focus 切回）
  // 让 loadPDF 重跑导致整本 PDF 被清空重渲，用户当前所在页空白
  const loadedFileRef = useRef<string | null>(null);

  // 阶段 1：并行获取所有页尺寸 + 建 DOM 骨架，立即让批注/标识符可定位
  const setupPages = useCallback(async (
    doc: pdfjsLib.PDFDocumentProxy,
    currentScale: number
  ): Promise<pdfjsLib.PDFPageProxy[]> => {
    if (!pagesContainerRef.current) return [];
    const container = pagesContainerRef.current;

    const myGen = ++setupGenerationRef.current;

    // 取消任何尚在进行的旧渲染
    activeRenderTasks.current.forEach(task => { try { task.cancel(); } catch {} });
    activeRenderTasks.current.clear();

    container.innerHTML = '';
    pageRefs.current.clear();
    canvasRefs.current.clear();
    overlayRefs.current.clear();

    const dpr = window.devicePixelRatio || 1;
    const pageGap = 20;

    // 并行抓取所有 page 对象 — pdfjs 内部会复用 worker
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1))
    );

    // await 期间已有更新的 setupPages 进入，放弃本次副作用
    if (setupGenerationRef.current !== myGen) return [];

    const newPageInfos: PdfPageInfo[] = [];
    const pageDimensions: Array<{ width: number; height: number; pdfWidth: number; pdfHeight: number; top: number }> = [];
    let totalHeight = 0;

    pages.forEach((page, idx) => {
      const i = idx + 1;
      const viewport = page.getViewport({ scale: currentScale });
      const pdfViewport = page.getViewport({ scale: 1.0 });

      const pageDiv = document.createElement('div');
      pageDiv.style.position = 'relative';
      pageDiv.style.marginBottom = `${pageGap}px`;
      pageDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      pageDiv.style.backgroundColor = 'white';
      pageDiv.style.width = `${viewport.width}px`;
      pageDiv.style.height = `${viewport.height}px`;
      pageDiv.dataset.pageNumber = i.toString();

      const pdfCanvas = document.createElement('canvas');
      pdfCanvas.width = Math.floor(viewport.width * dpr);
      pdfCanvas.height = Math.floor(viewport.height * dpr);
      pdfCanvas.style.width = `${viewport.width}px`;
      pdfCanvas.style.height = `${viewport.height}px`;
      pdfCanvas.style.display = 'block';

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = viewport.width;
      overlayCanvas.height = viewport.height;
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.width = `${viewport.width}px`;
      overlayCanvas.style.height = `${viewport.height}px`;
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '10';

      const interactiveOverlay = document.createElement('canvas');
      interactiveOverlay.width = viewport.width;
      interactiveOverlay.height = viewport.height;
      interactiveOverlay.style.position = 'absolute';
      interactiveOverlay.style.left = '0';
      interactiveOverlay.style.top = '0';
      interactiveOverlay.style.width = `${viewport.width}px`;
      interactiveOverlay.style.height = `${viewport.height}px`;
      interactiveOverlay.style.zIndex = '15';
      interactiveOverlay.style.cursor = 'pointer';

      pageDiv.appendChild(pdfCanvas);
      pageDiv.appendChild(overlayCanvas);
      pageDiv.appendChild(interactiveOverlay);
      container.appendChild(pageDiv);

      pageRefs.current.set(i, pageDiv);
      canvasRefs.current.set(i, pdfCanvas);
      overlayRefs.current.set(i, overlayCanvas);

      newPageInfos.push({
        canvas: pdfCanvas,
        overlay: overlayCanvas,
        viewport,
        pageNumber: i,
        top: totalHeight,
        height: viewport.height,
        pdfWidth: pdfViewport.width,
        pdfHeight: pdfViewport.height,
      });

      pageDimensions.push({
        width: viewport.width,
        height: viewport.height,
        pdfWidth: pdfViewport.width,
        pdfHeight: pdfViewport.height,
        top: totalHeight,
      });

      totalHeight += viewport.height + pageGap;
    });

    setPageInfos(newPageInfos);
    setContainerHeight(totalHeight);
    setViewport(prev => ({
      ...prev,
      scrollTop: containerRef.current?.scrollTop || 0,
      height: containerRef.current?.clientHeight || 800,
      scale: currentScale,
      pdfScale: currentScale,
      pageDimensions,
    }));
    setViewportReady(true);

    return pages;
  }, []);

  // 阶段 2：在后台渲染像素 — 不阻塞 UI；优先渲染当前可见区域
  const renderPagesPixels = useCallback(async (
    pages: pdfjsLib.PDFPageProxy[],
    currentScale: number,
    priorityPage: number = 1
  ): Promise<void> => {
    if (!pages || pages.length === 0) return;
    const gen = ++renderGenerationRef.current;
    const dpr = window.devicePixelRatio || 1;

    // 渲染顺序：以 priorityPage 为中心向外扩散，确保用户最关心的页最先呈现
    const order: number[] = [];
    const total = pages.length;
    const center = Math.max(1, Math.min(total, priorityPage));
    order.push(center);
    for (let d = 1; d < total; d++) {
      if (center + d <= total) order.push(center + d);
      if (center - d >= 1) order.push(center - d);
    }

    for (const i of order) {
      if (renderGenerationRef.current !== gen) return;
      const page = pages[i - 1];
      if (!page) continue;
      const canvas = canvasRefs.current.get(i);
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const viewport = page.getViewport({ scale: currentScale });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const task = page.render({ canvasContext: ctx, viewport });
      activeRenderTasks.current.set(i, task);
      try {
        await task.promise;
      } catch (err: unknown) {
        // 渲染被取消（缩放变化）属正常路径，静默跳过
        const name = (err as { name?: string })?.name;
        if (name !== 'RenderingCancelledException') {
          console.warn(`Page ${i} render failed:`, err);
        }
      } finally {
        activeRenderTasks.current.delete(i);
      }
      // 让出一帧给 UI / 滚动 / 批注交互
      await new Promise(r => requestAnimationFrame(r));
    }
  }, []);

  // 加载PDF文档
  const loadPDF = useCallback(async () => {
    if (!file) return;
    // 同一文件已加载过则跳过，避免无谓的 innerHTML 清空 + 重渲
    if (loadedFileRef.current === file) return;
    loadedFileRef.current = file;

    try {
      setIsLoading(true);
      const loadingTask = pdfjsLib.getDocument(fileUrl);
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);

      // 阶段 1：尺寸 + DOM 就绪 → 批注/标识符立即可定位（用 scaleRef 读最新值）
      const s = scaleRef.current;
      const pages = await setupPages(doc, s);
      setIsLoading(false);

      // 阶段 2：后台异步渲染像素，优先 initialPage
      renderPagesPixels(pages, s, initialPage);
    } catch (error) {
      console.error('Error loading PDF:', error);
      loadedFileRef.current = null; // 失败要允许下次重试
      setIsLoading(false);
    }
  }, [file, fileUrl, setupPages, renderPagesPixels, initialPage]);

  // 更新视口信息
  const updateViewportInfo = useCallback(() => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const height = container.clientHeight;
    
    setViewport(prev => ({
      ...prev,
      scrollTop,
      height
    }));
    
    // 计算可见页面
    if (pageInfos.length > 0) {
      const visible: number[] = [];
      const viewportTop = scrollTop;
      const viewportBottom = scrollTop + height;
      
      pageInfos.forEach(page => {
        const pageTop = page.top;
        const pageBottom = page.top + page.height;
        
        if (pageBottom >= viewportTop && pageTop <= viewportBottom) {
          visible.push(page.pageNumber);
        }
      });
      
      setVisiblePages(visible.length > 0 ? visible : [currentPage]);
    }
  }, [pageInfos, currentPage]);

  // 渲染所有批注
  const renderAllAnnotations = useCallback(() => {
    // 清空标识符位置信息
    setMarkerRegions([]);
    
    // 清除所有页面的overlay canvas
    pageInfos.forEach(pageInfo => {
      const overlayCanvas = overlayRefs.current.get(pageInfo.pageNumber);
      if (!overlayCanvas) return;
      
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    });
    
    const newMarkerRegions: MarkerRegion[] = [];
    
    // 绘制所有批注
    annotations.forEach((annotation, index) => {
      const regions = renderAnnotationMarker(annotation);
      if (regions) {
        newMarkerRegions.push(...regions);
      }
    });
    
    setMarkerRegions(newMarkerRegions);
  }, [annotations, pageInfos]);

  // 渲染单个批注标记
  const renderAnnotationMarker = (annotation: Annotation) => {
    const { pageNumber, x1Position, yPosition, x2Position, y2Position, id } = annotation;
    
    if (pageNumber === undefined || x1Position === undefined || yPosition === undefined || id === undefined) {
      return;
    }
    
    const overlayCanvas = overlayRefs.current.get(pageNumber);
    if (!overlayCanvas) return;
    
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    
    const viewport = pageInfos.find(p => p.pageNumber === pageNumber)?.viewport;
    if (!viewport) return;
    
    const isHovered = hoveredAnnotationId === annotation.id;
    const faded = hoveredAnnotationId !== null && hoveredAnnotationId !== annotation.id;
    
    ctx.globalAlpha = faded ? 0.25 : 1.0;
    
    const regions: MarkerRegion[] = [];
    
    // 转换PDF坐标到画布坐标
    const [canvasX1, canvasY1] = viewport.convertToViewportPoint(x1Position, yPosition);
    
    // 绘制开始标记「 - 用两条线段代替字符
    const bracketSize = 12; // 括号大小
    const lineWidth = 3;    // 线宽
    
    // 设置线条样式
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isHovered ? '#FF5722' : '#FFD700';
    
    // 绘制开始括号「
    ctx.beginPath();
    // 竖线部分
    ctx.moveTo(canvasX1, canvasY1);
    ctx.lineTo(canvasX1, canvasY1 + bracketSize);
    // 横线部分
    ctx.moveTo(canvasX1, canvasY1);
    ctx.lineTo(canvasX1 + bracketSize/2, canvasY1);
    ctx.stroke();
    
    // 记录开始标记位置
    regions.push({
      annotationId: id,
      x: canvasX1,
      y: canvasY1,
      radius: 15, // 稍微扩大点击区域
      isStart: true,
      pageNumber
    });
    
    // 绘制结束标记（如果有）
    if (x2Position !== undefined && y2Position !== undefined) {
      const [canvasX2, canvasY2] = viewport.convertToViewportPoint(x2Position, y2Position);
      
      // 绘制结束括号」
      ctx.beginPath();
      // 竖线部分
      ctx.moveTo(canvasX2, canvasY2);
      ctx.lineTo(canvasX2, canvasY2 - bracketSize);
      // 横线部分
      ctx.moveTo(canvasX2, canvasY2);
      ctx.lineTo(canvasX2 - bracketSize/2, canvasY2);
      ctx.stroke();
      
      // 记录结束标记位置
      regions.push({
        annotationId: id,
        x: canvasX2,
        y: canvasY2,
        radius: 15,
        isStart: false,
        pageNumber
      });
    }
    
    ctx.globalAlpha = 1.0;
    return regions;
  };

  // 处理文档点击
  const handleDocumentClick = useCallback(
    async (ev: MouseEvent) => {
      if (!pdfDoc || ev.ctrlKey) return;
      
      const target = ev.target as HTMLElement;
      const pageDiv = target.closest('div[data-page-number]') as HTMLDivElement;
      
      if (!pageDiv) return;
      
      const pageNumber = parseInt(pageDiv.dataset.pageNumber || '1', 10);
      
      const canvas = canvasRefs.current.get(pageNumber);
      if (!canvas) return;
      
      const canvasRect = canvas.getBoundingClientRect();
      const canvasX = ev.clientX - canvasRect.left;
      const canvasY = ev.clientY - canvasRect.top;
      
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = pageInfos.find(p => p.pageNumber === pageNumber)?.viewport;
      
      if (!viewport) return;
      
      const [pdfX, pdfY] = viewport.convertToPdfPoint(canvasX, canvasY);
      
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
        setStartMark(null);
        setEndMark(null);
        setClickPosition(null);
        return;
      }
      
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        
        const markInfo = {
          x: pdfX,
          y: pdfY,
          pageNumber,
          canvasX,
          canvasY
        };
        
        if (!startMark) {
          setStartMark(markInfo);
        } else if (startMark.pageNumber === pageNumber) {
          setEndMark(markInfo);
          setClickPosition({ 
            clientY: ev.clientY, 
            pdfY: pdfY, 
            pageNumber 
          });
        } else {
          setStartMark(markInfo);
          setEndMark(null);
        }
      }, 250);
    },
    [pdfDoc, pageInfos, startMark]
  );

  // 处理标识符点击/悬停
  const handleMarkerMouseMove = useCallback((ev: MouseEvent) => {
    const target = ev.target as HTMLElement;
    const pageDiv = target.closest('div[data-page-number]') as HTMLDivElement;
    
    if (!pageDiv) {
      setHoveredAnnotationId(null);
      return;
    }
    
    const pageNumber = parseInt(pageDiv.dataset.pageNumber || '1', 10);
    const canvas = canvasRefs.current.get(pageNumber);
    
    if (!canvas) {
      setHoveredAnnotationId(null);
      return;
    }
    
    const canvasRect = canvas.getBoundingClientRect();
    const mouseX = ev.clientX - canvasRect.left;
    const mouseY = ev.clientY - canvasRect.top;
    
    // 检查鼠标是否在某个标识符区域内
    const hoveredMarker = markerRegions.find(region => {
      if (region.pageNumber !== pageNumber) return false;
      
      const distance = Math.sqrt(
        Math.pow(mouseX - region.x, 2) + Math.pow(mouseY - region.y, 2)
      );
      
      return distance <= region.radius;
    });
    
    if (hoveredMarker) {
      setHoveredAnnotationId(hoveredMarker.annotationId);
    } else {
      setHoveredAnnotationId(null);
    }
  }, [markerRegions]);

  // 处理缩放
  const handleZoom = async (zoomIn: boolean, targetScale?: number) => {
    if (!pdfDoc) return;
    const newScale = targetScale ?? (zoomIn ? scale + 0.25 : Math.max(0.5, scale - 0.25));
    setScale(newScale);
    const pages = await setupPages(pdfDoc, newScale);
    renderPagesPixels(pages, newScale, currentPage);
  };

  // Ctrl+滚轮缩放 PDF，拦截浏览器默认页面缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (!pdfDoc) return;
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setScale(prev => {
        const next = Math.min(4, Math.max(0.25, parseFloat((prev + delta).toFixed(2))));
        setupPages(pdfDoc, next).then(pages => {
          renderPagesPixels(pages, next, currentPage);
        });
        return next;
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [pdfDoc, setupPages, renderPagesPixels, currentPage]);

  // 禁止整个页面滚动
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // 加载PDF
  useEffect(() => {
    loadPDF();
  }, [loadPDF]);

  // 添加滚动监听
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      const handleScroll = () => {
        updateViewportInfo();
        
        const scrollTop = container.scrollTop;
        for (let i = 0; i < pageInfos.length; i++) {
          const page = pageInfos[i];
          if (scrollTop >= page.top && scrollTop < page.top + page.height) {
            setCurrentPage(page.pageNumber);
            break;
          }
        }
      };
      
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [pageInfos, updateViewportInfo]);

  // 处理标识符点击
  const handleMarkerClick = useCallback((ev: MouseEvent) => {
    const target = ev.target as HTMLElement;
    const pageDiv = target.closest('div[data-page-number]') as HTMLDivElement;
    
    if (!pageDiv) return;
    
    const pageNumber = parseInt(pageDiv.dataset.pageNumber || '1', 10);
    const canvas = canvasRefs.current.get(pageNumber);
    
    if (!canvas) return;
    
    const canvasRect = canvas.getBoundingClientRect();
    const mouseX = ev.clientX - canvasRect.left;
    const mouseY = ev.clientY - canvasRect.top;
    
    // 检查鼠标是否在某个标识符区域内
    const clickedMarker = markerRegions.find(region => {
      if (region.pageNumber !== pageNumber) return false;
      
      const distance = Math.sqrt(
        Math.pow(mouseX - region.x, 2) + Math.pow(mouseY - region.y, 2)
      );
      
      return distance <= region.radius;
    });
    
    if (clickedMarker && ev.detail === 2) {
      axios.post("http://localhost:3001/api/threads/create", {
        annotationId: clickedMarker.annotationId,
        userName: "Current User",
      }).then(r => {
        window.open(`http://localhost:3002/threads/${r.data.threadId}`, "_blank");
      }).catch(console.error);
    }
  }, [markerRegions]);

  // 合并点击事件处理
  const handleClick = useCallback((ev: MouseEvent) => {
    const target = ev.target as HTMLElement;
    const pageDiv = target.closest('div[data-page-number]') as HTMLDivElement;

    if (pageDiv) {
      const pageNumber = parseInt(pageDiv.dataset.pageNumber || '1', 10);
      const canvas = canvasRefs.current.get(pageNumber);

      if (canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = ev.clientX - canvasRect.left;
        const mouseY = ev.clientY - canvasRect.top;

        const clickedMarker = markerRegions.find(region => {
          if (region.pageNumber !== pageNumber) return false;
          const distance = Math.sqrt(Math.pow(mouseX - region.x, 2) + Math.pow(mouseY - region.y, 2));
          return distance <= region.radius;
        });

        if (clickedMarker) {
          if (ev.detail === 2) {
            axios.post("http://localhost:3001/api/threads/create", {
              annotationId: clickedMarker.annotationId,
              userName: "Current User",
            }).then(r => {
              const popupWidth = 1200;  // 横向
              const popupHeight = 800;
              const left = Math.max(0, window.innerWidth - popupWidth - 20);
              const top = Math.max(0, (window.innerHeight - popupHeight) / 2);
              const features = `width=${popupWidth},height=${popupHeight},left=${left},top=${top},noopener,noreferrer`;
              window.open(`http://localhost:3002/threads/${r.data.threadId}?sw=150`, "_blank", features);
            }).catch(console.error);
          }
          return;
        }
      }
    }

    // 进度标记模式：记录点击位置，不触发批注标识符
    if (markingProgressRef.current) {
      if (!pageDiv || !containerRef.current) return;
      const pageNumber = parseInt(pageDiv.dataset.pageNumber || '1', 10);
      const canvas = canvasRefs.current.get(pageNumber);
      const pageInfo = pageInfos.find(p => p.pageNumber === pageNumber);
      if (!canvas || !pageInfo) return;
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasX = ev.clientX - canvasRect.left;
      const canvasY = ev.clientY - canvasRect.top;
      const [pdfX, pdfY] = pageInfo.viewport.convertToPdfPoint(canvasX, canvasY);
      const contentY = containerRef.current.scrollTop + (ev.clientY - containerRect.top);
      setNotepadMark({ pageNumber, pdfX, pdfY, contentY });
      setMarkingProgress(false);
      setShowClassify(true);
      return;
    }

    handleDocumentClick(ev);
  }, [handleDocumentClick, markerRegions, pageInfos]);

  // 添加点击事件监听
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("click", handleClick as EventListener);
      return () => {
        container.removeEventListener("click", handleClick as EventListener);
      };
    }
  }, [handleClick]);

  // 添加标识符悬停事件监听
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMarkerMouseMove as EventListener);
      return () => {
        container.removeEventListener("mousemove", handleMarkerMouseMove as EventListener);
      };
    }
  }, [handleMarkerMouseMove]);

  // 注册 PDF 资源，获取 resourceId
  useEffect(() => {
    if (!file) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.post(
      "http://localhost:3001/api/resources/register",
      { type: "pdf", identifier: file, title: decodeURIComponent(file).replace(/\.pdf$/i, "") },
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => setResourceId(r.data.id)).catch(console.error);
  }, [file]);

  useEffect(() => {
    if (!file || !resourceId) return;
    axios.get("http://localhost:3001/api/noteboards/deployments", {
      params: { item_type: "pdf", identifier: file },
    }).then(r => setPdfDeployments(r.data)).catch(console.error);
  }, [resourceId]); // eslint-disable-line

  // 计算PDF页面左边缘偏移，使进度标记符能紧贴文档
  useEffect(() => {
    const compute = () => {
      const canvas = canvasRefs.current.get(1);
      if (!canvas || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      setPdfPageLeft(canvasRect.left - containerRect.left + containerRef.current.scrollLeft);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [pageInfos]);

  // 跳转到 URL 指定页 + 精确 pdfY 位置（pageInfos 就绪后）
  useEffect(() => {
    if (pageInfos.length === 0) return;
    if (initialPage <= 1 && isNaN(initialPdfY)) return;
    const dim = viewport.pageDimensions[initialPage - 1];
    if (!dim || !containerRef.current) return;
    let scrollY: number;
    if (!isNaN(initialPdfY) && dim.pdfHeight) {
      // 精确跳到 pdfY 对应的像素位置，并居中显示
      const relY = 1 - initialPdfY / dim.pdfHeight;
      scrollY = dim.top + 20 + relY * dim.height - containerRef.current.clientHeight * 0.35;
    } else {
      scrollY = dim.top;
    }
    containerRef.current.scrollTop = Math.max(0, scrollY);
  }, [pageInfos, initialPage, initialPdfY]); // eslint-disable-line

  // 每 30 秒自动保存阅读进度
  useEffect(() => {
    if (!resourceId) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const interval = setInterval(() => {
      axios.post(
        `http://localhost:3001/api/resources/${resourceId}/history`,
        {
          pageNumber: currentPage,
          progressPercent: totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(console.error);
    }, 30_000);
    return () => clearInterval(interval);
  }, [resourceId, currentPage, totalPages]);

  // 拉取批注
  useEffect(() => {
    if (!file) return;
    axios
      .get(`http://localhost:3001/api/annotations?pdfFile=${file}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      .then((r) => {
        setAnnotations(r.data);
        setTimeout(() => renderAllAnnotations(), 100);
      })
      .catch(console.error);
  }, [file]);

  // 统一重绘：已保存批注 + 待确认临时标识符
  useEffect(() => {
    if (pageInfos.length === 0) return;

    // 清除所有 overlay canvas
    pageInfos.forEach(pageInfo => {
      const overlayCanvas = overlayRefs.current.get(pageInfo.pageNumber);
      if (!overlayCanvas) return;
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    });

    // 绘制已保存批注，收集 markerRegions
    const newMarkerRegions: MarkerRegion[] = [];
    annotations.forEach(annotation => {
      const regions = renderAnnotationMarker(annotation);
      if (regions) newMarkerRegions.push(...regions);
    });
    setMarkerRegions(newMarkerRegions);

    // 在顶层绘制待确认标识符（「开始 / 」结束）
    const drawBracket = (canvas: HTMLCanvasElement, cx: number, cy: number, isStart: boolean) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const s = 12;
      ctx.save();
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#FFD700';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      if (isStart) {
        ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + s);
        ctx.moveTo(cx, cy); ctx.lineTo(cx + s / 2, cy);
      } else {
        ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - s);
        ctx.moveTo(cx, cy); ctx.lineTo(cx - s / 2, cy);
      }
      ctx.stroke();
      ctx.restore();
    };

    if (startMark) {
      const oc = overlayRefs.current.get(startMark.pageNumber);
      if (oc) drawBracket(oc, startMark.canvasX, startMark.canvasY, true);
    }
    if (endMark) {
      const oc = overlayRefs.current.get(endMark.pageNumber);
      if (oc) drawBracket(oc, endMark.canvasX, endMark.canvasY, false);
    }
  }, [annotations, pageInfos, hoveredAnnotationId, startMark, endMark]);

  // 拖拽改变宽度
  const handleDragMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = annotationPanelWidth;
    const onMove = (m: MouseEvent) => {
      const delta = startX - m.clientX;
      setAnnotationPanelWidth(Math.max(10, startW + delta));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 提交批注
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = new FormData(e.currentTarget as HTMLFormElement).get("text") as string;
    if (!text.trim() || !startMark || !endMark || startMark.pageNumber !== endMark.pageNumber) return;

    try {
      const r = await axios.post(
        "http://localhost:3001/api/annotations",
        {
          pdfFile: file,
          pageNumber: startMark.pageNumber,
          text,
          yPosition: startMark.y,
          x1Position: startMark.x,
          y2Position: endMark.y,
          x2Position: endMark.x,
          visibilityLevel: annotationVisibility,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      setAnnotations((a) => [...a, r.data]);
      setClickPosition(null);
      setStartMark(null);
      setEndMark(null);
      setAnnotationVisibility(2);
    } catch (err) {
      console.error(err);
    }
  };


  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>

      {/* PDF 渲染区 — 全宽，批注面板为覆盖层 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "auto",
          backgroundColor: "#fffef7",
          cursor: markingProgress ? "crosshair" : "default",
        }}
      >
        {/* 进度标记符 — 贴文档左边缘，跟随内容滚动 */}
        {notepadMark && pdfPageLeft > 0 && (
          <div
            style={{
              position: "absolute",
              left: pdfPageLeft,
              top: notepadMark.contentY,
              transform: "translate(-50%, -50%)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              pointerEvents: "auto",
              cursor: "default",
            }}
            onMouseEnter={e => {
              setDeployHoverPage(notepadMark.pageNumber);
              setDeployHoverPos({ x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => setDeployHoverPage(null)}
          >
            <img src="/Annotations_style/进度标记符.png" alt="进度标记" style={{ width: 22, height: 22 }} />
            <span style={{
              fontSize: 9, color: "#173708", fontWeight: 600,
              backgroundColor: "rgba(255,255,255,0.88)", borderRadius: 3,
              padding: "1px 3px", marginTop: 1, whiteSpace: "nowrap",
            }}>
              P{notepadMark.pageNumber}
            </span>
          </div>
        )}

        {/* 部署标记 — 每条记录按 pdfY 精确定位 */}
        {viewportReady && pdfPageLeft > 0 && pdfDeployments.map((dep, i) => {
          const rp = dep.reading_progress;
          const pg = (rp?.pageNumber as number) | 0;
          if (!pg) return null;
          const dim = viewport.pageDimensions[pg - 1];
          if (!dim) return null;
          const pdfY = rp?.pdfY as number | undefined;
          const contentY = pdfY != null && dim.pdfHeight
            ? dim.top + 20 + (1 - pdfY / (dim.pdfHeight as number)) * dim.height
            : dim.top + 20;
          return (
            <div
              key={`dep-${i}`}
              style={{
                position: "absolute",
                left: pdfPageLeft - 14 - (i % 2) * 6,
                top: contentY,
                transform: "translate(-50%, -50%)",
                zIndex: 48,
                pointerEvents: "auto",
                cursor: "default",
              }}
              onMouseEnter={e => {
                setDeployHoverPage(pg);
                setDeployHoverPos({ x: e.clientX, y: e.clientY });
              }}
              onMouseLeave={() => setDeployHoverPage(null)}
            >
              <img src="/Annotations_style/进度标记符.png" alt=""
                style={{ width: 16, height: 16, opacity: 0.55 }} />
            </div>
          );
        })}
        {/* PDF 页面容器始终挂载——任何 isLoading 短暂翻转都不会销毁里面命令式创建的 canvas */}
        <div
          ref={pagesContainerRef}
          style={{
            padding: "20px",
            minHeight: `${containerHeight}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center"
          }}
        />
        {isLoading && (
          <div style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            zIndex: 100,
            background: "rgba(255, 254, 247, 0.85)",
            padding: "20px 32px",
            borderRadius: 8,
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              border: "3px solid #f3f3f3",
              borderTop: "3px solid #3498db",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 10px"
            }} />
            <p>正在加载PDF文档...</p>
          </div>
        )}
      </div>

      {/* 归类面板 */}
      {showClassify && notepadMark && (
        <div style={{
          position: "fixed", bottom: 100, left: 20, zIndex: 2000,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
          width: 260,
          padding: "14px 16px",
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2e1a" }}>
              归类到笔记板
            </span>
            <button
              onClick={() => { setShowClassify(false); setSelectedBoardId(null); setNewBoardTitle(""); setClassifyNoteText(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af", lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
            已标记 P{notepadMark.pageNumber}
          </div>

          {/* 笔记板列表 */}
          <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 10 }}>
            {classifyBoards.length === 0
              ? <div style={{ fontSize: 12, color: "#b0b0b0", padding: "4px 0" }}>暂无笔记板</div>
              : classifyBoards.map(b => (
                <label key={b.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 6px", borderRadius: 6, cursor: "pointer",
                  background: selectedBoardId === b.id ? "#f0fdf4" : "transparent",
                  fontSize: 13, color: "#374151",
                }}>
                  <input
                    type="radio"
                    name="board"
                    checked={selectedBoardId === b.id}
                    onChange={() => { setSelectedBoardId(b.id); setNewBoardTitle(""); }}
                    style={{ accentColor: "#16a34a" }}
                  />
                  {b.title}
                </label>
              ))
            }
          </div>

          {/* 新建笔记板 */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>新建笔记板</div>
            <input
              type="text"
              placeholder="输入名称…"
              value={newBoardTitle}
              onChange={e => { setNewBoardTitle(e.target.value); setSelectedBoardId(null); }}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 8px", fontSize: 12,
                border: `1px solid ${newBoardTitle ? "#16a34a" : "#d1d5db"}`,
                borderRadius: 6, outline: "none",
              }}
            />
          </div>

          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 5 }}>添加笔记（可选）</div>
            <textarea
              placeholder="部署时将自动生成连线文本框…"
              value={classifyNoteText}
              onChange={e => setClassifyNoteText(e.target.value)}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "6px 8px", fontSize: 12,
                border: "1px solid #d1d5db", borderRadius: 6,
                outline: "none", resize: "none",
                fontFamily: "inherit", lineHeight: 1.5,
              }}
            />
          </div>

          {/* 操作按钮 */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setShowClassify(false); setSelectedBoardId(null); setNewBoardTitle(""); setClassifyNoteText(""); }}
              style={{
                flex: 1, padding: "6px 0", fontSize: 12,
                border: "1px solid #d1d5db", borderRadius: 6,
                background: "transparent", color: "#6b7280", cursor: "pointer",
              }}
            >
              取消
            </button>
            <button
              disabled={classifying || (!selectedBoardId && !newBoardTitle.trim())}
              onClick={handleClassify}
              style={{
                flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 500,
                border: "none", borderRadius: 6,
                background: (selectedBoardId || newBoardTitle.trim()) ? "#16a34a" : "#d1d5db",
                color: "#fff",
                cursor: (selectedBoardId || newBoardTitle.trim()) ? "pointer" : "default",
              }}
            >
              {classifying ? "归类中…" : "归类"}
            </button>
          </div>
        </div>
      )}

      {/* 进度标记符按钮 + 缩放倍率 — 固定在左下角 */}
      <div style={{
        position: "fixed",
        bottom: 20,
        left: 20,
        zIndex: 100,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <button
            onClick={() => setMarkingProgress(v => !v)}
            title={markingProgress ? "点击PDF页面以记录位置" : (notepadMark ? `已标记 P${notepadMark.pageNumber}，点击重新标记` : "点击后在PDF上标记阅读进度")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: markingProgress ? "#173708" : "rgba(255,255,255,0.92)",
              border: `1px solid ${markingProgress ? "transparent" : "rgba(23,55,8,0.18)"}`,
              borderRadius: 6,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.14)",
              color: markingProgress ? "white" : "#173708",
              fontSize: 12,
              fontFamily: "'Inter', -apple-system, sans-serif",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            <img src="/Annotations_style/进度标记符.png" alt="" style={{ width: 16, height: 16, opacity: markingProgress ? 1 : 0.75 }} />
            {markingProgress ? "点击页面标记" : "标记进度"}
          </button>
          {notepadMark && !markingProgress && (
            <button
              onClick={() => setNotepadMark(null)}
              style={{
                padding: "3px 8px",
                fontSize: 10,
                color: "#9ca3af",
                background: "rgba(255,255,255,0.88)",
                border: "1px solid #e5e7eb",
                borderRadius: 4,
                cursor: "pointer",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              }}
            >
              清除标记
            </button>
          )}
        </div>
        <span
          title="点击还原为 100%"
          onClick={() => handleZoom(true, 1.0)}
          style={{
            padding: "5px 10px",
            background: scale === 1.0 ? "rgba(255,255,255,0.88)" : "rgba(255,248,200,0.95)",
            border: `1px solid ${scale === 1.0 ? "rgba(23,55,8,0.14)" : "rgba(180,140,0,0.35)"}`,
            borderRadius: 6,
            fontSize: 12,
            color: "#173708",
            fontFamily: "'Inter', -apple-system, sans-serif",
            boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
            letterSpacing: "0.02em",
            cursor: scale !== 1.0 ? "pointer" : "default",
            transition: "background 0.15s, border-color 0.15s",
            userSelect: "none",
          }}
        >
          {Math.round(scale * 100)}%
        </span>
      </div>


      {/* 提交表单 */}
      {clickPosition && (
        <div
          style={{
            position: "fixed",
            left: `calc(${annotationPanelWidth}px + 30px)`,
            top: clickPosition.clientY,
            zIndex: 9999,
            background: "#fff",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
            borderRadius: 8,
            padding: 16,
            width: 400,
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "stretch", height: 92 }}>
              <button type="submit">提交</button>
              <textarea
                name="text"
                placeholder="输入批注内容..."
                autoFocus
                required
                style={{
                  flex: 1,
                  height: 80,
                  padding: 8,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  resize: "vertical",
                }}
              />
            </div>
            <VisibilityPicker size="compact"
              value={annotationVisibility} onChange={setAnnotationVisibility} />
          </form>
        </div>
      )}

      {/* 部署信息悬停弹窗 */}
      {deployHoverPage !== null && (() => {
        const deps = pdfDeployments.filter(d =>
          (d.reading_progress?.pageNumber as number) === deployHoverPage
        );
        if (deps.length === 0) return null;
        return (
          <div style={{
            position: "fixed",
            left: Math.min(deployHoverPos.x + 14, window.innerWidth - 220),
            top: Math.max(deployHoverPos.y - 10, 8),
            zIndex: 9999,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
            padding: "8px 12px",
            minWidth: 180,
            pointerEvents: "none",
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 5 }}>已被收录至</div>
            {deps.map((d, i) => (
              <div key={i} style={{ fontSize: 12, color: "#1a2e1a", padding: "2px 0",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.user_name} · {d.board_title}
              </div>
            ))}
          </div>
        );
      })()}

      {/* 右侧批注区 — 覆盖层，不影响PDF布局 */}
      <div
        ref={annotationPanelRef}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: annotationPanelWidth,
          background: [
            "linear-gradient(to right,",
            "#F7F8F7 0px,#F7F8F7 1px,",
            "#F0F0E9 1px,#F0F0E9 2px,",
            "#F1F1EA 2px,#F1F1EA 4px,",
            "#F1F2EB 4px,#F1F2EB 6px,",
            "#F2F2EC 6px,#F2F2EC 8px,",
            "#F3F3ED 8px,#F3F3ED 11px,",
            "#F4F4ED 11px,#F4F4ED 14px,",
            "#F5F5EE 14px,#F5F5EE 17px,",
            "#F5F6EF 17px,#F5F6EF 21px,",
            "#F6F6F0 21px,#F6F6F0 27px,",
            "#F7F7F1 27px,#F7F7F1 calc(100% - 28px),",
            "#F7F8F1 calc(100% - 28px),#F7F8F1 calc(100% - 22px),",
            "#F7F8F2 calc(100% - 22px),#F7F8F2 calc(100% - 18px),",
            "#F7F8F3 calc(100% - 18px),#F7F8F3 calc(100% - 14px),",
            "#F7F8F4 calc(100% - 14px),#F7F8F4 calc(100% - 11px),",
            "#F7F8F5 calc(100% - 11px),#F7F8F5 calc(100% - 6px),",
            "#F7F8F6 calc(100% - 6px),#F7F8F6 calc(100% - 4px),",
            "#F7F8F7 calc(100% - 4px),#F7F8F7 100%)",
          ].join(""),
          borderLeft: "none",
          overflow: "hidden",
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <AnnotationViewer
            annotations={annotations}
            viewport={viewport}
            leftOffset={leftOffset}
            displayMode="text"
            wheelDelta={wheelDelta}
            currentPage={currentPage}
            visiblePages={visiblePages}
            file={file || undefined}
            hoveredAnnotationId={hoveredAnnotationId}
            onAnnotationHover={setHoveredAnnotationId}
            onWheelDeltaChange={setWheelDelta}
          />
        </div>

        {/* 拖拽调整宽度手柄 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 5,
            cursor: "col-resize",
            zIndex: 10,
          }}
          onMouseDown={handleDragMouseDown}
        />
      </div>
    </div>
  );
};

export default PdfViewer;