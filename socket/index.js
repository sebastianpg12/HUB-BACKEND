/**
 * Socket.IO con autenticación obligatoria y scope por organización.
 *
 * - `io.use(...)` verifica el JWT del handshake. Sin token o sin orgId → reject.
 * - Cada socket queda atado a un userId y organizationId verificados (no se
 *   confía en los argumentos del cliente).
 * - Presence y broadcasts se hacen en el room `org_${id}` para evitar leaks
 *   cross-tenant.
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Membership = require('../models/Membership');
const ChatRoom = require('../models/ChatRoom');
const { runWithTenant } = require('../services/tenantContext');

module.exports = (io) => {
  // ───── Middleware de autenticación ─────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Token requerido'));

      let decoded;
      try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
      catch { return next(new Error('Token inválido')); }

      if (!decoded.organizationId) return next(new Error('Organización no seleccionada'));

      const user = await User.findById(decoded.userId).select('-password');
      if (!user || !user.isActive) return next(new Error('Usuario inválido'));

      // Super-admin: aceptamos sin Membership real (sesión virtual).
      let role = 'admin';
      if (!user.isSuperAdmin) {
        const membership = await Membership.findOne({
          user: user._id,
          organization: decoded.organizationId,
          status: 'active'
        });
        if (!membership) return next(new Error('Sin acceso a la organización'));
        role = membership.role;
      }

      socket.userId = String(user._id);
      socket.userName = user.name;
      socket.organizationId = String(decoded.organizationId);
      socket.role = role;
      socket.isSuperAdmin = !!user.isSuperAdmin;
      next();
    } catch (err) {
      console.error('[Socket.IO] Auth error:', err.message);
      next(new Error('No autenticado'));
    }
  });

  // ───── Conexión ─────
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] ${socket.userName} conectado (org ${socket.organizationId})`);

    if (!io.onlineUsers) io.onlineUsers = new Map();   // userId -> count
    if (!io.socketToUser) io.socketToUser = new Map(); // socket.id -> userId

    // Auto-join: personal + org. Cliente no decide a qué rooms entrar.
    socket.join(`user_${socket.userId}`);
    socket.join(`org_${socket.organizationId}`);

    io.socketToUser.set(socket.id, socket.userId);
    const current = io.onlineUsers.get(socket.userId) || 0;
    io.onlineUsers.set(socket.userId, current + 1);

    // Presencia scope-d por org (no se filtra entre tenants).
    const broadcastPresence = () => {
      const onlineInOrg = Array.from(io.sockets.adapter.rooms.get(`org_${socket.organizationId}`) || [])
        .map(sid => io.socketToUser.get(sid))
        .filter(Boolean);
      io.to(`org_${socket.organizationId}`).emit('presence_update', Array.from(new Set(onlineInOrg)));
    };
    broadcastPresence();

    // El cliente puede pedir re-join, pero el userId se ignora.
    socket.on('join_user_room', () => {
      socket.join(`user_${socket.userId}`);
    });

    // Para unirse a un chat room: verificar que pertenece a la org del socket
    // y que el usuario es participante.
    socket.on('join_room', async (roomId) => {
      try {
        const room = await runWithTenant(socket.organizationId, () =>
          ChatRoom.findOne({ _id: roomId })
        );
        if (!room) return;
        const isParticipant = room.participants.some(p => String(p) === socket.userId);
        if (!isParticipant) return;
        socket.join(`room_${roomId}`);
      } catch (err) {
        console.error('[Socket.IO] join_room error:', err.message);
      }
    });

    socket.on('leave_room', (roomId) => {
      socket.leave(`room_${roomId}`);
    });

    socket.on('typing_start', (data) => {
      if (!data?.roomId) return;
      socket.to(`room_${data.roomId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.userName,
        roomId: data.roomId
      });
    });

    socket.on('typing_stop', (data) => {
      if (!data?.roomId) return;
      socket.to(`room_${data.roomId}`).emit('user_stop_typing', {
        userId: socket.userId,
        roomId: data.roomId
      });
    });

    socket.on('disconnect', () => {
      const userId = io.socketToUser.get(socket.id);
      if (userId) {
        const cnt = io.onlineUsers.get(userId) || 0;
        if (cnt <= 1) io.onlineUsers.delete(userId);
        else io.onlineUsers.set(userId, cnt - 1);
        io.socketToUser.delete(socket.id);
        broadcastPresence();
      }
    });
  });
};
