const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
    role: {
    type: String,
    required: true,
    default: 'employee'
  },
  // Rol de plataforma — independiente de Memberships. Si es true, este usuario es
  // super-administrador de GEMS Hub: puede entrar a cualquier organización activa
  // y gestionar tenants. NUNCA debe heredar permisos de tenant automáticamente para
  // datos sensibles — solo abre la puerta de entrada.
  isSuperAdmin: {
    type: Boolean,
    default: false,
    index: true
  },
  avatar: {
    type: String,
    default: null
  },
  photo: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    default: null
  },
  position: {
    type: String,
    default: null
  },
  department: {
    type: String,
    default: null
  },
  departmentRole: {
    type: String,
    enum: ['member', 'leader'],
    default: 'member'
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  permissions: {
    dashboard: { type: Boolean, default: true },
    clients: { 
      view: { type: Boolean, default: true },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    activities: { 
      view: { type: Boolean, default: true },
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
      view: { type: Boolean, default: true },
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

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Sanitize supervisor
  if (this.supervisor === '') {
    this.supervisor = null;
  }

  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Sanitize supervisor on update
userSchema.pre(['findOneAndUpdate', 'updateMany', 'updateOne'], function(next) {
  const update = this.getUpdate();
  
  if (update.supervisor === '') {
    update.supervisor = null;
  }
  
  if (update.$set && update.$set.supervisor === '') {
    update.$set.supervisor = null;
  }
  
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Removed old hardcoded permissions switch case.

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  // Don't force default avatar here - let frontend handle defaults
  return user;
};

module.exports = mongoose.model('User', userSchema);
