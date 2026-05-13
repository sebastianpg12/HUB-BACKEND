const mongoose = require('mongoose')

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
})

const NoteSchema = new mongoose.Schema({
  content: { type: String, required: true },
  author: { type: String },
  createdAt: { type: Date, default: Date.now }
})

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  dueDate: { type: Date },
  done: { type: Boolean, default: false },
  doneAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
})

const TimelineEntrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'created',
      'status',
      'outreach_email',
      'outreach_whatsapp',
      'outreach_call',
      'note',
      'task_created',
      'task_completed',
      'converted',
      'ai_summary',
      'ai_action'
    ],
    required: true
  },
  description: { type: String, required: true },
  meta: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
})

const ProspectConversationSchema = new mongoose.Schema({
  // Identidad
  prospectName: { type: String, required: true },
  company: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },

  // Mensajes con IA (existente)
  messages: [MessageSchema],
  lastUpdated: { type: Date, default: Date.now },

  // Pipeline & valor comercial
  status: {
    type: String,
    enum: ['nuevo', 'calificado', 'propuesta', 'seguimiento', 'ganado', 'perdido'],
    default: 'nuevo'
  },
  estimatedValue: { type: Number, default: 0 },
  source: {
    type: String,
    enum: ['web', 'whatsapp', 'referido', 'linkedin', 'evento', 'cold', 'otro'],
    default: undefined
  },

  // Contacto
  contactName: { type: String },
  contactEmail: { type: String },
  contactPhone: { type: String },

  // Asignación
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },

  // Sub-colecciones de gestión comercial
  notes: [NoteSchema],
  tasks: [TaskSchema],
  timeline: [TimelineEntrySchema]
}, { timestamps: true })

// Helper para añadir entradas al timeline desde rutas
ProspectConversationSchema.methods.addTimelineEntry = function (type, description, meta) {
  this.timeline.unshift({ type, description, meta })
  // Cap a 200 eventos para no inflar el doc
  if (this.timeline.length > 200) this.timeline = this.timeline.slice(0, 200)
}

module.exports = mongoose.model('ProspectConversation', ProspectConversationSchema)
