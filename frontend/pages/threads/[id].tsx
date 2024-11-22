import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";

interface Annotation {
  id: number;
  pdfFile: string;
  pageNumber: number;
  text: string;
  userName: string;
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

  const handleReplySubmit = async () => {
    if (!newReply) return;

    const userName = "Current User"; // 使用实际用户信息
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
    <div style={{ padding: "20px" }}>
      <h1>Annotation Details</h1>
      <div>
        <strong>PDF File:</strong> {annotation.pdfFile}
      </div>
      <div>
        <strong>Page Number:</strong> {annotation.pageNumber}
      </div>
      <div>
        <strong>Text:</strong>{" "}
        <div
          dangerouslySetInnerHTML={{
            __html: annotation.text, // 直接渲染批注文本
          }}
        />
      </div>
      <div>
        <strong>Created By:</strong> {annotation.userName}
      </div>

      <h2>Replies</h2>
      <div>
        {replies.map((reply) => (
          <div key={reply.id} style={{ marginBottom: "20px" }}>
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
  );
};

export default ThreadPage;
