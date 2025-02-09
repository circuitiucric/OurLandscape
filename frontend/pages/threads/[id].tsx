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

interface Reply {
  id: number;
  content: string;
  created_by: string;
  created_at: string;
}

const ThreadPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [newReply, setNewReply] = useState("");
  const [selectedReplyId, setSelectedReplyId] = useState<number | null>(null); // 当前选中的回复
  const [annotations, setAnnotations] = useState<Annotation[]>([]); // 存储批注
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取线程和回复数据
  useEffect(() => {
    if (id) {
      console.log("Fetching thread for id:", id); // 打印 ID，确保它正确
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

  const handleReplySubmit = async () => {
    if (!newReply) return;

    const userName = "c"; // 使用实际用户信息
    try {
      const response = await axios.post("http://localhost:3001/api/replies", {
        thread_id: id,
        content: newReply,
        created_by: userName,
      });
      console.log("Reply submitted:", response.data);
      setReplies((prevReplies) => [
        ...prevReplies,
        {
          id: response.data.replyId,
          content: newReply,
          created_by: userName,
          created_at: new Date().toISOString(),
        },
      ]);
      setNewReply(""); // 清空输入框
    } catch (error) {
      console.error("Error submitting reply:", error);
      setError("Failed to submit reply");
    }
  };

  const handleAnnotationSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (selectedReplyId === null) return;

    const text = (event.target as any).elements.textarea?.value;
    if (text) {
      const newAnnotation = { replyId: selectedReplyId, text };
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
              __html: annotation.text, // 渲染批注文本
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
              style={{ marginBottom: "20px", cursor: "pointer" }}
              onClick={() => handleReplyClick(reply.id)}
            >
              <div>
                <strong>{reply.created_by}</strong>
              </div>
              <div
                dangerouslySetInnerHTML={{
                  __html: reply.content, // 渲染从数据库获取的回复
                }}
              />
              <div>{new Date(reply.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <h3>Post a Reply</h3>
        <textarea
          value={newReply}
          onChange={(e) => setNewReply(e.target.value)}
          rows={4}
          style={{ width: "100%" }}
        />
        <button onClick={handleReplySubmit} style={{ marginTop: "10px" }}>
          Submit Reply
        </button>
      </div>

      {/* 批注展示区域 */}
      <div
        style={{
          width: "300px",
          height: "100vh",
          overflowY: "auto", // 让批注区域可滚动
          backgroundColor: "#f0f0f0",
          padding: "10px",
        }}
      >
        <h3>Annotations for reply {selectedReplyId}</h3>
        <AnnotationViewer annotations={annotations} replyId={selectedReplyId} />

        {/* 批注输入框 */}
        <form
          onSubmit={handleAnnotationSubmit}
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            width: "280px",
          }}
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
    </div>
  );
};

export default ThreadPage;
