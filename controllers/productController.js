const productModel = require('../models/productModel');
const categoryModel = require('../models/categoryModel');
const slugify = require('slugify');
const { uploadToS3, getS3KeyFromUrl  } = require('../utils/s3Uploader');
const authorizeAction = require('../utils/authorizeAction');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const { formatImageSizes, formatGalleryImages } = require('../utils/imageFormatter');
const { notifyAdminsNewProduct, notifyAdminsProductUpdated } = require('../utils/notificationHelper');
const bucketName = process.env.AWS_BUCKET_NAME;

exports.deleteProduct = (req, res) => {
  const { product_id } = req.params;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!product_id) {
    return res.status(400).json({ status: false, message: 'Product ID is required' });
  }

  // ✅ If admin, skip ownership check and still delete media
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return productModel.getProductbyID(parseInt(product_id), userId, async (err, product) => {
      if (err || !product) {
        return res.status(404).json({ status: false, message: 'Product not found' });
      }
      await deleteMediaAndProduct(product, product_id, res);
    });
  }
  // Seller: must own the product
  authorizeAction(productModel, parseInt(product_id), userId, {
    getMethod: 'getProductbyIDforVerification',
    ownerField: 'seller_id'
  }, async (authError, product) => {
    if (authError) {
      return res.status(authError.code).json({ status: false, message: authError.message });
    }
    await deleteMediaAndProduct(product, product_id, res);
  });
};


async function deleteMediaAndProduct(product, product_id, res) {
  const mediaUrls = [];

  // Add main, video, reel URLs if available
  if (product.main_image_url) mediaUrls.push(product.main_image_url);
  if (product.video_url) mediaUrls.push(product.video_url);
  if (product.reel_url) mediaUrls.push(product.reel_url);

  // ✅ Handle gallery_images safely (string, array, or null)
  if (product.gallery_images) {
    try {
      let gallery = [];

      if (Array.isArray(product.gallery_images)) {
        // Already parsed JSON array
        gallery = product.gallery_images;
      } else if (typeof product.gallery_images === 'string') {
        const raw = product.gallery_images.trim();

        if (raw.startsWith('[') && raw.endsWith(']')) {
          // Proper JSON array string
          gallery = JSON.parse(raw);
        } else if (raw.includes(',')) {
          // Comma-separated URLs
          gallery = raw.split(',').map(url => url.trim());
        } else if (raw.startsWith('http')) {
          // Single URL
          gallery = [raw];
        }
      }

      if (Array.isArray(gallery) && gallery.length > 0) {
        mediaUrls.push(...gallery);
      }
    } catch (err) {
      console.error('Failed to parse gallery_images:', err.message);
    }
  }

  // Delete files from S3
  try {
    const result = await deleteFilesFromS3(mediaUrls, bucketName);
    console.log('S3 deletion result:', result);
  } catch (err) {
    console.error('S3 deletion failed, proceeding with DB delete anyway');
  }

  // Proceed with DB deletion
  proceedWithDeletion(product_id, res);
}



function proceedWithDeletion(product_id, res) {
  productModel.deleteProductID(product_id, (err, result) => {
    if (err) {
      return res.status(500).json({ status: false, message: 'Error deleting product', error: err });
    }

    if (result.affectedRows > 0) {
      return res.status(200).json({ status: true, message: 'Product and media deleted successfully' });
    } else {
      return res.status(400).json({ status: false, message: 'Product deletion failed' });
    }
  });
}




