// Read backend socket URL from global variable set in HTML
// Falls back to the production Railway URL if not set.
const SOCKET_URL =
  (typeof window !== "undefined" && window.BACKEND_URL) ||
  "https://young-flowers-learning-production.up.railway.app";

// Version check - if you see this, the new script is loaded
console.log('🚀🚀🚀 NEW VERSION LOADED - v20241220-001 🚀🚀🚀');
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
let isCaller = false; // Track if we're the caller
let isProcessingMatch = false; // Prevent duplicate match processing

const landing = document.getElementById("landing");
const room = document.getElementById("room");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const messages = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const onlineCount = document.getElementById("onlineCount");
const statusEl = document.getElementById("status");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");

// Online user count listener (set up before connection)
socket.on('onlineCount', n => {
  onlineCount.textContent = `Online users: ${n}`;
  console.log('Updated online count:', n);
});

async function join(selectedRole) {
  role = selectedRole;
  console.log('🔵 Joining as:', role);
  
  if (statusEl) {
    statusEl.textContent = `Joining as ${role === 'learn' ? 'Learner' : 'Teacher'}...`;
    statusEl.style.color = '#666';
  }
  
  landing.hidden = true;
  room.hidden = false;

  // Show waiting message
  if (messages) {
    messages.innerHTML = `<div style="text-align: center; padding: 20px; color: #666;">Waiting for a match...</div>`;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('getUserMedia failed:', err);
    // allow joining without media
  }

  console.log('📤 Emitting join event with role:', role);
  socket.emit("join", role);
  
  if (statusEl) {
    statusEl.textContent = `Waiting for a ${role === 'learn' ? 'Teacher' : 'Learner'}...`;
    statusEl.style.color = '#ff9800';
  }
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
  console.log('Next button clicked, current role:', role);
  cleanupConnection();
  socket.emit("next");
  console.log('Next request sent to server');
}

// Cleanup connection
function cleanupConnection() {
  if (peer) peer.close();
  peer = null;
  dataChannel = null;
  partnerId = null;
  isCaller = false;
  isProcessingMatch = false;
  remoteVideo.srcObject = null;
  if (messages) messages.innerHTML = "";
}

// Socket events
socket.on("matched", id => {
  // Prevent processing the same match multiple times
  if (isProcessingMatch && partnerId === id) {
    console.log('⚠️ Ignoring duplicate match event for same partner:', id);
    return;
  }
  
  console.log('🎉🎉🎉 MATCHED EVENT RECEIVED! Partner ID:', id);
  console.log('Current role:', role);
  console.log('Local stream available:', !!localStream);
  
  // Clean up any existing connection first
  if (peer) {
    console.log('🧹 Cleaning up existing peer connection');
    cleanupConnection();
  }
  
  isProcessingMatch = true;
  partnerId = id;
  room.hidden = false; // stay visible
  
  if (statusEl) {
    statusEl.textContent = `✅ Matched!`;
    statusEl.style.color = '#4caf50';
  }
  
  if (messages) {
    messages.innerHTML = `<div style="text-align: center; padding: 20px; color: green;">✅ Matched! Connecting...</div>`;
  }
  
  // Determine who should be the caller based on socket ID (lower ID is caller)
  // This ensures only one side creates the offer
  isCaller = socket.id < id;
  console.log('Will be caller:', isCaller, '(socket.id:', socket.id, 'vs partner:', id, ')');
  
  try {
    createPeer(isCaller);
    console.log('✅ createPeer called successfully');
  } catch (error) {
    console.error('❌ Error in createPeer:', error);
    isProcessingMatch = false;
    if (messages) {
      messages.innerHTML += `<div style="color: red;">Error connecting: ${error.message}</div>`;
    }
  }
});

