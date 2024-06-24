"use client";

import React, { useState } from "react";
import axios from "axios";

const Home: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

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

  const login = async () => {
    try {
      const response = await axios.post("http://localhost:3001/login", {
        username: username,
        password: password,
      });
      setMessage(response.data.message);
    } catch (error) {
      console.error(error);
      setMessage("登录失败");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <h1>测试注册和登录</h1>
      <input
        type="text"
        placeholder="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="mb-4 p-2 border border-gray-300 rounded"
      />
      <input
        type="password"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mb-4 p-2 border border-gray-300 rounded"
      />
      <div className="flex space-x-4">
        <button
          onClick={register}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          注册
        </button>
        <button
          onClick={login}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          登录
        </button>
      </div>
      <p className="mt-4">{message}</p>
    </main>
  );
};

export default Home;
