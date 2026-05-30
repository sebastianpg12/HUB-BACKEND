module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Presence tracking maps
    if (!io.onlineUsers) {
      io.onlineUsers = new Map();
    }
    if (!io.socketToUser) {
      io.socketToUser = new Map();
    }
    
    // Join user to their personal room
    socket.on('join_user_room', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined their room`);
      
      // Map this socket to user
      io.socketToUser.set(socket.id, userId);
      const current = io.onlineUsers.get(userId) || 0;
      io.onlineUsers.set(userId, current + 1);
      
      // Broadcast presence update to all clients
      const onlineList = Array.from(io.onlineUsers.keys());
      io.emit('presence_update', onlineList);
    });
    
    // Join chat room
    socket.on('join_room', (roomId) => {
      socket.join(`room_${roomId}`);
      console.log(`User joined room: ${roomId}`);
    });
    
    // Leave chat room
    socket.on('leave_room', (roomId) => {
      socket.leave(`room_${roomId}`);
      console.log(`User left room: ${roomId}`);
    });
    
    // Handle typing indicators
    socket.on('typing_start', (data) => {
      socket.to(`room_${data.roomId}`).emit('user_typing', {
        userId: data.userId,
        userName: data.userName,
        roomId: data.roomId
      });
    });
    
    socket.on('typing_stop', (data) => {
      socket.to(`room_${data.roomId}`).emit('user_stop_typing', {
        userId: data.userId,
        roomId: data.roomId
      });
    });
    
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Update presence maps
      const userId = io.socketToUser.get(socket.id);
      if (userId) {
        const current = io.onlineUsers.get(userId) || 0;
        if (current <= 1) {
          io.onlineUsers.delete(userId);
        } else {
          io.onlineUsers.set(userId, current - 1);
        }
        io.socketToUser.delete(socket.id);
        
        // Broadcast updated presence
        const onlineList = Array.from(io.onlineUsers.keys());
        io.emit('presence_update', onlineList);
      }
    });
  });
};
