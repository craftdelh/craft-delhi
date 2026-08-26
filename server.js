require('dotenv').config();
const http = require('http');
const socketIO = require('socket.io');
const app = require('./app');

// Create HTTP server from Express app
const server = http.createServer(app);

// Attach socket.io to the HTTP server
const io = socketIO(server, {
  cors: {
    origin: '*', // You can restrict this in production
    methods: ['GET', 'POST']
  }
});

// Optional: Make io globally accessible
global.io = io;

// Handle WebSocket connections
io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);

  // Client joins their user/seller room for instant targeted notifications
  socket.on('join', (userId) => {
    if (userId) {
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`👤 Socket ${socket.id} joined room: ${roomName}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Socket disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