exports.addProduct = async (req, res) => {
  try {
    const {
      name, description, price, category_id,
      stock, dimension, package_weight,
      weight_type, warranty_type,
      video_name, // from req.body
      reel_name,   // from req.body
      hashtags 
    } = req.body;

    const seller_id = req.user.id;

    if (!name || !price || !category_id || !seller_id) {
      return res.status(400).json({
        status: false,
        error: 'Name, price, seller_id, and category_id are required.'
      });
    }

    const resolvedCatId = await categoryModel.resolveCategoryId(category_id);
    if (!resolvedCatId) {
      return res.status(400).json({
        status: false,
        error: `Invalid category: '${category_id}' not found`
      });
    }

    // 🧮 Convert price: handle single or comma-separated prices
    let finalPrice;
    if (typeof price === "string" && price.includes(',')) {
      finalPrice = price
        .split(',')
        .map(p => {
          const num = Number(p.trim());
          return isNaN(num) ? 0 : num - 1;
        })
        .join(',');
    } else {
      const num = Number(price);
      finalPrice = isNaN(num) ? 0 : num - 1;
    }

    // Generate SKU/Slug from product name and timestamp
    const timestamp = Date.now();
    const baseSlug = slugify(name, { lower: true, strict: true }) || 'product';
    const product_sku = `${baseSlug}-${timestamp}`;
    let productHashtags = [];

    if (hashtags) {
      if (Array.isArray(hashtags)) {
        productHashtags = hashtags
          .map(tag => tag.replace(/"/g, '').trim()) // remove extra quotes
          .filter(Boolean);

      } else if (typeof hashtags === "string") {
        try {
          // Try parsing if it's JSON string
          const parsed = JSON.parse(hashtags);
          if (Array.isArray(parsed)) {
            productHashtags = parsed
              .map(tag => tag.replace(/"/g, '').trim())
              .filter(Boolean);
          } else {
            productHashtags = hashtags
              .split(',')
              .map(tag => tag.replace(/"/g, '').trim())
              .filter(Boolean);
          }
        } catch (err) {
          // fallback if not JSON
          productHashtags = hashtags
            .split(',')
            .map(tag => tag.replace(/"/g, '').trim())
            .filter(Boolean);
        }
      }
    }

    // Upload assets to S3
    let mainImage = null;
    let galleryImages = [];
    let videoUrl = null;
    let reelUrl = null;

    if (req.files['main_image']?.[0]) {
      const uploadedMain = await uploadToS3(req.files['main_image'][0], 'main_image');
      mainImage = typeof uploadedMain === 'object' ? JSON.stringify(uploadedMain) : uploadedMain;
    }

    if (req.files['gallery_images']) {
      galleryImages = await Promise.all(
        req.files['gallery_images'].map(file => uploadToS3(file, 'gallery_images'))
      );
    }

    if (req.files['product_video']?.[0]) {
      videoUrl = await uploadToS3(req.files['product_video'][0], 'product_video');
    }

    if (req.files['product_reel']?.[0]) {
      reelUrl = await uploadToS3(req.files['product_reel'][0], 'product_reel');
    }

    const productData = {
      name,
      product_sku,
      description,
      price: finalPrice, // 👈 use modified price here
      category_id: resolvedCatId,
      stock,
      dimension,
      package_weight,
      weight_type,
      warranty_type,
      main_image_url: mainImage,
      gallery_images: JSON.stringify(galleryImages),
      video_url: videoUrl,
      reel_url: reelUrl,
      video_name, // from req.body
      reel_name,  // from req.body
      seller_id,
      hashtags: JSON.stringify(productHashtags),
      status: 1 // default true
    };

    const insertResult = await productModel.insert(productData);

    // 🔔 Notify admin users about new product added by seller
    notifyAdminsNewProduct({
      sellerId: seller_id,
      productId: insertResult?.insertId,
      productName: name
    }).catch(err => console.error('Failed to notify admins of new product:', err));

    res.status(200).json({
      status: true,
      message: 'Product added successfully',
      product_sku,
      finalPrice
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ status: false, error: 'Something went wrong' });
  }
};



exports.getProducts = (req, res) => {
  // If token exists, get id, else set to null
  const id = req.user ? req.user.id : null;

  productModel.getallProducts(id, (err, products) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }

    const formatted = (products || []).map(p => ({
      ...p,
      main_image_url: formatImageSizes(p.main_image_url),
      gallery_images: formatGalleryImages(p.gallery_images)
    }));

    return res.status(200).json({
      status: true,
      message: 'Products fetched successfully',
      data: formatted
    });
  });
};

exports.getProductsbySlug = (req, res) => {
  const id = req.user ? req.user.id : null;  
  const { slug } = req.params;

  if (!slug) {
    return res.status(400).json({ status: false, message: 'Product slug is required' });
  }

  productModel.getProductbySlug(slug, id, (err, product) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }

    if (!product) {
      return res.status(404).json({ status: false, message: 'Product not found' });
    }

    const formatted = {
      ...product,
      main_image_url: formatImageSizes(product.main_image_url),
      gallery_images: formatGalleryImages(product.gallery_images)
    };

    return res.status(200).json({
      status: true,
      message: 'Product fetched successfully',
      data: formatted
    });
  });
};

exports.getProductRecommendations = (req, res) => {
  const { slug } = req.params;
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 12)
    : 8;

  if (!slug) {
    return res.status(400).json({ status: false, message: 'Product slug is required' });
  }

  productModel.getRecommendationsBySlug(slug, limit, (err, products) => {
    if (err) {
      console.error('Recommendation DB Error:', err);
      return res.status(500).json({ status: false, message: 'Failed to fetch recommendations' });
    }

    const formatted = (products || []).map(p => ({
      ...p,
      main_image_url: formatImageSizes(p.main_image_url),
      gallery_images: formatGalleryImages(p.gallery_images)
    }));

    return res.status(200).json({
      status: true,
      message: 'Product recommendations fetched successfully',
      data: formatted
    });
  });
};

exports.updateProduct = async (req, res) => {
  const { product_id } = req.params;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!product_id) {
    return res.status(400).json({ status: false, message: 'Product ID is required' });
  }

  // 🔹 Admin bypasses ownership check
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return productModel.getProductbyIDforVerify(product_id, async (err, existingProduct) => {
      if (err || !existingProduct) {
        return res.status(404).json({ status: false, message: 'Product not found' });
      }
      await handleProductUpdate(existingProduct, product_id, req, res);
    });
  }

  // 🔹 Seller must own the product
  authorizeAction(
    productModel,
    product_id,
    userId,
    { getMethod: 'getProductbyIDforVerification', ownerField: 'seller_id' },
    async (authError, existingProduct) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }
      await handleProductUpdate(existingProduct, product_id, req, res);
    }
  );
};

