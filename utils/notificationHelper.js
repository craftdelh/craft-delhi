const db = require('../config/db');
const notificationModel = require('../models/notificationModel');
const sendEmail = require('./mailHelper');

/**
 * Send real-time socket notification, store in DB, and optionally send email.
 * 
 * @param {Object} payload
 * @param {number} payload.userId - ID of recipient user/seller
 * @param {string} payload.title - Title of notification
 * @param {string} payload.message - Content of notification
 * @param {string} payload.type - Type e.g., 'NEW_ORDER', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'ORDER_STATUS', 'PAYMENT_RECEIVED'
 * @param {string|number} [payload.referenceId] - Associated entity ID (order_id, product_id)
 * @param {string} [payload.email] - Optional recipient email for email notifications
 * @param {boolean} [payload.sendMail=false] - Whether to send email alongside socket/DB notification
 */
const sendNotification = async ({
  userId,
  title,
  message,
  type,
  referenceId = null,
  email = null,
  sendMail = false
}) => {
  try {
    const notificationData = {
      user_id: userId,
      title,
      message,
      type,
      reference_id: referenceId ? String(referenceId) : null,
      is_read: 0
    };

    // 1️⃣ Save to Database
    const dbResult = await notificationModel.createNotification(notificationData);
    const createdNotification = {
      id: dbResult.insertId,
      ...notificationData,
      created_at: new Date()
    };

    // 2️⃣ Emit Instant Real-time Socket Event
    if (global.io) {
      // Send to specific user room: user_<userId>
      global.io.to(`user_${userId}`).emit('notification', createdNotification);
      
      // Also send general notification event with target userId
      global.io.emit('new_notification', createdNotification);

      console.log(`⚡ Instant Socket notification sent to user_${userId}: [${type}] ${title}`);
    } else {
      console.warn('⚠️ global.io is not initialized; socket notification skipped.');
    }

    // 3️⃣ Send Email if requested and email provided
    if (sendMail && email) {
      try {
        await sendEmail({
          to: email,
          subject: title,
          title: title,
          message: message,
          text: message.replace(/<[^>]*>?/gm, '')
        });
        console.log(`📧 Notification email sent to ${email}`);
      } catch (mailErr) {
        console.error(`❌ Failed to send notification email to ${email}:`, mailErr.message);
      }
    }

    return createdNotification;
  } catch (error) {
    console.error('❌ Error sending notification:', error);
    throw error;
  }
};

/**
 * Notify all admins when a seller adds a new product.
 * 
 * @param {Object} payload
 * @param {number} payload.sellerId - ID of seller who added the product
 * @param {number|string} payload.productId - ID of newly added product
 * @param {string} payload.productName - Name of newly added product
 */
const notifyAdminsNewProduct = async ({ sellerId, productId, productName }) => {
  try {
    const sellerSql = `
      SELECT u.first_name, u.last_name, ss.store_name
      FROM users u
      LEFT JOIN seller_stores ss ON ss.seller_id = u.id
      WHERE u.id = ?
    `;

    db.query(sellerSql, [sellerId], async (err, sellerRows) => {
      if (err) {
        console.error('❌ Error fetching seller details for notification:', err);
        return;
      }

      const seller = sellerRows?.[0] || {};
      const sellerName = seller.store_name || 
        (seller.first_name ? `${seller.first_name} ${seller.last_name || ''}`.trim() : `Seller #${sellerId}`);

      const adminRoleId = process.env.Admin_role_id ? Number(process.env.Admin_role_id) : 1;
      const adminSql = `SELECT id, email FROM users WHERE role = ? AND (account_trashed = 0 OR account_trashed IS NULL)`;

      db.query(adminSql, [adminRoleId], async (adminErr, adminRows) => {
        if (adminErr) {
          console.error('❌ Error fetching admin users for notification:', adminErr);
          return;
        }

        if (!adminRows || adminRows.length === 0) {
          console.warn('⚠️ No admin users found to notify for new product.');
          return;
        }

        for (const admin of adminRows) {
          try {
            await sendNotification({
              userId: admin.id,
              title: 'New Product Added',
              message: `${sellerName} has added a new product "${productName}". Please review to approve or reject it.`,
              type: 'NEW_PRODUCT_ADDED',
              referenceId: String(productId),
              email: admin.email,
              sendMail: false
            });
          } catch (notifErr) {
            console.error(`❌ Failed to notify admin ${admin.id}:`, notifErr.message);
          }
        }

        // 🔊 Emit real-time socket events for admin UI
        if (global.io) {
          global.io.emit('newProductAdded', {
            product_id: productId,
            seller_id: sellerId,
            seller_name: sellerName,
            name: productName
          });

          try {
            const adminModel = require('../models/adminModel');
            adminModel.getDashboardStats((statsErr, stats) => {
              if (!statsErr && stats) {
                global.io.emit('dashboardStatsUpdate', stats);
              }
            });
          } catch (mErr) {
            console.error('Error updating dashboard stats socket:', mErr);
          }
        }
      });
    });
  } catch (error) {
    console.error('❌ Error in notifyAdminsNewProduct:', error);
  }
};

/**
 * Notify all admins when a new seller registers on Craft Delhi.
 * 
 * @param {Object} payload
 * @param {number|string} payload.sellerId - User/seller ID
 * @param {string} payload.firstName - Seller first name
 * @param {string} payload.lastName - Seller last name
 * @param {string} payload.email - Seller email
 */
const notifyAdminsNewSeller = async ({ sellerId, firstName, lastName, email }) => {
  try {
    const sellerName = `${firstName || ''} ${lastName || ''}`.trim() || email || `Seller #${sellerId}`;
    const adminRoleId = process.env.Admin_role_id ? Number(process.env.Admin_role_id) : 1;
    const adminSql = `SELECT id, email FROM users WHERE role = ? AND (account_trashed = 0 OR account_trashed IS NULL)`;

    db.query(adminSql, [adminRoleId], async (adminErr, adminRows) => {
      if (adminErr) {
        console.error('❌ Error fetching admin users for new seller notification:', adminErr);
        return;
      }

      if (!adminRows || adminRows.length === 0) {
        console.warn('⚠️ No admin users found to notify for new seller registration.');
        return;
      }

      for (const admin of adminRows) {
        try {
          await sendNotification({
            userId: admin.id,
            title: 'New Seller Registered',
            message: `${sellerName} (${email}) has joined as a new seller. Please review to approve or reject their account.`,
            type: 'NEW_SELLER_JOINED',
            referenceId: String(sellerId),
            email: admin.email,
            sendMail: false
          });
        } catch (notifErr) {
          console.error(`❌ Failed to notify admin ${admin.id} for new seller:`, notifErr.message);
        }
      }

      // 🔊 Emit real-time socket events for admin UI
      if (global.io) {
        global.io.emit('newSellerJoined', {
          seller_id: sellerId,
          first_name: firstName,
          last_name: lastName,
          email
        });

        try {
          const adminModel = require('../models/adminModel');
          adminModel.getDashboardStats((statsErr, stats) => {
            if (!statsErr && stats) {
              global.io.emit('dashboardStatsUpdate', stats);
            }
          });
        } catch (mErr) {
          console.error('Error updating dashboard stats socket:', mErr);
        }
      }
    });
  } catch (error) {
    console.error('❌ Error in notifyAdminsNewSeller:', error);
  }
};

module.exports = {
  sendNotification,
  notifyAdminsNewProduct,
  notifyAdminsNewSeller
};
