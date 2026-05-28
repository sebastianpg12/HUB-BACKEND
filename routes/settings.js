const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const Organization = require('../models/Organization');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── Logo upload storage (per-organización) ───────────────────────
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!req.organizationId) return cb(new Error('Organización requerida para subir logo'));
    const dir = path.join(__dirname, '../uploads/orgs', String(req.organizationId), 'brand');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    // Timestamp en el nombre fuerza cache-bust en el frontend
    cb(null, `logo-${Date.now()}${ext}`);
  },
});

const ALLOWED_LOGO_MIMES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/gif', 'image/webp'];
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_LOGO_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (PNG, SVG, JPG, GIF, WebP)'), false);
    }
  },
});

// ─── Brand settings (scoped per-org por el plugin tenantScope) ────

router.get('/brand', async (req, res) => {
  try {
    // El plugin auto-filtra por organizationId. Si no hay setting aún, fallback al
    // branding de la Organization (cargado en req.organization por el middleware).
    const setting = await Setting.findOne({ key: 'brand' });
    if (setting?.value) return res.json(setting.value);
    res.json(req.organization?.branding || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/brand', async (req, res) => {
  try {
    const setting = await Setting.findOneAndUpdate(
      { key: 'brand' },
      { $set: { key: 'brand', value: req.body, updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Espejo del branding en la Organization (para mostrarlo en /select-org sin
    // que el usuario tenga que estar dentro de la org).
    await Organization.findByIdAndUpdate(req.organizationId, {
      $set: {
        'branding.logo': req.body.logo || null,
        'branding.accentColor': req.body.accentColor || '#8b5cf6',
        'branding.primaryColor': req.body.accentColor || '#8b5cf6',
        'branding.displayName': req.body.brandName || null,
        'branding.darkMode': !!req.body.darkMode
      }
    });

    res.json(setting.value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logo', uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const url = `/uploads/orgs/${req.organizationId}/brand/${req.file.filename}`;
  res.json({ url });
});

router.delete('/logo', async (req, res) => {
  try {
    const brandDir = path.join(__dirname, '../uploads/orgs', String(req.organizationId), 'brand');
    if (fs.existsSync(brandDir)) {
      for (const f of fs.readdirSync(brandDir)) {
        if (/^logo[-.]/i.test(f)) fs.unlinkSync(path.join(brandDir, f));
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Legacy generic settings (auto-scoped por plugin) ─────────────
router.get('/', async (req, res) => {
  try {
    const settings = await Setting.find();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const setting = new Setting(req.body); // plugin pone organizationId
    await setting.save();
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const setting = await Setting.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!setting) return res.status(404).json({ error: 'Setting no encontrado' });
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await Setting.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Setting no encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
