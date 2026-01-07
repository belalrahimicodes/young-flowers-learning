/****************************************************
 * CONFIG
 ****************************************************/
const SOCKET_URL =
  (typeof window !== "undefined" && window.BACKEND_URL) ||
  "https://young-flowers-learning-production.up.railway.app";

console.log("🚀 CLEAN WEBRTC VERSION LOADED");

/****************************************************
 * SOCKET.IO
 ****************************************************/
const socket = window.io(SOCKET_URL, {
  transports: ["polling"],
  upgrade: false,
  forceNew: true
});

let socketReady = false;

socket.on("connect", () => {
  socketReady = true;
  console.log("✅ Socket connected:", socket.id);
  socket.emit("getOnlineCount");
});

socket.on("onlineCount", n => {
  document.getElementById("onlineCount").textContent = `Online users: ${n}`;
});

/****************************************************
 * GLOBAL STATE
 ****************************************************/
let localStream = null;
let peer = null;
let dataChannel = null;
let partnerId = null;
let role = null;
let isCaller = false;
let connectionVersion = 0;

/****************************************************
 * DOM
 ****************************************************/
const landing = document.getElementById("landing");
const room = document.getElementById("room");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const messages = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

/****************************************************
 * JOIN
 ****************************************************/
async function join(selectedRole) {
  role = selectedRole;

  landing.hidden = true;
  room.hidden = false;

  messages.innerHTML = `<div>Waiting for match...</div>`;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (e) {
    console.warn("Media denied:", e);
  }

  socket.emit("join", role);
}

/****************************************************
 * CLEANUP
 ****************************************************/
function cleanupConnection() {
  connectionVersion++;

  if (peer) {
    peer.onicecandidate = null;
    peer.ontrack = null;
    peer.ondatachannel = null;
    peer.close();
  }

  peer = null;
  dataChannel = null;
  partnerId = null;
  remoteVideo.srcObject = null;
}

/****************************************************
 * MATCHED
 ****************************************************/
socket.on("matched", id => {
  cleanupConnection();

  partnerId = id;
  isCaller = socket.id.localeCompare(id) < 0;

  console.log("🎉 Matched with", id, "Caller:", isCaller);

  createPeer(isCaller);
});

/****************************************************
 * SIGNAL HANDLING (CORRECT STATES ONLY)
 ****************************************************/
socket.on("signal", async ({ from, signal }) => {
  if (!peer || from !== partnerId) return;
  if (peer._version !== connectionVersion) return;

  try {
    /* OFFER */
    if (signal.type === "offer") {
      if (peer.signalingState !== "stable") {
        console.warn("❌ Offer dropped, state:", peer.signalingState);
        return;
      }

      await peer.setRemoteDescription(signal);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("signal", { to: from, signal: answer });
    }

    /* ANSWER */
    if (signal.type === "answer") {
      if (!isCaller) return;

      if (peer.signalingState !== "have-local-offer") {
        console.warn("❌ Answer dropped, state:", peer.signalingState);
        return;
      }

      await peer.setRemoteDescription(signal);
    }

    /* ICE */
    if (signal.candidate) {
      if (peer.remoteDescription) {
        await peer.addIceCandidate(signal);
      } else {
        peer._pendingICE.push(signal);
      }
    }
  } catch (err) {
    console.error("❌ Signal error:", err);
  }
});

/****************************************************
 * PEER CONNECTION
 ****************************************************/
function createPeer(caller) {
  peer = new RTCPeerConnection({
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require"
  });

  peer._version = connectionVersion;
  peer._pendingICE = [];

  if (localStream) {
    localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
  }

  peer.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { to: partnerId, signal: e.candidate });
    }
  };

  peer.onconnectionstatechange = () => {
    console.log("🔗 Peer state:", peer.connectionState);
  };

  if (caller) {
    dataChannel = peer.createDataChannel("chat");
    setupDataChannel();

    peer.createOffer()
      .then(o => peer.setLocalDescription(o))
      .then(() => {
        socket.emit("signal", {
          to: partnerId,
          signal: peer.localDescription
        });
      });
  } else {
    peer.ondatachannel = e => {
      dataChannel = e.channel;
      setupDataChannel();
    };
  }
}

/****************************************************
 * CHAT
 ****************************************************/
function setupDataChannel() {
  dataChannel.onmessage = e => {
    messages.innerHTML += `<div>Partner: ${e.data}</div>`;
  };
}

sendBtn.onclick = () => {
  if (!dataChannel) return;
  const msg = chatInput.value.trim();
  if (!msg) return;
  dataChannel.send(msg);
  messages.innerHTML += `<div>You: ${msg}</div>`;
  chatInput.value = "";
};

/****************************************************
 * NEXT
 ****************************************************/
function nextUser() {
  cleanupConnection();
  socket.emit("next");
}
