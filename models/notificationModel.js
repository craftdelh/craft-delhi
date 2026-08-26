const db = require('../config/db');

// Ensure table exists on initialization
const initNotificationTable = () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL,
      reference_id VARCHAR(100) DEFAULT NULL,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_is_read (is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  db.query(sql, (err) => {
    if (err) {
      console.error('❌ Failed to initialize notifications table:', err.message);
    } else {
      console.log('✅ Notifications table initialized');
    }
  });
};

initNotificationTable();

exports.createNotification = (data) => {
  return new Promise((resolve, reject) => {
    const query = 'INSERT INTO notifications SET ?';
    db.query(query, data, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.getNotificationsByUser = (userId, limit = 20, offset = 0) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;
    db.query(sql, [userId, Number(limit), Number(offset)], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.getUnreadCountByUser = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0`;
    db.query(sql, [userId], (err, results) => {
      if (err) return reject(err);
      resolve(results[0]?.unread_count || 0);
    });
  });
};

exports.markAsRead = (id, userId) => {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`;
    db.query(sql, [id, userId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.markAllAsRead = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE notifications SET is_read = 1 WHERE user_id = ?`;
    db.query(sql, [userId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

exports.deleteNotification = (id, userId) => {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM notifications WHERE id = ? AND user_id = ?`;
    db.query(sql, [id, userId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};
