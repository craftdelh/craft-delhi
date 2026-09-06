const SellerStore = require('../models/sellerStore');
const authorizeAction = require('../utils/authorizeAction');
const { uploadToS3, getS3KeyFromUrl } = require('../utils/s3Uploader');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const { formatImageSizes } = require('../utils/imageFormatter');
const bucketName = process.env.AWS_BUCKET_NAME;

exports.updateStore = async (req, res) => {
  const userId = req.user?.id;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  if (req.user.role !== 2) {
    return res.status(403).json({ status: false, message: 'Only sellers can update store details.' });
  }

  try {
    const {
      store_name,
      store_username,
      store_link,
      description,
      store_created_date,
      business_number
    } = req.body;

    let store_image = null;

    // First check if the store exists
    SellerStore.getStoreBySellerIdforAuth(userId, async (err, existingStore) => {
      if (err) {
        console.error('MySQL error:', err);
        return res.status(500).json({ status: false, message: 'Internal server error' });
      }

      // If no store exists, create a new one first
      if (!existingStore) {
        SellerStore.createStore({ seller_id: userId }, (createErr) => {
          if (createErr) {
            return res.status(500).json({ status: false, message: 'Error creating store record' });
          }
          // Retry after creating
          return exports.updateStore(req, res);
        });
        return;
      }

      // Now authorize (store exists)
      authorizeAction(SellerStore, userId, userId, {
        getMethod: 'getStoreBySellerIdforAuth',
        ownerField: 'seller_id'
      }, async (authError) => {
        if (authError) {
          return res.status(authError.code).json({ status: false, message: authError.message });
        }

        try {
          if (req.file) {
            if (existingStore.store_image) {
              await deleteFilesFromS3([existingStore.store_image], bucketName);
            }

            const uploadedImage = await uploadToS3(req.file, 'store_image');
            store_image = typeof uploadedImage === 'object' ? JSON.stringify(uploadedImage) : uploadedImage;
          }

          const updateData = {
            store_name,
            store_username,
            store_link,
            description,
            store_created_date,
            business_number
          };

          if (store_image) updateData.store_image = store_image;

          SellerStore.updateStoreBySellerId(userId, updateData, (updateErr, result) => {
            if (updateErr) {
              console.error('MySQL error:', updateErr);
              return res.status(500).json({ status: false, message: 'Internal server error' });
            }

            if (result.affectedRows === 0) {
              return res.status(404).json({ status: false, message: 'No changes provided.' });
            }

            SellerStore.getStoreBySellerId(userId, (fetchErr, updatedStore) => {
              if (fetchErr) {
                return res.status(500).json({ status: false, message: 'Store updated, but failed to retrieve updated data.' });
              }

              if (updatedStore) {
                updatedStore.store_image = formatImageSizes(updatedStore.store_image);
              }

              return res.status(200).json({
                status: true,
                message: 'Store updated successfully.',
                updated_store: updatedStore
              });
            });
          });
        } catch (e) {
          console.error('Unexpected error:', e);
          return res.status(500).json({ status: false, message: 'Something went wrong' });
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ status: false, message: 'Unexpected server error' });
  }
};



exports.getStoreBySellerId = (req, res) => {
  const sellerId = req.user?.id;

  if (req.user.role !== 2) {
    return res.status(403).json({ status: false, message: 'Only sellers can access store details.' });
  }

  if (!sellerId || isNaN(sellerId)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  SellerStore.getStoreBySellerId(sellerId, (err, store) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (store) {
      store.store_image = formatImageSizes(store.store_image);
    }

    if (!store || !store.store_name) {
      return res.status(200).json({
        status: false,
        has_details: false,
        message: 'You need to add your store details for the first time. Please complete your store profile.',
        store: store || null
      });
    }

    return res.status(200).json({
      status: true,
      has_details: true,
      message: 'Store fetched successfully.',
      store
    });
  });
};


exports.getStoreLinkBySellerId = (req, res) => {
  const storeId = req.params.id;

  SellerStore.getStoreBySellerId(storeId, (err, store) => {
    if (err) {
      console.error('Error fetching store:', err);
      return res.status(500).json({ status: false, error: 'Internal Server Error' });
    }

    if (!store) {
      return res.status(404).json({ status: false, message: 'Store not found' });
    }

    store.store_image = formatImageSizes(store.store_image);

    // The slug and store_link are already handled in the model
    res.json({
      status: true,
      storeLink: store.store_link,
      store,
    });
  });
};

exports.getStoreBySlug = (req, res) => {
  const slug = req.params.slug;

  SellerStore.getStoreBySlug(slug, (err, store) => {
    if (err) return res.status(500).json({ status: false, error: err });
    if (!store) return res.status(404).json({ status: false, message: 'Store not found' });

    store.store_image = formatImageSizes(store.store_image);

    // Send store data (or render a view if using templating engine)
    res.json({ status: true, store });
  });
};

exports.getsellerySaleSummary = (req, res) => {
  const sellerId = req.user?.id;

  if (req.user.role !== 2) {
    return res.status(403).json({ status: false, message: 'Only sellers can access store details.' });
  }

  if (!sellerId || isNaN(sellerId)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  SellerStore.getSaleSummary(sellerId, (err, store) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!store) {
      return res.status(404).json({ status: false, message: 'summary not found for this seller' });
    }

    return res.status(200).json({
      status: true,
      message: 'Store sale summary fetched successfully.',
      store
    });
  });
};

exports.sellerProductsView = (req, res) => {
  const seller_id = req.user.id;

  if (!seller_id) {
    return res.status(403).json({ success: false, message: 'seller id not found' });
  }

  SellerStore.getAllProductsForSeller(seller_id,(err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch products', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

exports.sellerProductsViewbyID = (req, res) => {
  const product_id = req.params.product_id;
  const seller_id = req.user.id;

  if (!seller_id || !product_id) {
    return res.status(403).json({ success: false, message: 'seller id or product id not found' });
  }

  SellerStore.getAllProductsForSellerbyID(seller_id,product_id,(err, result) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch products', error: err });
    }
    res.status(200).json({ success: true, data: result });
  });
};

exports.getStore = (req, res) => {
  const store_username = req.params.store_username;

  if (!store_username) {
    return res.status(400).json({ status: false, message: 'Invalid store username' });
  }

  SellerStore.getStoreDetails(store_username, (err, store) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!store) {
      return res.status(404).json({ status: false, message: 'Store not found for this seller' });
    }

    return res.status(200).json({
      status: true,
      message: 'Store details fetched successfully.',
      store
    });
  });
};