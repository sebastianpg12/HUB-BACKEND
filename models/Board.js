const mongoose = require('mongoose');

const BoardSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  // Información básica
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String,
    default: ''
  },
  
  // Tipo de board
  type: { 
    type: String, 
    enum: ['kanban', 'scrum', 'custom'],
    default: 'kanban'
  },
  
  // Columnas del board
  columns: [{
    id: String,
    name: String,
    order: Number,
    wipLimit: { // Work In Progress limit
      type: Number,
      default: null
    },
    color: String,
    mappedStatus: String // Mapea a task.boardStatus
  }],
  
  // Sprints (para boards Scrum)
  sprints: [{
    id: String,
    name: String,
    goal: String,
    startDate: Date,
    endDate: Date,
    status: {
      type: String,
      enum: ['planned', 'active', 'completed'],
      default: 'planned'
    },
    velocity: Number, // Puntos completados
    capacity: Number, // Horas disponibles
    taskCount: Number,
    completedTaskCount: Number
  }],
  
  // Configuración
  settings: {
    allowSubtasks: {
      type: Boolean,
      default: true
    },
    requireEstimation: {
      type: Boolean,
      default: false
    },
    autoArchive: {
      type: Boolean,
      default: false
    },
    archiveAfterDays: {
      type: Number,
      default: 30
    }
  },
  
  // Miembros del board
  members: [{
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'viewer'],
      default: 'member'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Proyecto relacionado
  projectId: {
    type: String,
    default: null
  },
  
  // Cliente/Proyecto asociado
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    default: null
  },
  
  // Integración con GitHub
  github: {
    connected: {
      type: Boolean,
      default: false
    },
    repoOwner: String,
    repoName: String,
    defaultBranch: String,
    webhookId: String,
    webhookSecret: String,
    lastSync: Date
  },
  
  // Metadatos
  isActive: {
    type: Boolean,
    default: true
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Índices
BoardSchema.index({ createdBy: 1 });
BoardSchema.index({ 'members.userId': 1 });
BoardSchema.index({ isActive: 1, isArchived: 1 });
BoardSchema.index({ 'github.repoName': 1 });

// Middleware
BoardSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Métodos de instancia
BoardSchema.methods.addMember = function(userId, role = 'member') {
  const exists = this.members.some(m => m.userId.toString() === userId.toString());
  if (!exists) {
    this.members.push({ userId, role });
  }
  return this.save();
};

BoardSchema.methods.removeMember = function(userId) {
  this.members = this.members.filter(m => m.userId.toString() !== userId.toString());
  return this.save();
};

BoardSchema.methods.addColumn = function(columnData) {
  const maxOrder = this.columns.length > 0 
    ? Math.max(...this.columns.map(c => c.order)) 
    : 0;
  
  this.columns.push({
    ...columnData,
    order: columnData.order || maxOrder + 1,
    id: columnData.id || new mongoose.Types.ObjectId().toString()
  });
  
  return this.save();
};

BoardSchema.methods.createSprint = function(sprintData) {
  const sprint = {
    id: new mongoose.Types.ObjectId().toString(),
    ...sprintData,
    status: 'planned',
    taskCount: 0,
    completedTaskCount: 0
  };
  
  this.sprints.push(sprint);
  return this.save();
};

BoardSchema.methods.getActiveSprint = function() {
  return this.sprints.find(s => s.status === 'active');
};

// Métodos estáticos
BoardSchema.statics.findByUser = function(userId) {
  return this.find({
    $or: [
      { createdBy: userId },
      { 'members.userId': userId }
    ],
    isArchived: false
  }).populate('createdBy', 'name email photo');
};

BoardSchema.statics.findByGitHubRepo = function(repoOwner, repoName) {
  return this.findOne({
    'github.connected': true,
    'github.repoOwner': repoOwner,
    'github.repoName': repoName
  });
};

module.exports = mongoose.model('Board', BoardSchema);
