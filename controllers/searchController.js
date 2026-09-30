const Search = require('../models/searchModel');
const { getFullUrl, formatImageSizes, formatGalleryImages } = require('../utils/imageFormatter');

exports.searchProducts = (req, res) => {
  const searchQuery = req.query.search;

  if (!searchQuery) {
    return res.status(400).json({
      status: false,
      message: 'Search query is required'
    });
  }

  Search.searchProductsByNameAndCategory(
    searchQuery,
    (err, products) => {
      if (err) {
        console.error('Search Products Error:', err);
        return res.status(500).json({
          status: false,
          message: 'Failed to search products'
        });
      }

      const formatted = (products || []).map(p => ({
        ...p,
        main_image_url: formatImageSizes(p.main_image_url),
        gallery_images: formatGalleryImages(p.gallery_images),
        video_url: getFullUrl(p.video_url),
        reel_url: getFullUrl(p.reel_url)
      }));

      return res.status(200).json({
        status: true,
        message: 'Products fetched successfully',
        data: formatted
      });
    }
  );
};