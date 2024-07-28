"use client";

import { useParams } from "next/navigation"; // 使用 next/navigation 中的 useParams 钩子
import { useState, useEffect } from "react";

interface Post {
  id: number;
  content: string;
}

interface Reply {
  id: number;
  content: string;
}

const PostDetails = () => {
  const params = useParams();
  const id = params?.id as string; // 从 useParams 获取帖子ID，并进行类型断言
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyContent, setReplyContent] = useState("");

  useEffect(() => {
    if (id) {
      // 从后端获取帖子内容
      fetch(`/api/threads/${id}`)
        .then((res) => res.json())
        .then((data) => setPost(data));

      // 从后端获取回复列表
      fetch(`/api/threads/${id}/replies`)
        .then((res) => res.json())
        .then((data) => setReplies(data));
    }
  }, [id]);

  const handleReplySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch("/api/replies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: id,
        userName: "currentUser", // 替换为当前登录用户
        content: replyContent,
      }),
    });

    const newReply = await response.json();
    setReplies([...replies, newReply]);
    setReplyContent("");
  };

  if (!post) {
    return <div>加载中...</div>;
  }

  return (
    <div>
      <h1>帖子详情</h1>
      <p>{post.content}</p>
      <div>
        <h2>回复</h2>
        {replies.map((reply) => (
          <div key={reply.id}>
            <p>{reply.content}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleReplySubmit}>
        <textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          placeholder="输入回复内容"
          required
        />
        <button type="submit">提交回复</button>
      </form>
    </div>
  );
};

export default PostDetails;
