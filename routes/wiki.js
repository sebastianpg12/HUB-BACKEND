const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Wiki = require('../models/Wiki');

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Configuración de multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Árbol de páginas (ligero, para el sidebar)
router.get('/tree', async (req, res) => {
  try {
    const pages = await Wiki.find({ archived: { $ne: true } })
      .select('titulo parentId order icon updatedAt')
      .sort({ order: 1, createdAt: 1 });
    res.json({ success: true, data: pages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Páginas archivadas
router.get('/archived', async (req, res) => {
  try {
    const pages = await Wiki.find({ archived: true })
      .select('titulo parentId order icon updatedAt')
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: pages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Obtener todos los artículos de la wiki
router.get('/', async (req, res) => {
  try {
    const { categoria, search } = req.query;
    let query = { archived: { $ne: true } };
    if (categoria) query.categoria = categoria;
    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { titulo: { $regex: safe, $options: 'i' } },
        { descripcion: { $regex: safe, $options: 'i' } },
        { tags: { $in: [new RegExp(safe, 'i')] } }
      ];
    }
    const articles = await Wiki.find(query)
      .populate('autor', 'name email')
      .populate('linkedTickets', 'subject ticketNumber status')
      .sort({ updatedAt: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Obtener un artículo por ID
router.get('/:id', async (req, res) => {
  try {
    const article = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('autor', 'name email')
      .populate('linkedTickets');
    if (!article) return res.status(404).json({ message: 'Artículo no encontrado' });
    article.vistas += 1;
    await article.save();
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Crear un nuevo artículo
router.post('/', upload.array('archivos', 5), async (req, res) => {
  try {
    const wikiData = {
      ...req.body,
      organizationId: req.organizationId,
      autor: req.userId || req.body.autor
    };
    if (wikiData.parentId === '' || wikiData.parentId === 'null') wikiData.parentId = null;
    if (wikiData.order === undefined) {
      const last = await Wiki.findOne({ parentId: wikiData.parentId || null })
        .sort({ order: -1 }).select('order');
      wikiData.order = last ? last.order + 1 : 0;
    }
    if (req.files) {
      wikiData.archivos = req.files.map(file => ({
        nombre: file.originalname,
        url: `/uploads/${file.filename}`,
        tipo: file.mimetype
      }));
    }
    const article = new Wiki(wikiData);
    const newArticle = await article.save();
    res.status(201).json(newArticle);
  } catch (err) {
    console.error('Error en POST /api/wiki:', err);
    res.status(500).json({ message: err.message, stack: err.stack });
  }
});

// Actualizar un artículo
router.put('/:id', upload.array('archivos', 5), async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      organizationId: req.organizationId
    };
    if (updateData.parentId === '' || updateData.parentId === 'null') updateData.parentId = null;
    const article = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!article) return res.status(404).json({ message: 'Artículo no encontrado' });

    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map(file => ({
        nombre: file.originalname,
        url: `/uploads/${file.filename}`,
        tipo: file.mimetype
      }));
      updateData.archivos = [...(article.archivos || []), ...newFiles];
    }

    const updatedArticle = await Wiki.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json(updatedArticle);
  } catch (err) {
    console.error('Error en PUT /api/wiki:', err);
    res.status(500).json({ message: err.message });
  }
});

// Mover / reordenar página (cambiar padre y/u orden)
router.patch('/:id/move', async (req, res) => {
  try {
    const { parentId, order } = req.body;
    const page = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!page) return res.status(404).json({ success: false, message: 'Página no encontrada' });

    if (parentId !== undefined) {
      const newParent = parentId || null;
      // Evitar ciclos: el nuevo padre no puede ser la propia página ni un descendiente
      if (newParent) {
        if (String(newParent) === String(page._id)) {
          return res.status(400).json({ success: false, message: 'Una página no puede ser su propio padre' });
        }
        let cursor = await Wiki.findById(newParent).select('parentId');
        while (cursor) {
          if (String(cursor._id) === String(page._id)) {
            return res.status(400).json({ success: false, message: 'No se puede mover dentro de una sub-página propia' });
          }
          cursor = cursor.parentId ? await Wiki.findById(cursor.parentId).select('parentId') : null;
        }
      }
      page.parentId = newParent;
    }
    if (order !== undefined) page.order = order;
    await page.save();
    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Archivar página (y sus descendientes)
router.patch('/:id/archive', async (req, res) => {
  try {
    const page = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!page) return res.status(404).json({ success: false, message: 'Página no encontrada' });

    const idsToArchive = [page._id];
    let frontier = [page._id];
    while (frontier.length) {
      const children = await Wiki.find({ parentId: { $in: frontier } }).select('_id');
      frontier = children.map(c => c._id);
      idsToArchive.push(...frontier);
    }
    await Wiki.updateMany({ _id: { $in: idsToArchive } }, { archived: true });
    res.json({ success: true, message: 'Página archivada', data: { archivedIds: idsToArchive } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Restaurar página archivada (vuelve como raíz si su padre sigue archivado)
router.patch('/:id/restore', async (req, res) => {
  try {
    const page = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!page) return res.status(404).json({ success: false, message: 'Página no encontrada' });

    page.archived = false;
    if (page.parentId) {
      const parent = await Wiki.findById(page.parentId).select('archived');
      if (!parent || parent.archived) page.parentId = null;
    }
    await page.save();
    res.json({ success: true, data: page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Eliminar un artículo: por defecto archiva; ?permanent=true borra de verdad
router.delete('/:id', async (req, res) => {
  try {
    const page = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!page) return res.status(404).json({ success: false, message: 'Página no encontrada' });

    if (req.query.permanent === 'true') {
      const idsToDelete = [page._id];
      let frontier = [page._id];
      while (frontier.length) {
        const children = await Wiki.find({ parentId: { $in: frontier } }).select('_id');
        frontier = children.map(c => c._id);
        idsToDelete.push(...frontier);
      }
      await Wiki.deleteMany({ _id: { $in: idsToDelete } });
      return res.json({ success: true, message: 'Página eliminada permanentemente' });
    }

    page.archived = true;
    await page.save();
    res.json({ success: true, message: 'Página archivada' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST - Vincular ticket a un artículo de wiki
router.post('/:id/tickets', async (req, res) => {
  try {
    const { ticketId } = req.body;
    const wiki = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!wiki) return res.status(404).json({ message: 'Artículo no encontrado' });
    
    if (!wiki.linkedTickets.includes(ticketId)) {
      wiki.linkedTickets.push(ticketId);
      await wiki.save();
    }
    
    const populated = await Wiki.findById(wiki._id)
      .populate('autor', 'name email')
      .populate('linkedTickets');
      
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE - Desvincular ticket de un artículo de wiki
router.delete('/:id/tickets/:ticketId', async (req, res) => {
  try {
    const wiki = await Wiki.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!wiki) return res.status(404).json({ message: 'Artículo no encontrado' });
    
    wiki.linkedTickets = wiki.linkedTickets.filter(id => id.toString() !== req.params.ticketId);
    await wiki.save();
    
    const populated = await Wiki.findById(wiki._id)
      .populate('autor', 'name email')
      .populate('linkedTickets');
      
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
