const notificationModel = require('../models/notificationModel');

// Fetch user notifications
exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const notifications = await notificationModel.getNotificationsByUser(userId, limit, offset);
    const unreadCount = await notificationModel.getUnreadCountByUser(userId);

    return res.status(200).json({
      status: true,
      message: 'Notifications fetched successfully',
      unread_count: unreadCount,
      data: notifications
    });
  } catch (error) {
    console.error('Fetch Notifications Error:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch notifications' });
  }
};

// Fetch unread notifications count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const unreadCount = await notificationModel.getUnreadCountByUser(userId);
    return res.status(200).json({
      status: true,
      unread_count: unreadCount
    });
  } catch (error) {
    console.error('Fetch Unread Count Error:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch unread count' });
  }
};

// Mark single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    await notificationModel.markAsRead(id, userId);

    return res.status(200).json({
      status: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark As Read Error:', error);
    return res.status(500).json({ status: false, message: 'Failed to update notification' });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    await notificationModel.markAllAsRead(userId);

    return res.status(200).json({
      status: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark All As Read Error:', error);
    return res.status(500).json({ status: false, message: 'Failed to update notifications' });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    await notificationModel.deleteNotification(id, userId);

    return res.status(200).json({
      status: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete Notification Error:', error);
    return res.status(500).json({ status: false, message: 'Failed to delete notification' });
  }
};
