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

  // Inicializar servicios de cron
  const { initTaskReportsCron, initTeamReportsCron, initSlaCron } = require('./services/cronService');
  initTaskReportsCron(app);
  initTeamReportsCron(app);
  initSlaCron();
});

// Socket.io connection handling
require('./socket/index')(io);

// --- INTEGRACIÓN WHATSAPP CON BAILEYS ---
const whatsappService = require('./services/whatsappService');
whatsappService.init(app);
app.use('/api/whatsapp', require('./routes/whatsapp'));
// Re-map the old wpp routes for backward compatibility
app.use('/api', require('./routes/whatsapp')); 

// ─── Global Error Handling Middleware ───
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Customer Touch Backend running on port ${PORT}`);
});
