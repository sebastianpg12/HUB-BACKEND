const express = require('express');
const router = express.Router();
const ChatRoom = require('../models/ChatRoom');
const Message = require('../models/Message');
const User = require('../models/User');
const { authenticateToken: auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/chat/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get all chat rooms for current user
router.get('/rooms', auth, async (req, res) => {
  try {
    const rooms = await ChatRoom.find({
      participants: req.user._id,
      isActive: true
    })
    .populate('participants', 'name email avatar position')
    .populate('createdBy', 'name email')
    .populate('admins', 'name email')
    .sort('-lastActivity');

    res.json(rooms);
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new chat room
router.post('/rooms', auth, async (req, res) => {
  try {
    const { name, description, participants, type = 'team' } = req.body;

    // Validate participants
    const validParticipants = await User.find({
      _id: { $in: participants },
      isActive: true
    });

    if (validParticipants.length !== participants.length) {
      return res.status(400).json({ error: 'Some participants are invalid or inactive' });
    }

    // Add creator to participants if not already included
    const participantIds = [...new Set([...participants, req.user._id])];

    const chatRoom = new ChatRoom({
      name,
      description,
      type,
      participants: participantIds,
      admins: [req.user._id],
      createdBy: req.user._id
    });

    await chatRoom.save();
    
    const populatedRoom = await ChatRoom.findById(chatRoom._id)
      .populate('participants', 'name email avatar position')
      .populate('createdBy', 'name email')
      .populate('admins', 'name email');

    // Emit room creation to all participants
    const io = req.app.get('io');
    if (io) {
      participantIds.forEach(participantId => {
        io.to(`user_${participantId}`).emit('room_created', populatedRoom);
      });
    }

    res.status(201).json(populatedRoom);
  } catch (error) {
    console.error('Error creating chat room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a chat room
router.get('/rooms/:roomId/messages', auth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Check if user is participant
    const room = await ChatRoom.findById(roomId);
    if (!room || !room.participants.includes(req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await Message.find({
      chatRoom: roomId,
      deleted: false
    })
    .populate('sender', 'name email avatar position')
    .populate('replyTo', 'content sender')
    .populate({
      path: 'replyTo',
      populate: {
        path: 'sender',
        select: 'name email avatar'
      }
    })
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit);

    res.json(messages.reverse());
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send message to chat room
router.post('/rooms/:roomId/messages', auth, upload.array('files', 5), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content, type = 'text', replyTo } = req.body;

    // Check if user is participant
    const room = await ChatRoom.findById(roomId);
    if (!room || !room.participants.includes(req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
        url: `/uploads/chat/${file.filename}`
      }));
    }

    const message = new Message({
      chatRoom: roomId,
      sender: req.user._id,
      content,
      type,
      attachments,
      replyTo: replyTo || null,
      organizationId: req.organizationId
    });

    await message.save();

    // Update room's last activity
    room.lastActivity = new Date();
    await room.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email avatar position')
      .populate('replyTo', 'content sender')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'sender',
          select: 'name email avatar'
        }
      });

    // Emit message to all room participants
    const io = req.app.get('io');
    if (io) {
      room.participants.forEach(participantId => {
        io.to(`user_${participantId}`).emit('new_message', populatedMessage);
      });
    }

    res.status(201).json(populatedMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark message as read
router.put('/messages/:messageId/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already marked as read
    const alreadyRead = message.readBy.find(read => 
      read.user.toString() === req.user._id
    );

    if (!alreadyRead) {
      message.readBy.push({
        user: req.user._id,
        readAt: new Date()
      });
      await message.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get users for creating chat rooms
router.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find({
      isActive: true,
      _id: { $ne: req.user._id }
    })
    .select('name email avatar position department role')
    .sort('name');

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete/Archive chat room (only for admins)
router.delete('/rooms/:roomId', auth, async (req, res) => {
  try {
    const room = await ChatRoom.findById(req.params.roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Chat room not found' });
    }

    if (!room.admins.includes(req.user._id)) {
      return res.status(403).json({ error: 'Only room admins can delete rooms' });
    }

    room.isActive = false;
    await room.save();

    // Emit room deletion to all participants
    const io = req.app.get('io');
    if (io) {
      room.participants.forEach(participantId => {
        io.to(`user_${participantId}`).emit('room_deleted', room._id);
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat room:', error);
    res.status(500).json({ error: error.message });
  }
});

// Edit message (only sender can edit)
router.put('/messages/:messageId', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.sender.toString() !== req.user._id) {
      return res.status(403).json({ error: 'Only message sender can edit' });
    }

    message.content = content;
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email avatar position');

    // Emit message edit to all room participants
    const room = await ChatRoom.findById(message.chatRoom);
    const io = req.app.get('io');
    if (io && room) {
      room.participants.forEach(participantId => {
        io.to(`user_${participantId}`).emit('message_edited', populatedMessage);
      });
    }

    res.json(populatedMessage);
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
