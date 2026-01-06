const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Get the frontend URL from environment or allow all origins.
// IMPORTANT:
// - In production (Railway), set CLIENT_ORIGIN to your Netlify URL,
//   e.g. https://young-flowers-learning.netlify.app
// - When CLIENT_ORIGIN is "*", we must NOT send credentials because
//   browsers reject Access-Control-Allow-Origin "*" with credentials=true.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const useCredentials = CLIENT_ORIGIN !== "*";

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: useCredentials,
    allowEIO3: true
  },
  // Prioritize polling for better Railway compatibility
  transports: ["polling", "websocket"],
  // Allow connections from any path (Railway proxy might affect this)
  path: "/socket.io/",
  // Increase ping timeout for Railway's proxy
  pingTimeout: 60000,
  pingInterval: 25000
});

let learners = [];
let teachers = [];
let pairs = new Map(); // socket.id -> partner.id

io.on("connection", socket => {
  console.log('Socket connected:', socket.id);
  emitOnlineCount();
  
  socket.on("join", role => {
    console.log(`\n🔵 JOIN EVENT: Socket ${socket.id} joined as ${role}`);
    socket.role = role;
    addToQueue(socket);
    console.log(`📊 Current queues - Learners: ${learners.length}, Teachers: ${teachers.length}`);
    matchUsers();
    emitOnlineCount();
  });

  socket.on("signal", data => {
    socket.to(data.to).emit("signal", {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on("next", () => {
    console.log(`Socket ${socket.id} clicked next, role: ${socket.role}`);
    disconnectPair(socket);
    // Remove from queue first to avoid duplicates
    removeFromQueue(socket);
    // Re-add to queue if role is still set
    if (socket.role) {
      addToQueue(socket);
      matchUsers();
    } else {
      console.warn(`Socket ${socket.id} clicked next but has no role set`);
    }
  });

  socket.on("getOnlineCount", () => {
    // Send online count to requesting client
    const count = io.of("/").sockets.size;
    socket.emit('onlineCount', count);
    console.log(`Sent online count ${count} to ${socket.id}`);
  });

  socket.on("disconnect", () => {
    disconnectPair(socket);
    removeFromQueue(socket);
    emitOnlineCount();
  });

  function addToQueue(socket) {
    // Remove from queue first to avoid duplicates
    removeFromQueue(socket);
    // Then add to appropriate queue
    if (socket.role === "learn") {
      learners.push(socket);
      console.log(`Added learner ${socket.id} to queue. Queue size: ${learners.length}`);
    }
    if (socket.role === "teach") {
      teachers.push(socket);
      console.log(`Added teacher ${socket.id} to queue. Queue size: ${teachers.length}`);
    }
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
    console.log(`Matching: ${learners.length} learners, ${teachers.length} teachers`);
    while (learners.length > 0 && teachers.length > 0) {
      const learner = learners.shift();
      const teacher = teachers.shift();

      // Verify sockets are still connected
      if (!learner.connected || !teacher.connected) {
        console.warn('Skipping match - one or both sockets disconnected');
        if (!learner.connected) removeFromQueue(learner);
        if (!teacher.connected) removeFromQueue(teacher);
        continue;
      }

      pairs.set(learner.id, teacher.id);
      pairs.set(teacher.id, learner.id);

      console.log(`✅ Matched learner ${learner.id} with teacher ${teacher.id}`);
      learner.emit("matched", teacher.id);
      teacher.emit("matched", learner.id);
    }
    console.log(`After matching: ${learners.length} learners, ${teachers.length} teachers remaining`);
    emitOnlineCount();
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

// Debug endpoint to check queue status
app.get('/debug/queues', (req, res) => {
  res.status(200).json({
    learners: learners.length,
    teachers: teachers.length,
    totalConnected: io.of("/").sockets.size,
    learnerIds: learners.map(s => s.id),
    teacherIds: teachers.map(s => s.id),
    pairs: Array.from(pairs.entries())
  });
});

const PORT = process.env.PORT || 3000;
// Bind to 0.0.0.0 to accept connections from Railway's proxy
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CLIENT_ORIGIN=${CLIENT_ORIGIN}`);
  console.log(`Server bound to 0.0.0.0:${PORT}`);
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
