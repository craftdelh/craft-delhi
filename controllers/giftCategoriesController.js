const GiftCategories = require('../models/giftCategoriesModel');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const bucketName = process.env.AWS_BUCKET_NAME;
const { uploadToS3 } = require('../utils/s3Uploader');

// ✅ Create Gift Category (Admin Only)
exports.createGiftCategory = async (req, res) => {
  try {
    const role = req.user.role;

    if (role != process.env.Admin_role_id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const slugify = require('slugify');
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    let gift_image = null;

    // ✅ base slug
    let baseSlug = slugify(title, { lower: true, strict: true });

    let slug = baseSlug;
    let counter = 1;

    // ✅ CREATE → no id check needed
    while (true) {
      const existing = await GiftCategories.checkSlugExists(slug);

      if (!existing) break;

      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // ✅ upload image
    if (req.file) {
      const uploadedImg = await uploadToS3(req.file, 'gift_image');
      gift_image = typeof uploadedImg === 'object' ? JSON.stringify(uploadedImg) : uploadedImg;
    }

    GiftCategories.createGiftCategory(
      { title, slug, description, gift_image },
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
              success: false,
              message: 'Slug already exists.'
            });
          }

          console.error(err);
          return res.status(500).json({
            success: false,
            message: 'Server error'
          });
        }

        return res.status(201).json({
          success: true,
          message: 'Gift category created successfully',
          category_id: result.insertId
        });
      }
    );

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
// ✅ Get All Gift Categories (Admin Only)
exports.getAllGiftCategories = (req, res) => {

  GiftCategories.getAllGiftCategories((err, categories) => {
    if (err) {
      console.error('Fetch Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }

    return res.status(200).json({
      success: true,
      total_records: categories.length,
      data: categories
    });
  });
};


// ✅ Get Gift Category By ID (Admin Only)
exports.getGiftCategoryById = (req, res) => {

  const { id } = req.params;

  GiftCategories.getGiftCategoryById(id, (err, category) => {
    if (err) {
      console.error('Fetch Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }

    if (!category || category.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: category[0]
    });
  });
};


// ✅ Update Gift Category (Admin Only)

exports.updateGiftCategory = async (req, res) => {
  try {
    const role = req.user.role;

    if (role != process.env.Admin_role_id) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const slugify = require('slugify'); // ✅ missing import

    const { id } = req.params;
    const { title, description } = req.body;

    GiftCategories.getGiftCategoryById(id, async (err, category) => {
      if (err || !category || category.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      const existingCategory = category[0];
      const updateData = {};

      if (title !== undefined) {
        updateData.title = title;

        let baseSlug = slugify(title, { lower: true, strict: true });
        let slug = baseSlug;
        let counter = 1;

        while (true) {
          const existing = await GiftCategories.checkSlugExists(slug);

          // ✅ allow same record
          if (!existing || existing.id == id) break;

          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        updateData.slug = slug;
      }

      if (description !== undefined) {
        updateData.description = description;
      }

      if (Object.keys(updateData).length === 0 && !req.file) {
        return res.status(400).json({
          success: false,
          message: 'At least one field is required'
        });
      }

      try {
        if (req.file) {
          if (existingCategory.gift_image) {
            await deleteFilesFromS3(
              [existingCategory.gift_image],
              bucketName
            );
          }

          const uploadedImage = await uploadToS3(req.file, 'gift_image');
          updateData.gift_image = typeof uploadedImage === 'object' ? JSON.stringify(uploadedImage) : uploadedImage;
        }

        GiftCategories.updateGiftCategory(id, updateData, (updateErr) => {
          if (updateErr) {
            if (updateErr.code === 'ER_DUP_ENTRY') {
              return res.status(400).json({
                success: false,
                message: 'Slug already exists.'
              });
            }

            console.error(updateErr);
            return res.status(500).json({
              success: false,
              message: 'Server error'
            });
          }

          return res.status(200).json({
            success: true,
            message: 'Gift category updated successfully'
          });
        });

      } catch (s3Err) {
        console.error(s3Err);
        return res.status(500).json({
          success: false,
          message: 'Image update failed'
        });
      }
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


// ✅ Delete Gift Category (Admin Only)
exports.deleteGiftCategory = async (req, res) => {
  try {
    const role = req.user.role;

    if (role != process.env.Admin_role_id) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { id } = req.params;

    GiftCategories.getGiftCategoryById(id, async (err, category) => {
      if (err || !category || category.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      const existingCategory = category[0];

      try {
        // 🗑️ Delete image from S3
        if (existingCategory.gift_image) {
          await deleteFilesFromS3(
            [existingCategory.gift_image],
            bucketName
          );
        }
      } catch (s3Err) {
        console.error('S3 deletion failed, continuing...');
      }

      // 🗑️ Delete from DB
      GiftCategories.deleteGiftCategory(id, (deleteErr) => {
        if (deleteErr) {
          console.error('Delete Error:', deleteErr);
          return res.status(500).json({
            success: false,
            message: 'Server error'
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Gift category and image deleted successfully'
        });
      });
    });

  } catch (error) {
    console.error('Delete Controller Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.updateGiftCategoryStatus = async (req, res) => {
  try {
    const role = req.user.role;

    if (role != process.env.Admin_role_id) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (status === undefined || status === null) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // 🔎 Check if category exists
    GiftCategories.getGiftCategoryById(id, (err, category) => {
      if (err) {
        console.error('Fetch Error:', err);
        return res.status(500).json({
          success: false,
          message: 'Server error'
        });
      }

      if (!category || category.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // 🔄 Update Status
      GiftCategories.updateGiftCategoryStatus(id, status, (updateErr) => {
        if (updateErr) {
          console.error('Update Status Error:', updateErr);
          return res.status(500).json({
            success: false,
            message: 'Server error'
          });
        }

        return res.status(200).json({
          success: true,
          message: 'Gift category status updated successfully'
        });
      });
    });

  } catch (error) {
    console.error('Update Status Controller Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.getProductbyGiftSlug = (req, res) => {

  const { slug } = req.params;

  GiftCategories.getProductbyGiftSlug(slug, (err, product) => {
    if (err) {
      console.error('Fetch Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }

    if (!product || product.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'products not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: product
    });
  });
};


