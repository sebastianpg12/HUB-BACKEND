let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 15000; // 15 segundos
// ...existing code...
// Place all app.get/app.post endpoint definitions below this line, after 'app' is initialized
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();
// CORS sencillo: refleja el origin del request (permite todos los orígenes) y soporta credenciales
const corsOptions = {
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};


const app = express();
const server = http.createServer(app);

// Apply CORS before JSON/static so uploads also get proper headers
app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO CORS: permitir cualquier origen (útil para desarrollo y apps SPA)
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

let avisosGroupId = null; // Guardar el ID del grupo 'avisos' automáticamente

// Servir archivos estáticos de uploads con headers CORS
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, path) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache por 1 año
  }
}));

// Create uploads/chat directory if it doesn't exist
const fs = require('fs');

const chatUploadsDir = path.join(__dirname, 'uploads', 'chat');
if (!fs.existsSync(chatUploadsDir)) {
  fs.mkdirSync(chatUploadsDir, { recursive: true });
}

// Store io instance in app for use in routes
app.set('io', io);

// Importar rutas
const authRoutes = require('./routes/auth');
const clientsRoutes = require('./routes/clients');
const activitiesRoutes = require('./routes/activities');
const paymentsRoutes = require('./routes/payments');
const accountingRoutes = require('./routes/accounting');
const casesRoutes = require('./routes/cases');
const followupsRoutes = require('./routes/followups');
const issuesRoutes = require('./routes/issues');
const notificationsRoutes = require('./routes/notifications');
const docsRoutes = require('./routes/docs');

const minutesRoutes = require('./routes/minutes');
const settingsRoutes = require('./routes/settings');
const teamRoutes = require('./routes/team');
const reportsRoutes = require('./routes/reports');

const chatRoutes = require('./routes/chat');
const prospectsRoutes = require('./routes/prospects');
const avatarRoutes = require('./routes/avatars');
const taskReportsRoutes = require('./routes/taskReports');
const tasksRoutes = require('./routes/tasks');
const boardsRoutes = require('./routes/boards');
const githubRoutes = require('./routes/github');
const ticketsRoutes = require('./routes/tickets');
const rolesRoutes = require('./routes/roles');
const wikiRoutes = require('./routes/wiki');
const aiRoutes = require('./routes/ai');

// Usar rutas
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/followups', followupsRoutes);
app.use('/api/issues', issuesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/minutes', minutesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/prospects', prospectsRoutes);
app.use('/api/avatars', avatarRoutes);
app.use('/api/task-reports', taskReportsRoutes);
app.use('/api/taskReports', taskReportsRoutes); // Alias para compatibilidad
app.use('/api/tasks', tasksRoutes);
app.use('/api/boards', boardsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/ai', aiRoutes);


// Conexión a MongoDB usando .env
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  // ─── One-time initialization ───
  const { ensureSupportUser, ensureDefaultRoles } = require('./services/initService');
  await ensureSupportUser();
  await ensureDefaultRoles();

  // Inicializar el servicio de cron para reportes de tareas
  const { initTaskReportsCron } = require('./services/cronService');
  initTaskReportsCron(app);

  // ─── SLA Alert System (Every 15 minutes) ───
  setInterval(async () => {
    try {
      const { notifySLAAlert } = require('./services/emailService');
      const Ticket = require('./models/Ticket');
      
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      
      const overdueTickets = await Ticket.find({
        status: 'new',
        slaNotified: { $ne: true },
        createdAt: { $lt: twoHoursAgo }
      });

      for (const ticket of overdueTickets) {
        console.log(`[SLA] Ticket #${ticket.ticketNumber} is overdue! Sending alert.`);
        await notifySLAAlert(ticket);
        ticket.slaNotified = true;
        await ticket.save();
      }
    } catch (err) {
      console.error('[SLA] Error running background check:', err);
    }
  }, 15 * 60 * 1000); // 15 mins
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  // Presence tracking maps
  // userId -> connection count
  if (!io.onlineUsers) {
    io.onlineUsers = new Map();
  }
  // socket.id -> userId
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

// --- INTEGRACIÓN WHATSAPP CON BAILEYS ---
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
let baileysSock = null;
let baileysReady = false;
let baileysQR = null;
app.set('baileysSock', null);
app.set('baileysReady', false);

async function startBaileys() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  baileysSock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60000,
  });
  app.set('baileysSock', baileysSock);

  baileysSock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      baileysQR = qr;
      console.log('[Baileys] Escanea este QR para vincular WhatsApp:', qr);
    }
    if (connection === 'open') {
      baileysReady = true;
      app.set('baileysReady', true);
      console.log('[Baileys] WhatsApp vinculado y listo para enviar mensajes');
    }
    if (connection === 'close') {
      baileysReady = false;
      app.set('baileysReady', false);
      console.warn('[Baileys] WhatsApp desconectado:', lastDisconnect?.error?.message);
      setTimeout(() => startBaileys(), 15000);
    }
  });

  baileysSock.ev.on('creds.update', saveCreds);
}

startBaileys();
app.post('/api/wpp-send', async (req, res) => {
  if (!baileysReady) return res.status(503).json({ error: 'WhatsApp no vinculado' });
  const { message, groupName } = req.body;
  try {
    // Buscar el grupo por nombre
    const allGroups = await baileysSock.groupFetchAllParticipating();
    let groupId = null;
    if (groupName) {
      for (const id in allGroups) {
        const group = allGroups[id];
        if (group.subject && group.subject.toLowerCase().includes(groupName.toLowerCase())) {
          groupId = group.id;
          break;
        }
      }
    }
    // Si no se especifica, buscar el grupo 'notificaciones'
    if (!groupId) {
      for (const id in allGroups) {
        const group = allGroups[id];
        if (group.subject && group.subject.toLowerCase().includes('notificaciones')) {
          groupId = group.id;
          break;
        }
      }
    }
    if (!groupId) return res.status(404).json({ error: 'No se encontró el grupo "notificaciones" vinculado' });
    await baileysSock.sendMessage(groupId, { text: message });
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para listar grupos/chats de WhatsApp (solo para uso interno)
app.get('/api/wpp-groups', async (req, res) => {
  if (!baileysReady) return res.status(503).json({ error: 'WhatsApp no vinculado' });
  try {
    const allGroups = await baileysSock.groupFetchAllParticipating();
    // Mapear nombre e ID
    const result = Object.values(allGroups).map(g => ({ name: g.subject, id: g.id }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para consultar el estado de la sesión de WhatsApp
app.get('/api/wpp-status', (req, res) => {
  res.json({ ready: !!baileysReady });
});

// Endpoint para obtener el QR de WhatsApp
app.get('/api/wpp-qr', (req, res) => {
  if (baileysQR && !baileysReady) {
    res.json({ qr: baileysQR });
  } else if (baileysReady) {
    res.json({ status: 'ready' });
  } else {
    res.status(503).json({ error: 'QR no disponible aún' });
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Customer Touch Backend running on port ${PORT}`);
});
