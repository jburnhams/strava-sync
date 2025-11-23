import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";
import Setup from "./Setup";
import UserDetail from "./UserDetail";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/user/:id" element={<UserDetail />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
