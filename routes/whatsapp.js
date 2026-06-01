const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');
const { requireRole } = require('../middleware/auth');

// La sesión Baileys es global (no per-org). Solo super-admins deben poder
// enviar mensajes o gestionar la vinculación. El wall global ya valida auth+org;
// aquí restringimos al rol admin de la org activa (que para super-admin se
// satisface vía isSuperAdminSession en requireRole).
const adminOnly = requireRole('admin');

// Endpoint para enviar mensaje
router.post('/wpp-send', adminOnly, async (req, res) => {
  if (!whatsappService.isReady()) {
    return res.status(503).json({ error: 'WhatsApp no vinculado' });
  }
  
  const { message, groupName } = req.body;
  
  try {
    const result = await whatsappService.sendMessageToGroup(groupName || 'notificaciones', message);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para listar grupos/chats de WhatsApp (solo para uso interno)
router.get('/wpp-groups', adminOnly, async (req, res) => {
  if (!whatsappService.isReady()) {
    return res.status(503).json({ error: 'WhatsApp no vinculado' });
  }
  
  try {
    const groups = await whatsappService.getAllGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para consultar el estado de la sesión de WhatsApp
router.get('/wpp-status', adminOnly, (req, res) => {
  res.json({ ready: whatsappService.isReady() });
});

// Endpoint para obtener el QR de WhatsApp
router.get('/wpp-qr', adminOnly, (req, res) => {
  const qr = whatsappService.getQR();
  const ready = whatsappService.isReady();
  
  if (qr && !ready) {
    res.json({ qr });
  } else if (ready) {
    res.json({ status: 'ready' });
  } else {
    res.status(503).json({ error: 'QR no disponible aún' });
  }
});

module.exports = router;
