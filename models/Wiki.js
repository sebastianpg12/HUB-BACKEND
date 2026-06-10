const mongoose = require('mongoose');

const wikiSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  titulo: {
    type: String,
    required: true,
    trim: true
  },
  categoria: {
    type: String,
    enum: ['proceso', 'codigo', 'manual', 'otros'],
    default: 'proceso'
  },
  contenido: {
    type: String,
    default: ''
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wiki',
    default: null,
    index: true
  },
  order: {
    type: Number,
    default: 0
  },
  archived: {
    type: Boolean,
    default: false,
    index: true
  },
  icon: {
    type: String,
    default: ''
  },
  descripcion: {
    type: String,
    trim: true
  },
  tags: [String],
  autor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  archivos: [{
    nombre: String,
    url: String,
    tipo: String
  }],
  vistas: {
    type: Number,
    default: 0
  },
  linkedTickets: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Wiki', wikiSchema);
