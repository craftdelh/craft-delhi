const Favourite = require('../models/favouriteModel');
const { getFullUrl, formatImageSizes, formatGalleryImages } = require('../utils/imageFormatter');

// get all favourite
exports.getFavourite = (req, res) => {
  const { id } = req.user; // from verifyTokenforactions middleware

  if (!id) {
    return res.status(400).json({ status: false, message: 'user_id is required' });
  }

  Favourite.getFavourite(id, (err, result) => {
    if (err) {
      return res.status(500).json({ status: false, message: 'error fetching all favourites', error: err });
    }
    const formatted = (result || []).map(p => ({
      ...p,
      main_image_url: formatImageSizes(p.main_image_url),
      gallery_images: formatGalleryImages(p.gallery_images),
      video_url: getFullUrl(p.video_url),
      reel_url: getFullUrl(p.reel_url)
    }));
    return res.status(200).json({ status: true, message: 'Favourite products fetched successfully', data: formatted });
  });
};

// Add a favourite
exports.addFavourite = (req, res) => {
  const { id } = req.user; // from verifyTokenforactions middleware
  const { product_id } = req.params; // from URL param

  if (!id || !product_id) {
    return res.status(400).json({ status: false, message: 'user_id and product_id are required' });
  }

  Favourite.addFavourite(id, product_id, (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ status: false, message: 'Already favourited' });
      }
      return res.status(500).json({ status: false, message: 'Database error', error: err });
    }
    return res.status(201).json({ status: true, message: 'Favourite added successfully' });
  });
};

// Remove a favourite
exports.removeFavourite = (req, res) => {
  const { id } = req.user;
  const { product_id } = req.params;

  if (!id || !product_id) {
    return res.status(400).json({ status: false, message: 'user_id and product_id are required' });
  }

  Favourite.removeFavourite(id, product_id, (err, result) => {
    if (err) {
      return res.status(500).json({ status: false, message: 'Database error', error: err });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: false, message: 'Favourite not found' });
    }
    return res.json({ status: true, message: 'Favourite removed successfully' });
  });
};
