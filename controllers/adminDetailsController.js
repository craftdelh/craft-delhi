const adminModel = require('../models/adminModel');
const Settlement = require('../models/settlementModel');
require('dotenv').config();
const { uploadToS3, getS3KeyFromUrl } = require('../utils/s3Uploader');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const { checkPaymentProcessedForDelivery } = require('../utils/updateUtils');
const sendEmail = require('../utils/mailHelper'); // adjust path as per your project
const { sendNotification } = require('../utils/notificationHelper');

exports.getDashboardStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getDashboardStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.getTotalusers = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getTotalusers((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.getProductsStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getProductsStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.getTotalProducts = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getTotalProducts((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, message: "Product fetched succesfully", data: stats });
    });
};

exports.adminProductsView = (req, res) => {
  const role = req.user.role;

  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  adminModel.getAllProductsForAdmin((err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch products', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

// adminController.js
exports.updateApprovalStatus = (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { status, reject_reason, reject_description } = req.body;
  const { product_id } = req.params;

  if (![0, 1, 2].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Use 1 (Approve) or 2 (Reject).'
    });
  }

  adminModel.updateProductApprovalStatus(product_id, status, (err, result) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update status',
        error: err
      });
    }

    // ------------------------------------------
    // 📩 SEND EMAIL & REALTIME SOCKET NOTIFICATION WHEN APPROVED OR REJECTED
    // ------------------------------------------
    adminModel.getSellerDetailsByProductID(product_id, async (err2, sellerData) => {
      if (!err2 && sellerData?.email) {
        const { seller_id, email, first_name, last_name, product_name } = sellerData;
        const sellerName = `${first_name} ${last_name}`;

        // If REJECTED
        if (status === 2) {
          if (seller_id) {
            await sendNotification({
              userId: seller_id,
              title: "Product Rejected",
              message: `Your product "${product_name || 'Item'}" was rejected. Reason: ${reject_reason || 'Not specified'}.`,
              type: "PRODUCT_REJECTED",
              referenceId: product_id
            }).catch(e => console.error("Notification trigger error:", e));
          }

          try {
            await sendEmail({
              to: email,
              subject: "Your Product Has Been Rejected",
              title: "Product Rejected",
              message: `
                Hello, ${sellerName}<br><br>
                Your product <b>${product_name}</b> has been <span style="color:red;">Rejected</span>.<br><br>

                <b>Reason:</b> ${reject_reason || "Not provided"}<br>
                <b>Description:</b> ${reject_description || "Not provided"}<br><br>

                Please contact support for clarification.<br><br>

                Regards,<br>
                <b>Team Craft Delhi</b>
              `,
              text: `Your product was rejected.\nReason: ${reject_reason}\nDescription: ${reject_description}`
            });
          } catch (e) {
            console.log("Failed to send rejection email:", e);
          }
        }

        // If APPROVED
        if (status === 1) {
          if (seller_id) {
            await sendNotification({
              userId: seller_id,
              title: "Product Approved",
              message: `Your product "${product_name || 'Item'}" has been approved by admin and is now live!`,
              type: "PRODUCT_APPROVED",
              referenceId: product_id
            }).catch(e => console.error("Notification trigger error:", e));
          }

          try {
            await sendEmail({
              to: email,
              subject: "Your Product Has Been Approved",
              title: "Product Approved",
              message: `
                Hello, ${sellerName}<br><br>
                Your product <b>${product_name}</b> has been Approved and is now live.<br><br>

                Regards,<br>
                <b>Team Craft Delhi</b>
              `,
              text: `Your product was approved and is now live.`
            });
          } catch (e) {
            console.log("Failed to send approval email:", e);
          }
        }
      }
    });

    // ------------------------------------------
    // 🔊 SOCKET UPDATES
    // ------------------------------------------
    if (global.io) {
      global.io.emit('productApprovalStatusUpdated', { product_id, status });

      adminModel.getDashboardStats((err, stats) => {
        if (!err && stats) {
          global.io.emit('dashboardStatsUpdate', stats);
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully'
    });
  });
};


exports.getBuyerStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getBuyerStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.adminBuyersView = (req, res) => {
  const role = req.user.role;

  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  adminModel.getAllBuyersForAdmin((err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch Buyers', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

exports.updateBuyerbyAdmin = (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { user_id } = req.body;
  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ success: false, message: 'Invalid User ID' });
  }

      // Build updateData dynamically
      const updateData = { ...req.body };

      // Call model to update only provided fields
      adminModel.updateBuyerDetailsByAdmin(user_id, updateData, (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Failed to update Buyer details' });
        res.status(200).json({ success: true, message: 'Buyer details updated successfully' });
      });
}

