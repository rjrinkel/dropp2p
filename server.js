const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

// Resolve Local Network IPv4 addresses
function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and not loopback/internal
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const primaryNetworkIp = getNetworkAddresses()[0] || '127.0.0.1';

// Middleware & Static files
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Server & Network Info Endpoint
app.get('/api/info', (req, res) => {
  const addresses = getNetworkAddresses();
  res.json({
    port: PORT,
    primaryIp: addresses[0] || '127.0.0.1',
    allIps: addresses,
    localUrl: `http://localhost:${PORT}`,
    networkUrl: `http://${addresses[0] || '127.0.0.1'}:${PORT}`
  });
});

// Dynamic QR Code generation endpoint
app.get('/api/qr', async (req, res) => {
  try {
    const text = req.query.text || `http://${primaryNetworkIp}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(text, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.json({ qrDataUrl, text });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code', details: err.message });
  }
});

// -------------------------------------------------------------
// WebSocket Signaling & Peer Management
// -------------------------------------------------------------
// peers: Map<peerId, { id, name, deviceType, room, ws, remoteAddress }>
const peers = new Map();

// Helper to broadcast to room peers
function broadcastToRoom(room, messageObj, excludePeerId = null) {
  const json = JSON.stringify(messageObj);
  for (const [id, peer] of peers.entries()) {
    if (peer.room === room && id !== excludePeerId) {
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(json);
      }
    }
  }
}

// Generate friendly 6-char alphanumeric room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude ambiguous characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

wss.on('connection', (ws, req) => {
  let currentPeerId = null;
  const remoteIp = req.socket.remoteAddress;

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case 'join': {
          const { peerId, name, deviceType, roomCode } = msg;
          currentPeerId = peerId;
          const room = (roomCode && roomCode.trim().length > 0)
            ? roomCode.trim().toUpperCase()
            : 'LOCAL';

          const peerData = {
            id: peerId,
            name: name || 'Anonymous Peer',
            deviceType: deviceType || 'desktop',
            room,
            ws,
            remoteAddress: remoteIp,
            joinedAt: Date.now()
          };

          peers.set(peerId, peerData);

          // Get list of existing peers in the same room
          const existingPeers = [];
          for (const [id, p] of peers.entries()) {
            if (p.room === room && id !== peerId && p.ws.readyState === WebSocket.OPEN) {
              existingPeers.push({
                id: p.id,
                name: p.name,
                deviceType: p.deviceType,
                room: p.room
              });
            }
          }

          // Send welcome message to newly connected peer
          ws.send(JSON.stringify({
            type: 'welcome',
            peerId,
            room,
            localIp: primaryNetworkIp,
            port: PORT,
            peers: existingPeers
          }));

          // Notify other peers in this room
          broadcastToRoom(room, {
            type: 'peer-joined',
            peer: {
              id: peerData.id,
              name: peerData.name,
              deviceType: peerData.deviceType,
              room: peerData.room
            }
          }, peerId);

          console.log(`[Join] Peer ${peerId} ("${peerData.name}", ${peerData.deviceType}) joined room "${room}"`);
          break;
        }

        case 'switch-room': {
          if (!currentPeerId || !peers.has(currentPeerId)) return;
          const peer = peers.get(currentPeerId);
          const oldRoom = peer.room;
          const newRoom = (msg.roomCode && msg.roomCode.trim().length > 0)
            ? msg.roomCode.trim().toUpperCase()
            : 'LOCAL';

          if (oldRoom === newRoom) return;

          // Notify old room that this peer left
          broadcastToRoom(oldRoom, {
            type: 'peer-left',
            peerId: currentPeerId
          }, currentPeerId);

          peer.room = newRoom;

          // Collect peers in new room
          const newRoomPeers = [];
          for (const [id, p] of peers.entries()) {
            if (p.room === newRoom && id !== currentPeerId && p.ws.readyState === WebSocket.OPEN) {
              newRoomPeers.push({
                id: p.id,
                name: p.name,
                deviceType: p.deviceType,
                room: p.room
              });
            }
          }

          ws.send(JSON.stringify({
            type: 'room-switched',
            room: newRoom,
            peers: newRoomPeers
          }));

          // Notify peers in new room
          broadcastToRoom(newRoom, {
            type: 'peer-joined',
            peer: {
              id: peer.id,
              name: peer.name,
              deviceType: peer.deviceType,
              room: peer.room
            }
          }, currentPeerId);

          console.log(`[Switch] Peer ${currentPeerId} switched from "${oldRoom}" to "${newRoom}"`);
          break;
        }

        case 'signal': {
          const { targetPeerId, signalData } = msg;
          if (!targetPeerId) return;

          const target = peers.get(targetPeerId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'signal',
              senderPeerId: currentPeerId,
              signalData
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'signal-error',
              targetPeerId,
              message: 'Target peer is unavailable or disconnected'
            }));
          }
          break;
        }

        case 'leave': {
          if (currentPeerId && peers.has(currentPeerId)) {
            const peer = peers.get(currentPeerId);
            peers.delete(currentPeerId);
            broadcastToRoom(peer.room, {
              type: 'peer-left',
              peerId: currentPeerId
            });
            console.log(`[Leave] Peer ${currentPeerId} left room "${peer.room}"`);
          }
          break;
        }

        default:
          console.warn('Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentPeerId && peers.has(currentPeerId)) {
      const peer = peers.get(currentPeerId);
      peers.delete(currentPeerId);
      broadcastToRoom(peer.room, {
        type: 'peer-left',
        peerId: currentPeerId
      });
      console.log(`[Disconnect] Peer ${currentPeerId} disconnected from "${peer.room}"`);
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for peer ${currentPeerId}:`, err);
  });
});

// Periodic heartbeat to clean stale connections
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Catch-all route to serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(`🚀 Drop-P2P File Transfer Server is running!`);
  console.log(`   ➜ Local:   http://localhost:${PORT}`);
  console.log(`   ➜ Network: http://${primaryNetworkIp}:${PORT}`);
  console.log(`   ➜ Mode:    Zero-setup direct WebRTC P2P (No server storage)`);
  console.log('='.repeat(60));
});
