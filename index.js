// Fix DNS SRV resolution en Node.js v17+ / Windows
// El DNS local de Windows bloquea queries SRV de MongoDB Atlas — forzar Google DNS
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// ───── Registro de plugin global de tenant scope ─────
// IMPORTANTE: debe registrarse ANTES de cargar cualquier modelo para que se aplique a todos.
require('dotenv').config();
const mongooseBootstrap = require('mongoose');
const tenantScopePlugin = require('./models/plugins/tenantScope');
mongooseBootstrap.plugin(tenantScopePlugin);

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 15000; // 15 segundos
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const { tenantContextMiddleware } = require('./services/tenantContext');

// ───── CORS: allowlist por env ─────
// CORS_ORIGINS="https://app.gemshub.com,https://acme.gemshub.com"
// En dev: si no se define, refleja el origen (acepta localhost:5173, 127.0.0.1, etc.)
const allowlist = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: (origin, callback) => {
    // Permitir llamadas sin origen (Postman, curl, healthchecks) y mismo-origen
    if (!origin) return callback(null, true);
    if (allowlist.length === 0) return callback(null, true); // modo dev
    if (allowlist.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origen no autorizado: ${origin}`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  exposedHeaders: ['Content-Disposition']
};

const app = express();
const server = http.createServer(app);

// Confiar en el proxy (Render, Cloudflare) para rate limit por IP real
app.set('trust proxy', 1);

// ───── Helmet: cabeceras de seguridad ─────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // permite servir uploads desde el frontend
  contentSecurityPolicy: false // CSP la maneja el frontend en index.html
}));

// CORS antes del parser
app.use(cors(corsOptions));

// Límites de body — protege contra payloads enormes
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Sanitización contra NoSQL injection (remueve $ y . de keys en body/query/params)
app.use(mongoSanitize());

// Bloquea HTTP Parameter Pollution (?role=admin&role=user)
app.use(hpp());

// ───── Rate limiting ─────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // 600 reqs / 15 min por IP (suficiente para SPA activa)
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 intentos de login/registro por IP cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Demasiados intentos. Intenta más tarde.' }
});

// Refresh tokens corren cada ~15min por sesión activa. Con muchas pestañas / múltiples
// usuarios detrás de NAT, no podemos meterlos en el authLimiter (los lockoutearía).
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas renovaciones de sesión.' }
});

// Self-service onboarding: estricto contra spam de organizaciones.
const registerOrgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiados intentos de registro. Intenta en 1 hora.' }
});

app.use('/api/', generalLimiter);

// Socket.IO CORS: usa la misma allowlist
const io = socketIo(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

let avisosGroupId = null; // Guardar el ID del grupo 'avisos' automáticamente

// Servir archivos estáticos de uploads. CORS lo maneja el middleware global (allowlist).
// Cross-Origin-Resource-Policy: cross-origin permite que el frontend cargue las imágenes.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));

// Healthcheck público (sin rate limit estricto)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

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
const adminRoutes = require('./routes/admin');

// Usar rutas — rate limits específicos por sub-ruta antes del authLimiter genérico.
// Orden importa: los limiters específicos se montan ANTES del general para que matcheen primero.
app.use('/api/auth/refresh', refreshLimiter);
app.use('/api/auth/register-org', registerOrgLimiter);
app.use('/api/auth', authLimiter, authRoutes);

// ───── Wall: todas las demás rutas /api/* requieren autenticación + org activa ─────
// Rutas públicas explícitas que se saltan este wall: las definidas ANTES de esta línea
// (ej. /api/auth, /api/health). Rutas tipo /api/tickets/public deben usar un sub-router.
const { authenticateToken, requireOrganization } = require('./middleware/auth');
const publicWhitelist = [
  /^\/api\/tickets\/public\/[^/]+$/, // formulario externo de soporte (con orgSlug)
  /^\/api\/health$/,
  // Verificación de email — el link llega por correo, no puede pedir token
  /^\/api\/auth\/verify-email\/[^/]+$/,
];
app.use('/api', (req, res, next) => {
  if (publicWhitelist.some(rx => rx.test(req.originalUrl.split('?')[0]))) return next();
  return authenticateToken(req, res, (err) => {
    if (err) return next(err);
    return requireOrganization(req, res, next);
  });
});

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
app.use('/api/admin', adminRoutes);


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
  const { initTaskReportsCron, initTeamReportsCron } = require('./services/cronService');
  initTaskReportsCron(app);
  initTeamReportsCron(app);

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

// ───── Socket.IO: autenticación obligatoria ─────
const jwt = require('jsonwebtoken');
const SocketUser = require('./models/User');
const SocketMembership = require('./models/Membership');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Token requerido'));

    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
    catch { return next(new Error('Token inválido')); }

    if (!decoded.organizationId) return next(new Error('Organización no seleccionada'));

    const user = await SocketUser.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) return next(new Error('Usuario inválido'));

    const membership = await SocketMembership.findOne({
      user: user._id, organization: decoded.organizationId, status: 'active'
    });
    if (!membership) return next(new Error('Sin acceso a la organización'));

    socket.userId = String(user._id);
    socket.userName = user.name;
    socket.organizationId = String(decoded.organizationId);
    socket.role = membership.role;
    next();
  } catch (err) {
    console.error('[Socket.IO] Auth error:', err.message);
    next(new Error('No autenticado'));
  }
});

io.on('connection', (socket) => {
  console.log(`[Socket.IO] User ${socket.userName} connected (org ${socket.organizationId})`);

  if (!io.onlineUsers) io.onlineUsers = new Map(); // userId -> count
  if (!io.socketToUser) io.socketToUser = new Map(); // socket.id -> userId

  // Auto-join personal room + org room (sin necesidad de evento del cliente)
  socket.join(`user_${socket.userId}`);
  socket.join(`org_${socket.organizationId}`);

  io.socketToUser.set(socket.id, socket.userId);
  const current = io.onlineUsers.get(socket.userId) || 0;
  io.onlineUsers.set(socket.userId, current + 1);
  // Presencia scope-d por org (no leak cross-tenant)
  const onlineInOrg = Array.from(io.sockets.adapter.rooms.get(`org_${socket.organizationId}`) || [])
    .map(sid => io.socketToUser.get(sid))
    .filter(Boolean);
  io.to(`org_${socket.organizationId}`).emit('presence_update', Array.from(new Set(onlineInOrg)));

  // El evento del cliente ignora el userId que envíe — usa el verificado del socket.
  socket.on('join_user_room', () => {
    socket.join(`user_${socket.userId}`);
  });

  // Para unirse a un chat room: verificar que pertenece a la org del socket
  socket.on('join_room', async (roomId) => {
    try {
      const ChatRoom = require('./models/ChatRoom');
      const { runWithTenant } = require('./services/tenantContext');
      const room = await runWithTenant(socket.organizationId, () =>
        ChatRoom.findOne({ _id: roomId })
      );
      if (!room) return; // no existe o no pertenece a la org
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

      const onlineInOrg = Array.from(io.sockets.adapter.rooms.get(`org_${socket.organizationId}`) || [])
        .map(sid => io.socketToUser.get(sid))
        .filter(Boolean);
      io.to(`org_${socket.organizationId}`).emit('presence_update', Array.from(new Set(onlineInOrg)));
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

// Los endpoints /api/wpp-* ya pasan por el wall de auth (authenticateToken + requireOrganization).
// Añadimos requireRole('admin') porque la sesión Baileys es global (no per-org) y solo
// administradores deben poder enviar mensajes o gestionar la vinculación.
const { requireRole: wppRequireRole } = require('./middleware/auth');
const wppAdminOnly = wppRequireRole('admin');

app.post('/api/wpp-send', wppAdminOnly, async (req, res) => {
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

// Endpoint para listar grupos/chats de WhatsApp (solo admin)
app.get('/api/wpp-groups', wppAdminOnly, async (req, res) => {
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

// Endpoint para consultar el estado de la sesión de WhatsApp (solo admin)
app.get('/api/wpp-status', wppAdminOnly, (req, res) => {
  res.json({ ready: !!baileysReady });
});

// Endpoint para obtener el QR de WhatsApp (solo admin)
app.get('/api/wpp-qr', wppAdminOnly, (req, res) => {
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
