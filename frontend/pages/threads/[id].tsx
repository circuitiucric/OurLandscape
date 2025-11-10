import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import AnnotationViewer from "src/app/components/AnnotationViewer"; // 引入批注展示组件

interface Annotation {
  id?: number;
  replyId: number;
  text: string;
  userName: string;
  pdfFile?: string;
  pageNumber?: number;
}

interface Block {
  type: "text" | "image";
  content?: string;
  url?: string;
}

interface Reply {
  id: number;
  content: {
    blocks: Block[];
  };
  created_by: string;
  created_at: string;
}

const ThreadPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([
    { type: "text", content: "" },
  ]);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [selectedReplyId, setSelectedReplyId] = useState<number | null>(null); // 当前选中的回复
  const [annotations, setAnnotations] = useState<Annotation[]>([]); // 存储批注
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 新增状态用于记录滑动条的值，取值范围 0-100，代表百分比
  // 文字选择相关状态
  const [isSelectingText, setIsSelectingText] = useState<boolean>(false);
  const [selectedText, setSelectedText] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);

  // 计算选中文字在回复文本中的位置
  const calculateOffsets = (
    selection: Selection,
    container: HTMLElement
  ): { startOffset: number; endOffset: number } | null => {
    try {
      const range = selection.getRangeAt(0);
      const preSelectionRange = range.cloneRange();
      preSelectionRange.selectNodeContents(container);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = preSelectionRange.toString().length;
      
      return {
        startOffset,
        endOffset: startOffset + range.toString().length,
      };
    } catch (e) {
      console.error("Error calculating text offsets:", e);
      return null;
    }
  };

  // 处理文字选择事件
  const handleTextSelect = (event: MouseEvent | TouchEvent) => {
    if (!isSelectingText) return;
    
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    
    if (!text || !selection) return;
    
    const target = event.target as HTMLElement;
    const replyContainer = target.closest(".reply-content") as HTMLElement;
    
    if (!replyContainer) return;
    
    const offsets = calculateOffsets(selection, replyContainer);
    if (!offsets) return;
    
    setSelectedText({
      text,
      ...offsets,
    });
  };

  // 监听文字选择
  useEffect(() => {
    if (!isSelectingText) {
      setSelectedText(null);
      return;
    }

    const handleMouseUp = (e: MouseEvent) => handleTextSelect(e);
    const handleTouchEnd = (e: TouchEvent) => handleTextSelect(e);

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isSelectingText]);

  // 获取线程和回复数据
  useEffect(() => {
    if (id) {
      console.log("Fetching thread for id:", id);
      // 获取线程数据
      axios
        .get(`http://localhost:3001/api/threads/${id}`)
        .then((response) => {
          setAnnotation(response.data);
        })
        .catch((error) => {
          console.error("Error fetching thread:", error);
          setError("Failed to load thread");
        });

      // 获取该线程的所有回复
      axios
        .get(`http://localhost:3001/api/replies`, {
          params: { threadId: id },
        })
        .then((response) => {
          setReplies(response.data);
        })
        .catch((error) => {
          console.error("Error fetching replies:", error);
          setError("Failed to load replies");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [id]);

  useEffect(() => {
    if (selectedReplyId !== null) {
      axios
        .get(`http://localhost:3001/api/annotations?replyId=${selectedReplyId}`)
        .then((response) => {
          setAnnotations(response.data);
        })
        .catch((error) => {
          console.error("Error fetching annotations:", error);
        });
    }
  }, [selectedReplyId]);

  const handleImageUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await axios.post(
        "http://localhost:3001/api/replies/upload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      // 添加新的图片块
      setBlocks((prevBlocks) => [
        ...prevBlocks,
        { type: "image", url: response.data.url },
      ]);
      setSelectedImageFile(null);
    } catch (error) {
      console.error("Error uploading image:", error);
      setError("Failed to upload image");
    }
  };

  const handleReplySubmit = async () => {
    // 检查是否有内容
    if (
      blocks.length === 0 ||
      (blocks.length === 1 && blocks[0].type === "text" && !blocks[0].content)
    ) {
      return;
    }

    const userName = "c"; // 使用实际用户信息
    try {
      const response = await axios.post("http://localhost:3001/api/replies", {
        thread_id: id,
        content: { blocks },
        created_by: userName,
      });

      console.log("Reply submitted:", response.data);
      setReplies((prevReplies) => [
        ...prevReplies,
        {
          id: response.data.replyId,
          content: { blocks },
          created_by: userName,
          created_at: new Date().toISOString(),
        },
      ]);

      // 清空编辑器
      setBlocks([{ type: "text", content: "" }]);
    } catch (error) {
      console.error("Error submitting reply:", error);
      setError("Failed to submit reply");
    }
  };

  const handleAnnotationSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (selectedReplyId === null || !selectedText) return;

    const text = (event.target as any).elements.textarea?.value;
    if (text) {
      const newAnnotation = {
        replyId: selectedReplyId,
        text,
        selectedText: selectedText.text,
        textStartOffset: selectedText.startOffset,
        textEndOffset: selectedText.endOffset,
      };

      try {
        const response = await axios.post(
          "http://localhost:3001/api/annotations",
          newAnnotation,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        setAnnotations((prevAnnotations) => [
          ...prevAnnotations,
          response.data,
        ]);
        setSelectedText(null);
        setIsSelectingText(false);
      } catch (error) {
        console.error("Error adding annotation:", error);
      }
    }
  };

  const handleReplyClick = (replyId: number) => {
    setSelectedReplyId(replyId);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>{error}</div>;
  }

  if (!annotation) {
    return <div>No annotation found</div>;
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#f5f5dc",
        color: "#000",
        overflowY: "auto", // 确保整个页面可以滑动
      }}
    >
      <div style={{ flex: 1, padding: "20px" }}>
        <h1>Annotation Details</h1>

        {/* 显示批注信息 */}
        <div>
          <strong>Text:</strong>{" "}
          <div
            dangerouslySetInnerHTML={{
              __html: annotation.text,
            }}
          />
        </div>
        <div>
          <strong>Created By:</strong> {annotation.userName}
        </div>

        {/* 如果存在PDF文件和页码，显示跳转链接 */}
        {annotation.pdfFile && annotation.pageNumber && (
          <div>
            <strong>Jump to PDF:</strong>{" "}
            <a
              href={`http://localhost:3002/pdf-viewer?file=${annotation.pdfFile}&page=${annotation.pageNumber}`}
              target="_blank"
            >
              Click to view the annotation in the PDF
            </a>
          </div>
        )}

        <h2>Replies</h2>
        <div>
          {replies.map((reply) => (
            <div
              key={reply.id}
              className="reply-content"
              style={{ 
                marginBottom: "20px", 
                cursor: isSelectingText ? "text" : "pointer",
                backgroundColor: selectedReplyId === reply.id ? "#e3f2fd" : "transparent",
                padding: "10px",
                borderRadius: "4px",
                userSelect: isSelectingText ? "text" : "none"
              }}
              onClick={(e) => {
                if (!isSelectingText) handleReplyClick(reply.id);
              }}
            >
              <div style={{ marginBottom: "10px" }}>
                <strong>{reply.created_by}</strong>
              </div>
              <div>
                {reply.content.blocks.map((block, blockIndex) => (
                  <div 
                    key={blockIndex} 
                    style={{ marginBottom: "10px" }}
                  >
                    {block.type === "text" ? (
                      <div style={{ 
                        lineHeight: "1.6", 
                        whiteSpace: "pre-wrap"
                      }}>
                        {block.content}
                      </div>
                    ) : (
                      block.type === "image" &&
                      block.url && (
                        <img
                          src={
                            block.url.startsWith("http")
                              ? block.url
                              : `http://localhost:3001${block.url}`
                          }
                          alt="回复中的图片"
                          style={{ maxWidth: "300px", height: "auto" }}
                        />
                      )
                    )}
                  </div>
                ))}
              </div>
              <div>{new Date(reply.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <h3>Post a Reply</h3>
        <div style={{ marginBottom: "20px" }}>
          {blocks.map((block, index) => (
            <div key={index} style={{ marginBottom: "10px" }}>
              {block.type === "text" ? (
                <textarea
                  value={block.content || ""}
                  onChange={(e) => {
                    const newBlocks = [...blocks];
                    newBlocks[index] = { ...block, content: e.target.value };
                    setBlocks(newBlocks);
                  }}
                  rows={4}
                  style={{ width: "100%" }}
                  placeholder="输入文字..."
                />
              ) : (
                block.type === "image" &&
                block.url && (
                  <div style={{ position: "relative", maxWidth: "300px" }}>
                    <img
                      src={
                        block.url.startsWith("http")
                          ? block.url
                          : `http://localhost:3001${block.url}`
                      }
                      alt="上传的图片"
                      style={{ width: "100%", height: "auto" }}
                    />
                    <button
                      onClick={() => {
                        const newBlocks = blocks.filter((_, i) => i !== index);
                        setBlocks(newBlocks);
                      }}
                      style={{
                        position: "absolute",
                        top: 5,
                        right: 5,
                        background: "rgba(255, 0, 0, 0.7)",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                )
              )}
            </div>
          ))}

          {/* 图片上传按钮 */}
          <div style={{ marginBottom: "10px" }}>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImageUpload(file);
                }
              }}
              style={{ display: "none" }}
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              style={{
                display: "inline-block",
                padding: "8px 16px",
                backgroundColor: "#4CAF50",
                color: "white",
                cursor: "pointer",
                borderRadius: "4px",
              }}
            >
              插入图片
            </label>
          </div>

          {/* 添加新文本框按钮 */}
          <button
            onClick={() =>
              setBlocks([...blocks, { type: "text", content: "" }])
            }
            style={{
              marginRight: "10px",
              padding: "8px 16px",
              backgroundColor: "#2196F3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            添加文本框
          </button>

          {/* 发送按钮 */}
          <button
            onClick={handleReplySubmit}
            style={{
              padding: "8px 16px",
              backgroundColor: "#FF5722",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            发送回复
          </button>
        </div>
      </div>

      {/* 批注展示区域 */}
      <div
        style={{
          width: "300px",
          height: "100vh",
          overflowY: "auto",
          backgroundColor: "#f0f0f0",
          padding: "10px",
          position: "relative",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {/* 批注工具栏 */}
        <div
          style={{
            marginBottom: "10px",
            display: "flex",
            gap: "10px",
            alignItems: "center"
          }}
        >
          <h3>Annotations for reply {selectedReplyId}</h3>
          {selectedReplyId && (
            <button
              onClick={() => setIsSelectingText(!isSelectingText)}
              style={{
                padding: "4px 8px",
                backgroundColor: isSelectingText ? "#FF5722" : "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px"
              }}
            >
              {isSelectingText ? "取消选择" : "添加批注"}
            </button>
          )}
        </div>

        {/* 批注列表 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <AnnotationViewer
            annotations={annotations}
            replyId={selectedReplyId}
            displayMode="thread"
          />
        </div>

        {/* 批注输入框 */}
        {selectedText && selectedReplyId && (
          <form
            onSubmit={handleAnnotationSubmit}
            style={{
              padding: "10px",
              backgroundColor: "white",
              borderTop: "1px solid #ddd",
              marginTop: "10px"
            }}
          >
            <div style={{ 
              padding: "8px", 
              backgroundColor: "#f5f5f5", 
              borderRadius: "4px",
              marginBottom: "10px",
              fontSize: "14px"
            }}>
              选中文字: {selectedText.text}
            </div>
            <textarea
              name="textarea"
              placeholder="输入批注内容..."
              style={{
                width: "100%",
                height: "60px",
                padding: "8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                resize: "none",
                marginBottom: "10px"
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedText(null);
                  setIsSelectingText(false);
                }}
                style={{
                  flex: 1,
                  padding: "8px",
                  backgroundColor: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                取消
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: "8px",
                  backgroundColor: "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                提交批注
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ThreadPage;
