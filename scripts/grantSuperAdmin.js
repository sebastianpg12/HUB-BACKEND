/**
 * Otorga el flag User.isSuperAdmin = true a un usuario existente.
 *
 * Uso:
 *   node scripts/grantSuperAdmin.js <email>
 *   node scripts/grantSuperAdmin.js pulgaringomezsebastian@gmail.com
 *
 * Para revocar:
 *   node scripts/grantSuperAdmin.js <email> --revoke
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const email = process.argv[2];
  const revoke = process.argv.includes('--revoke');

  if (!email) {
    console.error('Uso: node scripts/grantSuperAdmin.js <email> [--revoke]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const User = require('../models/User');

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    console.error(`❌ Usuario no encontrado: ${email}`);
    process.exit(1);
  }

  user.isSuperAdmin = !revoke;
  await user.save();

  console.log(`✅ ${user.name} (${user.email}) — isSuperAdmin = ${user.isSuperAdmin}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