// 🔄 Separated logic so both Admin and Seller use same update process
async function handleProductUpdate(existingProduct, product_id, req, res) {
  try {
    const {
      name,
      description,
      price,
      category_id,
      stock,
      dimension,
      package_weight,
      weight_type,
      warranty_type,
      main_image_url,
      video_url,
      video_name,
      reel_name,
      reel_url,
      status,
      hashtags  
    } = req.body || {};

    let resolvedCategoryId = category_id;
    if (category_id !== undefined && category_id !== null && category_id !== '') {
      resolvedCategoryId = await categoryModel.resolveCategoryId(category_id);
      if (!resolvedCategoryId) {
        return res.status(400).json({
          status: false,
          message: `Invalid category: '${category_id}' not found`
        });
      }
    }

    const isSeller = req.user?.role !== parseInt(process.env.Admin_role_id);

    const updateData = {
      name, description, price, category_id: resolvedCategoryId, stock,
      dimension, package_weight, weight_type, warranty_type, video_name, reel_name, status
    };

    // 🔒 If updated by a seller, reset admin_approval to 0 (requires admin re-approval)
    if (isSeller) {
      updateData.admin_approval = 0;
    }
    if (hashtags !== undefined) {
      let updatedHashtags = [];

      try {
        if (Array.isArray(hashtags)) {
          updatedHashtags = hashtags.map(h => h.trim()).filter(Boolean);
        } else if (typeof hashtags === "string") {
          if (hashtags.startsWith("[") && hashtags.endsWith("]")) {
            updatedHashtags = JSON.parse(hashtags);
          } else {
            updatedHashtags = hashtags
              .split(',')
              .map(h => h.trim())
              .filter(Boolean);
          }
        }
      } catch (err) {
        console.error("Hashtag parse error:", err);
      }

      updateData.hashtags = JSON.stringify(updatedHashtags);
    }

    // 🖼️ Gallery images
    if (req.files?.gallery_images) {
      try {
        const oldGallery = JSON.parse(existingProduct.gallery_images || '[]');
        if (Array.isArray(oldGallery)) {
          await deleteFilesFromS3(oldGallery, bucketName);
        }
      } catch (err) {
        console.error('Failed to parse existing gallery_images for deletion:', err.message);
      }

      const uploadedGallery = await Promise.all(
        req.files.gallery_images.map(f => uploadToS3(f, 'gallery_images'))
      );
      updateData.gallery_images = JSON.stringify(uploadedGallery);
    } else if (req.body.gallery_images) {
      try {
        const newGallery = JSON.parse(req.body.gallery_images);
        const oldGallery = JSON.parse(existingProduct.gallery_images || '[]');
        const toDelete = oldGallery.filter(url => !newGallery.includes(url));
        if (toDelete.length) await deleteFilesFromS3(toDelete, bucketName);
        updateData.gallery_images = JSON.stringify(newGallery);
      } catch (err) {
        console.error('Gallery parsing error (fallback):', err.message);
      }
    }

    // 📷 Main image
    if (req.files?.main_image?.[0]) {
      if (existingProduct.main_image_url) {
        await deleteFilesFromS3([existingProduct.main_image_url], bucketName);
      }
      const uploadedMain = await uploadToS3(req.files.main_image[0], 'main_image');
      updateData.main_image_url = typeof uploadedMain === 'object' ? JSON.stringify(uploadedMain) : uploadedMain;
    } else if (main_image_url && main_image_url !== existingProduct.main_image_url) {
      await deleteFilesFromS3([existingProduct.main_image_url], bucketName);
      updateData.main_image_url = main_image_url;
    }

    // 📹 Product video
    if (req.files?.product_video?.[0]) {
      if (existingProduct.video_url) {
        await deleteFilesFromS3([existingProduct.video_url], bucketName);
      }
      updateData.video_url = await uploadToS3(req.files.product_video[0], 'product_video');
    } else if (video_url && video_url !== existingProduct.video_url) {
      await deleteFilesFromS3([existingProduct.video_url], bucketName);
      updateData.video_url = video_url;
    }

    // 🎞️ Product reel
    if (req.files?.product_reel?.[0]) {
      if (existingProduct.reel_url) {
        await deleteFilesFromS3([existingProduct.reel_url], bucketName);
      }
      updateData.reel_url = await uploadToS3(req.files.product_reel[0], 'product_reel');
    } else if (reel_url && reel_url !== existingProduct.reel_url) {
      await deleteFilesFromS3([existingProduct.reel_url], bucketName);
      updateData.reel_url = reel_url;
    }

    // ✅ Update DB
    productModel.updateProductByID(product_id, updateData, (err, result) => {
      if (err) {
        console.error('DB update error:', err);
        return res.status(500).json({ status: false, message: 'Error updating product', error: err });
      }

      if (result.affectedRows > 0) {
        if (isSeller) {
          notifyAdminsProductUpdated({
            sellerId: req.user.id,
            productId: product_id,
            productName: updateData.name || existingProduct.name
          }).catch(err => console.error('Failed to notify admins of product update:', err));
        }

        return res.status(200).json({
          status: true,
          message: isSeller
            ? 'Product updated successfully and submitted for admin re-approval'
            : 'Product updated successfully'
        });
      } else {
        return res.status(400).json({ status: false, message: 'No changes made to the product' });
      }
    });

  } catch (uploadErr) {
    console.error('Upload or S3 error:', uploadErr);
    return res.status(500).json({ status: false, message: 'Error processing uploads', error: uploadErr });
  }
}

