const socket = io("https://young-flowers-learning-backend.up.railway.app");

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

async function join(selectedRole) {
  role = selectedRole;
  landing.hidden = true;
  room.hidden = false;

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

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

// Online user count
socket.on("connect", () => updateOnline());
socket.on("disconnect", () => updateOnline());
function updateOnline() {
  onlineCount.textContent = `Online users: ${Object.keys(socket.io.engine.clients).length}`;
}

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
