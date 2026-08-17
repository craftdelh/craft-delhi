const Category = require('../models/categoryModel');
const slugify = require('slugify');
const authorizeAction = require('../utils/authorizeAction');
const { uploadToS3 } = require('../utils/s3Uploader');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const bucketName = process.env.AWS_BUCKET_NAME;


exports.createCategory = async (req, res) => {
  try {
    const { categoryName, category_description } = req.body;
    const sellerId = req.user?.id;
    if (!categoryName) {
      return res.status(400).json({ message: 'categoryName is required' });
    }

    const createdBy = sellerId ? 'seller' : 'admin';
    const creatorId = sellerId || null;

    let category_image = null;

    // ✅ Upload image
    if (req.file) {
      category_image = await uploadToS3(req.file, 'category_image');
    }

    // ✅ Check duplicate
    Category.findCategoryByNameAndCreator(
      categoryName,
      createdBy,
      creatorId,
      async (err, existing) => {
        if (err) {
          return res.status(500).json({ message: 'Server error' });
        }

        if (existing.length > 0) {
          return res.status(409).json({
            status: false,
            message: 'Category already exists'
          });
        }

        const slug = slugify(categoryName, { lower: true, strict: true }) || 'category';

        // ✅ Insert
        Category.createCategory(
          categoryName,
          slug,
          createdBy,
          creatorId,
          category_image,
          category_description, // ✅ LAST
          (err, result) => {
            if (err) {
              return res.status(500).json({ message: 'Server error' });
            }

            return res.status(201).json({
              status: true,
              message: 'Category created successfully',
              category_id: result.insertId,
              slug
            });
          }
        );
      }
    );

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};


exports.getCategories = (req, res) => {
  Category.getallCategories((err, categories) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({status: false, message: 'Server error' });
    }

    // Return all categories
    return res.status(200).json({
      status: true,
      message: 'Categories fetched successfully',
      data: categories
    });
  });
};

exports.getCategoryID = (req, res) => {
  const { category_id } = req.params;

  if (!category_id) {
    return res.status(400).json({ status: false, message: 'Category ID is required' });
  }

  Category.getCategorybyID(category_id, (err, category) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }

    if (!category) {
      return res.status(404).json({ status: false, message: 'Category not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Category fetched successfully',
      data: category
    });
  });
};

exports.getCategoryBySlug = (req, res) => {
  const { slug } = req.params;

  if (!slug) {
    return res.status(400).json({ status: false, message: 'Category slug is required' });
  }

  Category.getCategorybySlug(slug, (err, category) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }

    if (!category) {
      return res.status(404).json({ status: false, message: 'Category not found' });
    }

    return res.status(200).json({
      status: true,
      message: 'Category fetched successfully',
      data: category
    });
  });
};

// DELETE Category
exports.deleteCategory = (req, res) => {

  const { category_id } = req.params;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!category_id) {
    return res.status(400).json({
      status: false,
      message: 'Category ID is required'
    });
  }

  // ✅ Admin direct delete
  if (Number(userRole) === Number(process.env.Admin_role_id)) {

    return Category.deleteCategoryID(category_id, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: 'Error deleting category',
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: 'Category deleted successfully (Admin)'
        });
      }

      return res.status(400).json({
        status: false,
        message: 'Category deletion failed'
      });

    });
  }

  // Normal users
  authorizeAction(Category, category_id, userId, {
    getMethod: 'getCategorybyID',
    ownerField: 'creator_id'
  }, (authError, category) => {

    if (authError) {
      return res.status(authError.code).json({
        status: false,
        message: authError.message
      });
    }

    Category.deleteCategoryID(category_id, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: 'Error deleting category',
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: 'Category deleted successfully'
        });
      }

      return res.status(400).json({
        status: false,
        message: 'Category deletion failed'
      });

    });

  });
};

// UPDATE Category
exports.updateCategory = (req, res) => {
  const { category_id } = req.params;
  const { name,category_description  } = req.body;

  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!category_id) {
    return res.status(400).json({
      status: false,
      message: 'Category ID required'
    });
  }

  // ✅ ADMIN: Direct update
  if (Number(userRole) === Number(process.env.Admin_role_id)) {

    Category.getCategorybyID(category_id, async (err, category) => {
      if (err || !category) {
        return res.status(404).json({
          status: false,
          message: 'Category not found'
        });
      }

      const updateData = {};
      if (name) {
        updateData.name = name;
        updateData.slug = slugify(name, { lower: true, strict: true }) || 'category';
      }
      if (category_description) updateData.category_description = category_description;

      try {
        // ✅ IMAGE UPDATE
        if (req.file) {
          if (category.category_image) {
            await deleteFilesFromS3(
              [category.category_image],
              bucketName
            );
          }

          const uploadedImage = await uploadToS3(req.file, 'category_image');
          updateData.category_image = uploadedImage;
        }

        Category.updateCategoryByID(category_id, updateData, (err, result) => {
          if (err) {
            return res.status(500).json({
              status: false,
              message: 'Update failed'
            });
          }

          return res.status(200).json({
            status: true,
            message: 'Category updated successfully (Admin)'
          });
        });

      } catch (err) {
        return res.status(500).json({
          status: false,
          message: 'Image upload failed'
        });
      }
    });

    return;
  }

  // ✅ NORMAL USER: Owner check
  authorizeAction(Category, category_id, userId, {
    getMethod: 'getCategorybyID',
    ownerField: 'creator_id'
  }, (authError, category) => {

    if (authError) {
      return res.status(authError.code).json({
        status: false,
        message: authError.message
      });
    }

    const updateData = {};
    if (name) {
      updateData.name = name;
      updateData.slug = slugify(name, { lower: true, strict: true }) || 'category';
    }

    (async () => {
      try {
        // ✅ IMAGE UPDATE
        if (req.file) {
          if (category.category_image) {
            await deleteFilesFromS3(
              [category.category_image],
              bucketName
            );
          }

          const uploadedImage = await uploadToS3(req.file, 'category_image');
          updateData.category_image = uploadedImage;
        }

        Category.updateCategoryByID(category_id, updateData, (err, result) => {
          if (err) {
            return res.status(500).json({
              status: false,
              message: 'Update failed'
            });
          }

          return res.status(200).json({
            status: true,
            message: 'Category updated successfully'
          });
        });

      } catch (err) {
        return res.status(500).json({
          status: false,
          message: 'Image upload failed'
        });
      }
    })();

  });
};

