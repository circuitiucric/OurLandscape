// frontend/pages/home.js
import React, { useState } from "react";
import axios from "axios";

const Home = () => {
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
    <div>
      <h1>测试注册和登录</h1>
      <input
        type="text"
        placeholder="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={register}>注册</button>
      <button onClick={login}>登录</button>
      <p>{message}</p>
    </div>
  );
};

export default Home;
