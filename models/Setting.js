const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  key: String,
  value: mongoose.Schema.Types.Mixed, // Permite almacenar cualquier tipo de valor, incluyendo objetos
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Una key es única dentro de cada organización
SettingSchema.index({ organizationId: 1, key: 1 }, { unique: true });

// Middleware para actualizar updatedAt en cada modificación
SettingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Setting', SettingSchema);
