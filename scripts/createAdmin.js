// Script one-shot: crea el usuario admin de GEMS Hub
// Uso: node scripts/createAdmin.js

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to gems-hub DB');

  const email = 'pulgaringomezsebastian@gmail.com';

  // Eliminar si ya existía (re-seed limpio)
  await User.deleteOne({ email });

  const user = new User({
    name: 'Sebastian Pulgarin',
    email,
    password: 'Gems12-',
    role: 'admin',
    position: 'Administrador',
    department: 'GEMS Innovations',
    isActive: true,
    permissions: {
      dashboard: true,
      clients:    { view: true, create: true, edit: true, delete: true },
      activities: { view: true, create: true, edit: true, delete: true },
      reports:    { view: true, export: true },
      accounting: { view: true, create: true, edit: true, delete: true },
      cases:      { view: true, create: true, edit: true, delete: true },
      team:       { view: true, create: true, edit: true, delete: true },
    },
  });

  await user.save();
  console.log(`✅ Admin created: ${user.email} | role: ${user.role}`);
  await mongoose.disconnect();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
