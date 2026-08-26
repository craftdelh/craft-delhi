const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyTokenforactions } = require('../utils/authMiddleware');

// All notification routes require authentication
router.use(verifyTokenforactions);

// Fetch user notifications
router.get('/', notificationController.getUserNotifications);

// Fetch unread count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark single notification as read
router.put('/:id/read', notificationController.markAsRead);

// Mark all notifications as read
router.put('/read-all', notificationController.markAllAsRead);

// Delete single notification
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
