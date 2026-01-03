const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let learners = [];
let teachers = [];
let pairs = new Map(); // socket.id -> partner.id

io.on("connection", socket => {

  socket.on("join", role => {
    socket.role = role;
    addToQueue(socket);
    matchUsers();
  });

  socket.on("signal", data => {
    socket.to(data.to).emit("signal", {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on("next", () => {
    disconnectPair(socket);
    addToQueue(socket);
    matchUsers();
  });

  socket.on("disconnect", () => {
    disconnectPair(socket);
    removeFromQueue(socket);
  });

  function addToQueue(socket) {
    if (socket.role === "learn") learners.push(socket);
    if (socket.role === "teach") teachers.push(socket);
  }

  function removeFromQueue(socket) {
    learners = learners.filter(s => s.id !== socket.id);
    teachers = teachers.filter(s => s.id !== socket.id);
  }

  function disconnectPair(socket) {
    const partnerId = pairs.get(socket.id);
    if (partnerId) {
      socket.to(partnerId).emit("partner-left");
      pairs.delete(partnerId);
      pairs.delete(socket.id);
    }
  }

  function matchUsers() {
    while (learners.length > 0 && teachers.length > 0) {
      const learner = learners.shift();
      const teacher = teachers.shift();

      pairs.set(learner.id, teacher.id);
      pairs.set(teacher.id, learner.id);

      learner.emit("matched", teacher.id);
      teacher.emit("matched", learner.id);
    }
  }
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
