import { useRouter } from "next/router";
import { useState, useEffect } from "react";

const CreatePost = () => {
  const router = useRouter();
  const { annotationId } = router.query;
  const [annotationContent, setAnnotationContent] = useState("");
  const [postContent, setPostContent] = useState("");

  useEffect(() => {
    // 从后端获取批注内容
    if (annotationId) {
      fetch(`/api/annotations/${annotationId}`)
        .then((res) => res.json())
        .then((data) => setAnnotationContent(data.content));
    }
  }, [annotationId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const response = await fetch("/api/threads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        annotation_id: annotationId,
        userName: "currentUser", // 替换为当前登录用户
        content: postContent,
      }),
    });

    const data = await response.json();
    router.push(`/post-details?id=${data.id}`);
  };

  return (
    <div>
      <h1>创建帖子</h1>
      <p>引用的批注内容: {annotationContent}</p>
      <form onSubmit={handleSubmit}>
        <textarea
          value={postContent}
          onChange={(e) => setPostContent(e.target.value)}
          placeholder="输入帖子内容"
          required
        />
        <button type="submit">提交</button>
      </form>
    </div>
  );
};

export default CreatePost;
