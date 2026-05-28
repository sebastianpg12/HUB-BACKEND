const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  isSystem: {
    type: Boolean,
    default: false
  },
  permissions: {
    dashboard: { type: Boolean, default: false },
    clients: { 
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    activities: { 
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    reports: { 
      view: { type: Boolean, default: false },
      export: { type: Boolean, default: false }
    },
    accounting: { 
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    cases: { 
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    team: { 
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    }
  }
}, {
  timestamps: true
});

// name único dentro de cada organización
roleSchema.index({ organizationId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Role', roleSchema);