exports.updateBuyerSellerStatus = async (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { user_id, user_status, trash_reason, trash_description } = req.body;

  // Always update status FIRST
  adminModel.updateBuyerStatus(user_id, user_status, async (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to update status", error: err });
    }

    // If account is trashed, send email
    if (user_status == 2) {
      adminModel.getUserEmail(user_id, async (err2, result) => {
        if (err2) {
          return res
            .status(500)
            .json({ success: false, message: "Failed to fetch user email", error: err2 });
        }

        const {email, first_name, last_name} = result;

        if (email) {
          try {
            await sendEmail({
              to: email,
              subject: "Your Account Has Been Marked as Trashed",
              title: "Account Trashed Notification",
              message: `
                Hello, ${first_name}${last_name}<br><br>
                Your account has been marked as <b>Trashed</b> on Craft Delhi.<br><br>

                <b>Reason:</b> ${trash_reason}<br>
                <b>Description:</b> ${trash_description}<br><br>

                If you believe this was a mistake or want to discuss further,<br>
                please contact our support team.<br><br>

                Regards,<br>
                <b>Team Craft Delhi</b>
              `,
              text: `Your account has been trashed.\nReason: ${trash_reason}\nDescription: ${trash_description}`
            });
          } catch (error) {
            console.log("Failed to send trashed email:", error);
          }
        }

        // Send final response AFTER everything
        return res.status(200).json({
          success: true,
          message: "Status updated & email sent (if applicable)",
        });
      });
    } else {
      // Normal flow → Only status update
      return res.status(200).json({
        success: true,
        message: "Status updated successfully",
      });
    }
  });
};



exports.getSellersStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getSellerStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.adminSellersView = (req, res) => {
  const role = req.user.role;

  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  adminModel.getAllSellersForAdmin((err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch Buyers', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

// adminController.js
exports.updateSellerbyAdmin = (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { user_id } = req.body;
  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ success: false, message: 'Invalid seller ID' });
  }

  // Get existing images for deletion if new ones are uploaded
  adminModel.getSellerImages(user_id, async (err, sellerImages) => {
    if (err) return res.status(500).json({ success: false, message: 'Failed to fetch seller images' });
    if (!sellerImages) return res.status(404).json({ success: false, message: 'Seller not found' });
    try {
      let profile_image_url = undefined;
      let store_image_url = undefined;

      // Handle profile_image
      if (req.files?.profile_image?.[0]) {
        if (sellerImages.profile_image) {
          const oldKey = getS3KeyFromUrl(sellerImages.profile_image);
          if (oldKey) await deleteFilesFromS3([oldKey], process.env.AWS_BUCKET_NAME);
        }
        profile_image_url = await uploadToS3(req.files.profile_image[0], 'profile_images');
      }

      // Handle store_image
      if (req.files?.store_image?.[0]) {
        if (sellerImages.store_image) {
          const oldKey = getS3KeyFromUrl(sellerImages.store_image);
          if (oldKey) await deleteFilesFromS3([oldKey], process.env.AWS_BUCKET_NAME);
        }
        store_image_url = await uploadToS3(req.files.store_image[0], 'store_images');
      }

      // Build updateData dynamically
      const updateData = { ...req.body };
      if (profile_image_url) updateData.profile_image = profile_image_url;
      if (store_image_url) updateData.store_image = store_image_url;

      // Call model to update only provided fields
      adminModel.updateSellerDetailsByAdmin(user_id, updateData, (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Failed to update seller details' });
        res.status(200).json({ success: true, message: 'Seller details updated successfully' });
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Image upload/update failed' });
    }
  });
};

exports.updateSellerStatus = async (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  const { seller_id, user_approval, reject_reason, reject_description } = req.body;

  // Validate status (1 = Approve, 2 = Reject)
  if (![1, 2].includes(user_approval)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Use 1 (Approve) or 2 (Reject).",
    });
  }

  // Always update status FIRST
  adminModel.updateSellerApprovalStatus(
    seller_id,
    user_approval,
    async (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to update seller status",
          error: err,
        });
      }

      // If seller is rejected → send email
      if (user_approval === 2) {
        adminModel.getUserEmail(seller_id, async (err2, result) => {
          if (err2) {
            return res.status(500).json({
              success: false,
              message: "Failed to fetch seller email",
              error: err2,
            });
          }

          const { email, first_name, last_name } = result;

          if (email) {
            try {
              await sendEmail({
                to: email,
                subject: "Your Seller Account Has Been Rejected",
                title: "Seller Account Rejected",
                message: `
                  Hello, ${first_name} ${last_name},<br><br>
                  Your seller account has been <b>Rejected</b> on Craft Delhi.<br><br>

                  <b>Reason:</b> ${reject_reason}<br>
                  <b>Description:</b> ${reject_description}<br><br>

                  If you think this decision was incorrect or want further clarity,<br>
                  please contact our support team.<br><br>

                  Regards,<br>
                  <b>Team Craft Delhi</b>
                `,
                text: `Your seller account has been rejected.\nReason: ${reject_reason}\nDescription: ${reject_description}`,
              });
            } catch (emailError) {
              console.log("Failed to send seller rejection email:", emailError);
            }
          }

          // Final response after email attempts
          return res.status(200).json({
            success: true,
            message: "Status updated & email sent (if applicable)",
          });
        });
      } else {
        // Seller Approved → Only update status
        return res.status(200).json({
          success: true,
          message: "Seller status updated successfully",
        });
      }
    }
  );
};


