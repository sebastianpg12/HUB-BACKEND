const express = require('express');
const AvatarService = require('../services/avatarService');
const { authenticateToken } = require('../middleware/auth');
const { uploadProfilePhoto } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');

const router = express.Router();

/**
 * @route GET /api/avatars
 * @desc Obtener lista de avatares disponibles
 * @access Private
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const availableAvatars = AvatarService.getAvailableAvatars();

    res.json({
      success: true,
      data: {
        avatars: availableAvatars,
        default: AvatarService.getDefaultAvatar()
      }
    });
  } catch (error) {
    console.error('Error getting available avatars:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo avatares disponibles'
    });
  }
});

/**
 * @route GET /api/avatars/stats
 * @desc Obtener estadísticas de uso de avatares
 * @access Private (Admin only)
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Solo admins pueden ver estadísticas
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Solo administradores pueden ver estadísticas.'
      });
    }

    const stats = await AvatarService.getAvatarStats();

    res.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    console.error('Error getting avatar stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de avatares'
    });
  }
});

/**
 * @route GET /api/avatars/user
 * @desc Obtener avatar del usuario actual
 * @access Private
 */
router.get('/user', authenticateToken, async (req, res) => {
  try {
    const avatarInfo = await AvatarService.getUserAvatar(req.user._id);

    res.json({
      success: true,
      data: {
        avatar: avatarInfo?.avatar,
        photo: avatarInfo?.photo,
        default: AvatarService.getDefaultAvatar()
      }
    });
  } catch (error) {
    console.error('Error getting user avatar:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo avatar del usuario'
    });
  }
});

/**
 * @route PUT /api/avatars/user
 * @desc Actualizar avatar del usuario actual
 * @access Private
 */
router.put('/user', authenticateToken, async (req, res) => {
  try {
    const { avatar } = req.body;

    // Validar avatar si se proporciona
    if (avatar && !AvatarService.isValidAvatar(avatar)) {
      return res.status(400).json({
        success: false,
        message: 'Avatar inválido. Use uno de los avatares disponibles.'
      });
    }

    const updatedUser = await AvatarService.updateUserAvatar(req.user._id, avatar);

    res.json({
      success: true,
      message: 'Avatar actualizado exitosamente',
      data: {
        user: updatedUser.toJSON(),
        avatar: avatar
      }
    });
  } catch (error) {
    console.error('Error updating user avatar:', error);

    if (error.message === 'Usuario no encontrado') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message === 'ID de avatar inválido') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error actualizando avatar'
    });
  }
});

/**
 * @route DELETE /api/avatars/user
 * @desc Quitar avatar del usuario actual (usar avatar por defecto)
 * @access Private
 */
router.delete('/user', authenticateToken, async (req, res) => {
  try {
    const updatedUser = await AvatarService.updateUserAvatar(req.user._id, null);

    res.json({
      success: true,
      message: 'Avatar removido exitosamente',
      data: {
        user: updatedUser.toJSON(),
        avatar: null
      }
    });
  } catch (error) {
    console.error('Error removing user avatar:', error);
    res.status(500).json({
      success: false,
      message: 'Error removiendo avatar'
    });
  }
});

/**
 * @route POST /api/avatars/upload-photo
 * @desc Subir una foto de perfil personalizada
 * @access Private
 */
router.post('/upload-photo', authenticateToken, uploadProfilePhoto.single('photo'), async (req, res) => {
  try {
    // Verificar si se subió un archivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se proporcionó ninguna imagen'
      });
    }

    // Ruta relativa para la BD: SIEMPRE con barras URL (no path.join, que en Windows usa '\')
    const relativePath = `/uploads/profiles/${req.file.filename}`;

    // Actualizar el usuario con la nueva foto
    const updatedUser = await AvatarService.updateUserPhoto(req.user._id, relativePath);

    res.json({
      success: true,
      message: 'Foto de perfil actualizada exitosamente',
      data: {
        user: updatedUser.toJSON(),
        photo: relativePath
      }
    });
  } catch (error) {
    console.error('Error uploading profile photo:', error);

    // Manejar diferentes tipos de errores
    if (error.message.includes('límite de archivo')) {
      return res.status(400).json({
        success: false,
        message: 'La imagen es demasiado grande. Máximo 2MB.'
      });
    }

    if (error.message === 'Usuario no encontrado') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error actualizando foto de perfil'
    });
  }
});

/**
 * @route DELETE /api/avatars/photo
 * @desc Eliminar la foto de perfil personalizada del usuario
 * @access Private
 */
router.delete('/photo', authenticateToken, async (req, res) => {
  try {
    // Obtener usuario actual
    const user = await User.findById(req.user._id).select('photo');
    
    // Si tiene foto, intentar eliminarla físicamente
    if (user.photo) {
      try {
        const photoPath = path.join(__dirname, '..', user.photo);
        if (fs.existsSync(photoPath)) {
          fs.unlinkSync(photoPath);
        }
      } catch (err) {
        console.warn('No se pudo eliminar el archivo de foto:', err);
        // Continuar con la actualización aunque no se pueda borrar el archivo
      }
    }

    // Actualizar el usuario para quitar la referencia a la foto
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { photo: null },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Foto de perfil eliminada exitosamente',
      data: {
        user: updatedUser.toJSON()
      }
    });
  } catch (error) {
    console.error('Error removing profile photo:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando la foto de perfil'
    });
  }
});

module.exports = router;