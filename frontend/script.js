// Read backend socket URL from global variable set in HTML
// Falls back to the production Railway URL if not set.
const SOCKET_URL =
  (typeof window !== "undefined" && window.BACKEND_URL) ||
  "https://exquisite-victory-production-1e5e.up.railway.app";

// Version check - if you see this, the new script is loaded
console.log('=== Socket.IO Connection Debug v2 ===');
console.log('SOCKET_URL:', SOCKET_URL);
console.log('window.io:', typeof window.io);

// Test backend connectivity first
async function testBackendConnectivity() {
  try {
    const healthUrl = SOCKET_URL.replace(/\/socket\.io\/?$/, '') + '/health';
    console.log('Testing backend connectivity:', healthUrl);
    const response = await fetch(healthUrl);
    const data = await response.text();
    console.log('✅ Backend is reachable:', response.status, data);
    return true;
  } catch (error) {
    console.error('❌ Backend connectivity test failed:', error);
    return false;
  }
}

// Run connectivity test
testBackendConnectivity();

// Explicitly prevent WebSocket attempts
const socketOptions = {
  // CRITICAL: Force polling ONLY, no WebSocket attempts
  transports: ["polling"],
  upgrade: false,
  allowUpgrades: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  // Add query parameter to help with debugging
  query: { transport: 'polling', v: '2' },
  // Force new connection
  forceNew: true
};

console.log('Socket options:', JSON.stringify(socketOptions, null, 2));

const socket = window.io(SOCKET_URL, socketOptions);

console.log('Socket created with ID:', socket.id);
console.log('Socket URL:', socket.io.uri);

// Monitor transport changes
socket.io.on("transport", (transport) => {
  console.log('🔵 Transport changed to:', transport.name);
  if (transport.name === 'websocket') {
    console.error('❌ ERROR: WebSocket transport detected! This should not happen.');
  }
});

socket.io.on("open", () => {
  console.log('✅ Socket.IO connection opened');
  console.log('Current transport:', socket.io.engine?.transport?.name);
});

let localStream;
let peer;
let dataChannel;
let partnerId;
let role;
let isMuted = false;
let cameraOff = false;

const landing = document.getElementById("landing");
const room = document.getElementById("room");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const messages = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const onlineCount = document.getElementById("onlineCount");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");

// Online user count listener (set up before connection)
socket.on('onlineCount', n => {
  onlineCount.textContent = `Online users: ${n}`;
  console.log('Updated online count:', n);
});

async function join(selectedRole) {
  role = selectedRole;
  landing.hidden = true;
  room.hidden = false;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('getUserMedia failed:', err);
    // allow joining without media
  }

  socket.emit("join", role);
}

// Chat sending
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg || !dataChannel) return;
  dataChannel.send(msg);
  messages.innerHTML += `<div>You: ${msg}</div>`;
  chatInput.value = "";
  messages.scrollTop = messages.scrollHeight;
}

// Toggle microphone
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks()[0].enabled = !isMuted;
  muteBtn.textContent = isMuted ? "Unmute" : "Mute";
}

// Toggle camera
function toggleCamera() {
  if (!localStream) return;
  cameraOff = !cameraOff;
  localStream.getVideoTracks()[0].enabled = !cameraOff;
  cameraBtn.textContent = cameraOff ? "Camera On" : "Camera Off";
}

// Next button
function nextUser() {
  cleanupConnection();
  socket.emit("next");
}

// Cleanup connection
function cleanupConnection() {
  if (peer) peer.close();
  peer = null;
  dataChannel = null;
  partnerId = null;
  remoteVideo.srcObject = null;
  messages.innerHTML = "";
}

// Socket events
socket.on("matched", id => {
  console.log('matched with', id);
  partnerId = id;
  room.hidden = false; // stay visible
  createPeer(true);
});

socket.on("signal", async data => {
  if (!peer) createPeer(false);

  if (data.signal.type === "offer") {
    await peer.setRemoteDescription(data.signal);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("signal", { to: data.from, signal: answer });
  }

  if (data.signal.type === "answer") {
    await peer.setRemoteDescription(data.signal);
  }

  if (data.signal.candidate) {
    await peer.addIceCandidate(data.signal);
  }
});

socket.on("partner-left", () => {
  cleanupConnection();
  socket.emit("join", role);
});

socket.on('connect', () => {
  console.log('✅ Socket connected successfully!', socket.id);
  console.log('Connected to:', socket.io.uri);
  // Request initial online count from server
  socket.emit('getOnlineCount');
});

socket.on('disconnect', (reason) => {
  console.log('⚠️ Socket disconnected:', reason);
});

socket.on('reconnect', () => {
  console.log('✅ Socket reconnected');
});

socket.on('reconnect_error', (error) => {
  console.error('❌ Socket reconnect error:', error);
});

socket.on('connect_error', (error) => {
  console.error('❌ Socket connection error:', error);
  console.error('Attempted to connect to:', SOCKET_URL);
});

// WebRTC
function createPeer(isCaller) {
  peer = new RTCPeerConnection();

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.ontrack = e => remoteVideo.srcObject = e.streams[0];

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { to: partnerId, signal: e.candidate });
    }
  };

  if (isCaller) {
    dataChannel = peer.createDataChannel("chat");
    setupDataChannel();

    peer.createOffer().then(offer => {
      peer.setLocalDescription(offer);
      socket.emit("signal", { to: partnerId, signal: offer });
    });
  } else {
    peer.ondatachannel = e => {
      dataChannel = e.channel;
      setupDataChannel();
    };
  }
}

function setupDataChannel() {
  dataChannel.onmessage = e => {
    messages.innerHTML += `<div>Partner: ${e.data}</div>`;
    messages.scrollTop = messages.scrollHeight;
  };
}