socket.on("signal", async data => {
  console.log('📨 Signal received:', data.signal.type || 'ICE candidate', 'from:', data.from);
  console.log('Current partner ID:', partnerId);
  console.log('Current peer state:', peer ? peer.signalingState : 'no peer');
  
  // Only process signals from our current partner
  if (partnerId && data.from !== partnerId) {
    console.warn('⚠️ Ignoring signal from non-partner:', data.from, '(expected:', partnerId, ')');
    return;
  }
  
  // If we don't have a peer yet and this is an offer, create one as receiver
  if (!peer && data.signal.type === "offer") {
    console.log('📥 No peer exists, creating one (receiver)');
    if (!partnerId) {
      partnerId = data.from; // Set partner ID from offer
    }
    createPeer(false);
  }
  
  // If still no peer, something is wrong
  if (!peer) {
    console.error('❌ No peer connection available to process signal');
    return;
  }

  try {
    if (data.signal.type === "offer") {
      console.log('📥 Processing offer from:', data.from);
      console.log('Current signaling state:', peer.signalingState);
      
      // Only process offer if we're in stable state (haven't set local description yet)
      if (peer.signalingState !== 'stable') {
        console.warn('⚠️ Cannot process offer - not in stable state:', peer.signalingState);
        return;
      }
      
      await peer.setRemoteDescription(data.signal);
      console.log('📥 Remote description set, creating answer');
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      console.log('📤 Sending answer to:', data.from);
      socket.emit("signal", { to: data.from, signal: answer });
    }

    if (data.signal.type === "answer") {
      console.log('📥 Processing answer from:', data.from);
      console.log('Current signaling state:', peer.signalingState);
      console.log('We are caller:', isCaller);
      
      // Only process answer if we're the caller and in have-local-offer state
      if (!isCaller) {
        console.warn('⚠️ Received answer but we are not the caller - ignoring');
        return;
      }
      
      if (peer.signalingState !== 'have-local-offer') {
        console.warn('⚠️ Cannot process answer - wrong state:', peer.signalingState, '(expected: have-local-offer)');
        return;
      }
      
      await peer.setRemoteDescription(data.signal);
      console.log('✅ Answer processed successfully');
      isProcessingMatch = false; // Match processing complete
    }

    if (data.signal.candidate) {
      console.log('🧊 Adding ICE candidate from:', data.from);
      // Only add candidates if remote description is set
      if (peer.remoteDescription) {
        await peer.addIceCandidate(data.signal);
      } else {
        console.log('⏳ Queueing ICE candidate (waiting for remote description)');
        // Queue the candidate to add later
        if (!peer.pendingCandidates) peer.pendingCandidates = [];
        peer.pendingCandidates.push(data.signal);
      }
    }
  } catch (error) {
    console.error('❌ Error processing signal:', error);
    console.error('Peer state was:', peer.signalingState);
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

// Debug: Log all socket events
const originalEmit = socket.emit;
socket.emit = function(...args) {
  console.log('📤 Emitting:', args[0], args.slice(1));
  return originalEmit.apply(this, args);
};

// Log all received events
socket.onAny((eventName, ...args) => {
  console.log('📥 Received event:', eventName, args);
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
  console.log('🔵 createPeer called, isCaller:', isCaller);
  console.log('Local stream:', localStream ? 'available' : 'NOT available');
  
  if (!localStream) {
    console.warn('⚠️ No local stream available, creating peer without tracks');
  }
  
  peer = new RTCPeerConnection();

  // Only add tracks if localStream exists
  if (localStream && localStream.getTracks) {
    localStream.getTracks().forEach(track => {
      console.log('Adding track:', track.kind, track.enabled);
      peer.addTrack(track, localStream);
    });
  } else {
    console.warn('⚠️ Cannot add tracks - localStream is not available');
  }

  peer.ontrack = e => {
    console.log('📹 Remote track received:', e.track.kind);
    remoteVideo.srcObject = e.streams[0];
  };

  peer.onicecandidate = e => {
    if (e.candidate) {
      console.log('🧊 ICE candidate generated, sending to:', partnerId);
      socket.emit("signal", { to: partnerId, signal: e.candidate });
    } else {
      console.log('🧊 ICE candidate gathering complete');
      // Add any pending candidates now that remote description is set
      if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
        console.log('📥 Processing', peer.pendingCandidates.length, 'pending ICE candidates');
        peer.pendingCandidates.forEach(candidate => {
          peer.addIceCandidate(candidate).catch(err => {
            console.error('Error adding pending candidate:', err);
          });
        });
        peer.pendingCandidates = [];
      }
    }
  };

  if (isCaller) {
    console.log('📞 Creating data channel and offer (caller)');
    dataChannel = peer.createDataChannel("chat");
    setupDataChannel();

    peer.createOffer().then(offer => {
      console.log('📤 Offer created, setting local description');
      return peer.setLocalDescription(offer);
    }).then(() => {
      console.log('📤 Sending offer to partner:', partnerId);
      socket.emit("signal", { to: partnerId, signal: peer.localDescription });
    }).catch(error => {
      console.error('❌ Error creating/sending offer:', error);
    });
  } else {
    console.log('📥 Waiting for data channel and offer (receiver)');
    peer.ondatachannel = e => {
      console.log('📥 Data channel received');
      dataChannel = e.channel;
      setupDataChannel();
    };
  }
  
  // Add error handlers
  peer.onerror = (error) => {
    console.error('❌ RTCPeerConnection error:', error);
  };
  
  peer.onconnectionstatechange = () => {
    console.log('🔵 Peer connection state:', peer.connectionState);
  };
}

function setupDataChannel() {
  dataChannel.onmessage = e => {
    messages.innerHTML += `<div>Partner: ${e.data}</div>`;
    messages.scrollTop = messages.scrollHeight;
  };
}