exports.createSubCategory = (req, res) => {
  const { name, parent_id } = req.body;
  const  sellerId  = req.user?.id;

  if (!name || !parent_id) {
    return res.status(400).json({
      status: false,
      message: "name and parent_id are required"
    });
  }

  const createdBy = sellerId ? "seller" : "admin";
  const creatorId = sellerId || null;
  const slug = slugify(name, { lower: true, strict: true }) || 'subcategory';

  Category.createSubCategory(name, slug, parent_id, createdBy, creatorId, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        status: false,
        message: "Server error"
      });
    }

    res.status(201).json({
      status: true,
      message: "Subcategory created successfully"
    });
  });
};

exports.getSubCategories = (req, res) => {
  const { category_id } = req.params;

  if (!category_id) {
    return res.status(400).json({
      status: false,
      message: "Category ID required"
    });
  }

  Category.getSubCategoriesByCategory(category_id, (err, data) => {
    if (err) {
      return res.status(500).json({
        status: false,
        message: "Server error"
      });
    }

    res.status(200).json({
      status: true,
      message: "Subcategories fetched successfully",
      data
    });
  });
};
exports.deleteSubCategory = (req, res) => {
  const { subcategory_id } = req.params;
  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!subcategory_id) {
    return res.status(400).json({
      status: false,
      message: "Subcategory ID is required"
    });
  }

  // ✅ Admin can delete directly
  if (Number(userRole) === Number(process.env.Admin_role_id)) {

    return Category.deleteSubCategoryByID(subcategory_id, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: "Error deleting subcategory",
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: "Subcategory deleted successfully (Admin)"
        });
      }

      return res.status(400).json({
        status: false,
        message: "Subcategory deletion failed"
      });

    });
  }

  // Normal users
  authorizeAction(Category, subcategory_id, userId, {
    getMethod: "getCategorybyID",
    ownerField: "creator_id"
  }, (authError, subcategory) => {

    if (authError) {
      return res.status(authError.code).json({
        status: false,
        message: authError.message
      });
    }

    if (!subcategory.parent_id) {
      return res.status(400).json({
        status: false,
        message: "This is not a subcategory"
      });
    }

    Category.deleteSubCategoryByID(subcategory_id, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: "Error deleting subcategory",
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: "Subcategory deleted successfully"
        });
      }

      return res.status(400).json({
        status: false,
        message: "Subcategory deletion failed"
      });

    });

  });
};
exports.updateSubCategory = (req, res) => {

  const { subcategory_id } = req.params;
  const { name } = req.body;

  const userId = req.user?.id;
  const userRole = req.user?.role;

  if (!subcategory_id) {
    return res.status(400).json({
      status: false,
      message: "Subcategory ID is required"
    });
  }

  if (!name || name.trim() === "") {
    return res.status(400).json({
      status: false,
      message: "Subcategory name is required"
    });
  }

  // ✅ Admin direct update
  if (Number(userRole) === Number(process.env.Admin_role_id)) {

    const subSlug = slugify(name, { lower: true, strict: true }) || 'subcategory';
    return Category.updateSubCategoryByID(subcategory_id, { name, slug: subSlug }, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: "Error updating subcategory",
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: "Subcategory updated successfully (Admin)"
        });
      }

      return res.status(400).json({
        status: false,
        message: "Subcategory update failed"
      });

    });
  }

  // Normal users
  authorizeAction(Category, subcategory_id, userId, {
    getMethod: "getCategorybyID",
    ownerField: "creator_id"
  }, (authError, subcategory) => {

    if (authError) {
      return res.status(authError.code).json({
        status: false,
        message: authError.message
      });
    }

    if (!subcategory.parent_id) {
      return res.status(400).json({
        status: false,
        message: "This is not a subcategory"
      });
    }

    const subSlug = slugify(name, { lower: true, strict: true }) || 'subcategory';
    Category.updateSubCategoryByID(subcategory_id, { name, slug: subSlug }, (err, result) => {

      if (err) {
        return res.status(500).json({
          status: false,
          message: "Error updating subcategory",
          error: err
        });
      }

      if (result.affectedRows > 0) {
        return res.status(200).json({
          status: true,
          message: "Subcategory updated successfully"
        });
      }

      return res.status(400).json({
        status: false,
        message: "Subcategory update failed"
      });

    });

  });
};

exports.getProductsbyCatSubcatID = (req, res) => {
  const category_id = req.params.category_id || req.params.slug;

  if (!category_id) {
    return res.status(400).json({
      status: false,
      message: "Category ID or slug is required"
    });
  }

  Category.getProductByCategory(category_id, (err, data) => {
    if (err) {
      return res.status(500).json({
        status: false,
        message: "Server error"
      });
    }

    res.status(200).json({
      status: true,
      message: "Products fetched successfully",
      data
    });
  });
};
