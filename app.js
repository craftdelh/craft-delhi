const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const sellerStoreRoutes = require('./routes/sellerStoreRoutes');
const profileDetailsRoutes = require('./routes/profileDetails');
const adminRoutes = require('./routes/adminPanelRoutes');
const favouriteRoutes = require('./routes/favouriteRoutes');
const userAddress = require('./routes/userAddressesRoutes');
const orders = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const webhookHandler = require('./utils/webhook');
const orderTrackingRoutes = require('./routes/orderTrackingRoutes');
const reviewsRoutes = require('./routes/reviewsRoutes');
const giftCategories = require('./routes/giftCategoriesRoutes');
const searchRoutes = require('./routes/SearchRoutes');
const notificationRoutes = require('./routes/notificationRoutes');


const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/seller-store', sellerStoreRoutes);
app.use('/api/profile', profileDetailsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhook', webhookHandler);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/useraddress', userAddress);
app.use('/api/order', orders);
app.use('/api/payments', paymentRoutes);
app.use('/api/order-tracking', orderTrackingRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/gift-categories', giftCategories);
app.use('/api/searchall', searchRoutes);
app.use('/api/notifications', notificationRoutes);

module.exports = app;
