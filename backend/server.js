const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

let learners = [];
let teachers = [];
let pairs = new Map(); // socket.id -> partner.id

io.on("connection", socket => {
  console.log('Socket connected:', socket.id);
  emitOnlineCount();
  socket.on("join", role => {
    socket.role = role;
    console.log(`Socket ${socket.id} joined as ${role}`);
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
    emitOnlineCount();
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

      console.log(`Matched learner ${learner.id} with teacher ${teacher.id}`);
      learner.emit("matched", teacher.id);
      teacher.emit("matched", learner.id);
    }
  }
});

function emitOnlineCount() {
  try {
    const count = io.of("/").sockets.size;
    io.emit('onlineCount', count);
    console.log('Online count:', count);
  } catch (e) {
    console.error('Failed to emit onlineCount', e);
  }
}

// Health check for platform
// Basic root route (some platforms probe `/`)
app.get('/', (req, res) => {
  res.send('OK');
});

// Health check for platform
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CLIENT_ORIGIN=${CLIENT_ORIGIN}`);
});

// Log server errors and platform signals to help diagnose SIGTERM
server.on('error', err => {
  console.error('Server error:', err);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

process.on('SIGTERM', () => {
  console.warn('SIGTERM received — shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
  // force exit after 10s
  setTimeout(() => process.exit(1), 10000).unref();
});

process.on('SIGINT', () => {
  console.warn('SIGINT received — exiting');
  process.exit(0);
});