exports.deleteSellerAccount = (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  const seller_id = parseInt(req.params.seller_id, 10);
  if (!seller_id) {
    return res.status(400).json({ success: false, message: "Seller ID is required" });
  }

  // Step 1: Get seller images
  adminModel.getSellerImages(seller_id, async (err, sellerImages) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Failed to fetch seller images", error: err });
    }

    // Step 2: Delete images from S3
    try {
      const keysToDelete = [];
      if (sellerImages?.profile_image) {
        const key = getS3KeyFromUrl(sellerImages.profile_image);
        if (key) keysToDelete.push(key);
      }
      if (sellerImages?.store_image) {
        const key = getS3KeyFromUrl(sellerImages.store_image);
        if (key) keysToDelete.push(key);
      }

      if (keysToDelete.length > 0) {
        await deleteFilesFromS3(keysToDelete, process.env.AWS_BUCKET_NAME);
      }
    } catch (s3Err) {
      return res.status(500).json({ success: false, message: "Failed to delete images from S3", error: s3Err });
    }

    // Step 3: Delete seller data from DB
    adminModel.deleteSellerData(seller_id, (dbErr) => {
      if (dbErr) {
        return res.status(500).json({ success: false, message: "Failed to delete seller data", error: dbErr });
      }
      res.status(200).json({ success: true, message: "Seller account deleted successfully" });
    });
  });
};

exports.getOrderStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getOrderStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.adminOrdersView = (req, res) => {
  const role = req.user.role;

  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  adminModel.getAllOrdersForAdmin((err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch Buyers', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

exports.adminOrderStatusUpdate = async (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const { order_status, order_id, payment_status } = req.body;

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  // Validate order_status (if provided)
  if (order_status !== undefined && ![0, 1, 2, 3, 4].includes(order_status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid order_status. Use 0=Pending, 1=Accepted, 2=Out for Delivery, 3=Delivered, 4=Cancelled'
    });
  }

  // Validate payment_status (if provided)
  if (payment_status !== undefined && ![0, 1, 2].includes(payment_status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment_status. Use 0=Pending, 1=Paid, 2=Refund'
    });
  }

  // Ensure at least one field is being updated
  if (order_status === undefined && payment_status === undefined) {
    return res.status(400).json({ success: false, message: 'No status field provided to update' });
  }

  if (order_status !== undefined && [2, 3].includes(Number(order_status))) {
    const isPaid = await checkPaymentProcessedForDelivery(order_id, payment_status);
    if (!isPaid) {
      const statusLabel = Number(order_status) === 2 ? 'Out for Delivery' : 'Delivered';
      return res.status(400).json({
        success: false,
        message: `Cannot mark order as ${statusLabel} because the payment is not processed/paid. Payment status must be Paid (1).`
      });
    }
  }

  // Update
  adminModel.updateOrderStatus(order_id, { order_status, payment_status }, (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to update order status', error: err });
    }

    res.status(200).json({ success: true, message: 'Order status updated successfully' });
  });
};

exports.deleteOrderbyAdmin = (req, res) => {
  const role = req.user.role;
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const order_id = req.params.order_id;

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  adminModel.deleteOrderbyAdmin(order_id, (err, result) => {
    if (err) {
      return res.status(500).json({ status: false, message: 'Failed to delete order', error: err });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: 'Order not found' });
    }

    res.json({
      status: true,
      message: "Order and related items deleted successfully"
    });
  });
};

exports.getRevenueStats = (req, res) => {
  const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    adminModel.getRevenueStats((err, stats) => {
      if (err) return res.status(500).json({ status: false, error: err });
      res.json({ status: true, data: stats });
    });
};

exports.adminRevenueView = (req, res) => {
  const role = req.user.role;

  // Check admin authorization
  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  // Get query parameters (optional)
  const { year, month } = req.query;

  // Default year = current year
  const selectedYear = year || new Date().getFullYear();
  const selectedMonth = month ? parseInt(month) : null;

  // Call model function with year & month
  adminModel.getRevenueDetailsForAdmin(selectedYear, selectedMonth, (err, result) => {
    if (err) {
      console.error('Error fetching revenue details:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch revenue details',
        error: err,
      });
    }

    res.status(200).json({
      success: true,
      type: selectedMonth ? 'monthly' : 'yearly',
      year: selectedYear,
      ...(selectedMonth && { month: selectedMonth }),
      total_records: result.length,
      data: result,
    });
  });
};

