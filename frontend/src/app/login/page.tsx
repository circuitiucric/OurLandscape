//登陆注册页面
"use client";

import React, { useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";

const Home: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  //点击注册按钮时，前端将用户名和密码发送到后端的 /register 端点
  const register = async () => {
    try {
      const response = await axios.post("http://localhost:3001/register", {
        userName: username,
        passWord: password,
      });
      setMessage(response.data.msg);
    } catch (error) {
      console.error(error);
      setMessage("注册失败");
    }
  };

  //点击登录按钮时，前端将用户名和密码发送到后端的 /login 端点
  const login = async () => {
    try {
      const response = await axios.post("http://localhost:3001/login", {
        userName: username,
        passWord: password,
      });
      setMessage(response.data.msg);
      if (response.data.code === 1) {
        router.push("/select-pdf");
      }
    } catch (error) {
      console.error(error);
      setMessage("登录失败");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-60 bg-custom-bg bg-cover bg-center">
      <h1>测试注册和登录</h1>
      <h1></h1>
      <input
        type="text"
        placeholder="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="mb-4 p-2 border border-gray-300 rounded text-black"
      />
      <input
        type="password"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mb-4 p-2 border border-gray-300 rounded text-black"
      />
      <div className="flex space-x-11">
        <button
          onClick={register}
          className="px-8 py-2 bg-blue-500 text-white rounded"
        >
          注册
        </button>
        <button
          onClick={login}
          className="px-8 py-2 bg-green-500 text-white rounded"
        >
          登录
        </button>
      </div>
      <p className="mt-0">{message}</p>
    </main>
  );
};

export default Home;