exports.updateProductStatus = async (req, res) => {
  const { product_id } = req.params;
  const { status } = req.body;
  const userId = req.user?.id;
  const roleId = req.user?.role;

  if (!product_id) {
    return res.status(400).json({ status: false, message: 'Product ID is required' });
  }

  if (typeof status === 'undefined') {
    return res.status(400).json({ status: false, message: 'Status value is required' });
  }

  // 🔹 If Admin — can update any product
  if (roleId === parseInt(process.env.Admin_role_id)) {
    return productModel.getProductbyID(product_id, async (err, existingProduct) => {
      if (err || !existingProduct) {
        return res.status(404).json({ status: false, message: 'Product not found' });
      }

      await updateStatusOnly(product_id, status, res);
    });
  }

  // 🔹 If Seller — must own the product
  authorizeAction(
    productModel,
    product_id,
    userId,
    { getMethod: 'getProductbyIDforVerification', ownerField: 'seller_id' },
    async (authError, existingProduct) => {
      if (authError) {
        return res.status(authError.code).json({ status: false, message: authError.message });
      }

      await updateStatusOnly(product_id, status, res);
    }
  );
};

async function updateStatusOnly(product_id, status, res) {
  try {
    productModel.updateProductByID(
      product_id,
      { status },
      (err, result) => {
        if (err) {
          console.error('DB update error:', err);
          return res.status(500).json({ status: false, message: 'Error updating product status' });
        }

        if (result.affectedRows > 0) {
          return res.status(200).json({ status: true, message: 'Product status updated successfully' });
        } else {
          return res.status(400).json({ status: false, message: 'No product updated (possibly same status)' });
        }
      }
    );
  } catch (error) {
    console.error('Status update error:', error);
    return res.status(500).json({ status: false, message: 'Error updating status' });
  }
}
