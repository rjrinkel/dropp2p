# DropP2P — Zero-Setup Peer-to-Peer Local File Transfer

DropP2P is a fast, lightweight, and modern web application for direct device-to-device file transfer over your local Wi-Fi network using WebRTC DataChannels. Inspired by Snapdrop and PairDrop, no files are ever uploaded to or stored on the server.

---

## ✨ Features

- **Direct WebRTC DataChannel Streaming**: Files stream directly from sender to receiver in high-speed, chunked memory buffers with zero intermediate server storage.
- **Backpressure & Flow Control**: Sends 64 KB chunks with `bufferedAmountLowThreshold` flow control, preventing browser buffer bloat and supporting multi-gigabyte transfers smoothly.
- **Zero-Setup Local Discovery**: Automatically discovers any phone, tablet, or PC running on the same local Wi-Fi / network.
- **6-Character Room Codes & Instant QR Code**:
  - Scan the automatically generated QR code with your phone camera to connect in seconds.
  - Create private 6-character room codes (e.g. `AB12CD`) to isolate transfers or bridge across subnets.
- **Drag-and-Drop & Multi-File Support**: Drag and drop single or multiple files anywhere on the browser window to send.
- **Real-Time Transfer Metrics**: Displays real-time progress bar (%), transfer speed (MB/s), transferred bytes, and dynamic ETA.
- **Dark Mode Cyber UI**: Sleek glassmorphism theme, pulsing radar rings, friendly device names ("Swift Falcon", "Cosmic Fox"), and one-click downloads.
- **Auto-Accept Option**: Optional toggle in Settings to automatically accept and download incoming transfers.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will output:
```
🚀 DropP2P File Transfer Server is running!
   ➜ Local:   http://localhost:3000
   ➜ Network: http://192.168.1.9:3000
   ➜ Mode:    Zero-setup direct WebRTC P2P (No server storage)
```

### 3. Connect Devices
- Open `http://localhost:3000` on your PC.
- Open `http://192.168.1.9:3000` on your phone (or scan the QR code).
- Devices appear automatically on the radar. Click any peer or drag & drop files to send!

---

## 🧪 Automated Verification Test

Run the full end-to-end WebRTC verification test:
```bash
npm test
```
This launches two isolated browser peer sessions in headless Chrome, connects them via WebRTC DataChannel, streams a synthetic binary test payload, and cryptographically verifies the SHA-256 checksum and byte count.

---

## 🔒 Privacy & Architecture

1. **Signaling Server (`server.js`)**: Runs Express and WebSocket (`ws`) only to negotiate WebRTC SDP offers/answers and ICE candidates.
2. **WebRTC DataChannels (`webrtc.js`)**: Transmits binary chunks directly between peers. The server never sees or inspects any file data.
3. **Chunking**: Uses 64 KB slices with array buffers and browser backpressure throttling.