exports.createBanner = async (req, res) => {
  try {
    const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { title, type, status } = req.body;
    

    if (!title || !type) {
      return res.status(400).json({
        success: false,
        message: "Title and type are required",
      });
    }

    if (!req.files?.banner?.[0]) {
      return res.status(400).json({
        success: false,
        message: "Banner file is required",
      });
    }

    const file = req.files.banner[0];

    // Upload to S3
    const bannerUrl = await uploadToS3(file, "banner");

    const bannerData = {
      title,
      banner: bannerUrl,
      type,
      status: status ?? 1,
      position: 0,
    };

    adminModel.createBanner(bannerData, (err, result) => {
      if (err) {
        console.error("Create banner error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to create banner",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Banner created successfully",
        data: {
          id: result.insertId,
          ...bannerData,
        },
      });
    });
  } catch (error) {
    console.error("Create banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { banner_id } = req.params;
    const { title, type, status, position } = req.body;
    adminModel.getBannerByID(banner_id, async (err, banner) => {
      if (err) {
        console.error("Fetch banner error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch banner",
        });
      }

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: "Banner not found",
        });
      }

      let bannerUrl = banner.banner;

      // 2️⃣ Replace banner file if uploaded
      if (req.files?.banner?.[0]) {
        const file = req.files.banner[0];
        if (banner.banner) {
          try {
            await deleteFilesFromS3(
              [banner.banner],                 // mediaUrls array
              process.env.AWS_BUCKET_NAME
            );
          } catch (err) {
            console.error("S3 delete error:", err);
          }
        }
        bannerUrl = await uploadToS3(file, "banner");
      }
      const updateData = {
        title,
        banner: bannerUrl,
        type,
        status,
        position:
          position !== undefined ? Number(position) : undefined,
      };
      adminModel.updateBannerByID(banner_id, updateData, (err, result) => {
        if (err) {
          console.error("Update banner error:", err);
          return res.status(500).json({
            success: false,
            message: "Failed to update banner",
          });
        }

        if (result.affectedRows === 0) {
          return res.status(200).json({
            success: true,
            message: "No changes applied",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Banner updated successfully",
        });
      });
    });
  } catch (error) {
    console.error("Update banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};



exports.getBannerByID = (req, res) => {
  const { banner_id } = req.params;

  adminModel.getBannerByID(banner_id, (err, banner) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch banner",
      });
    }

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: "Banner not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: banner,
    });
  });
};

exports.getAdminProfileDetails = (req, res) => {
  const user_id = req.user?.id;
  const role = req.user?.role;
  if(role != process.env.Admin_role_id){
    return res.status(403).json({
      success: false,
      message: "you are not admin",
    });
  }
  adminModel.getAdminDetails(user_id,(err, Details) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch Details",
      });
    }

    return res.status(200).json({
      success: true,
      data: Details,
    });
  });
};

exports.getBanners = (req, res) => {
  adminModel.getActiveBanners((err, banners) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch banners",
      });
    }

    return res.status(200).json({
      success: true,
      data: banners,
    });
  });
};

exports.deleteBanner = async (req, res) => {
  try {
    const role = req.user.role;
    if (role != process.env.Admin_role_id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { banner_id } = req.params;

    // 1️⃣ Fetch banner first (for S3 cleanup)
    adminModel.getBannerByID(banner_id, async (err, banner) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch banner",
        });
      }

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: "Banner not found",
        });
      }
      if (banner.banner) {
        try {
          await deleteFilesFromS3(
            [banner.banner],
            process.env.AWS_BUCKET_NAME
          );
        } catch (err) {
          console.error("S3 delete error:", err);
          // Optional: stop deletion if S3 fails
        }
      }

      // 3️⃣ Delete banner record from DB
      adminModel.deleteBannerByID(banner_id, (err, result) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "Failed to delete banner",
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: "Banner not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Banner deleted successfully",
        });
      });
    });
  } catch (error) {
    console.error("Delete banner error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.getAdminSettlements = (req, res) => {
  const role = req.user.role;

  if (role != process.env.Admin_role_id) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  Settlement.getSettlementsForAdmin((err, settlements) => {
    if (err) {
      console.error('Error fetching settlements for admin:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch settlements',
        error: err
      });
    }

    res.status(200).json({
      success: true,
      total_records: settlements.length,
      data: settlements
    });
  });
};


