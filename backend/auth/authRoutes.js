const express = require('express');
const AuthController = require('./authController');
const { authenticateJWT } = require('./jwtMiddleware');

const router = express.Router();

// Public routes (no authentication required)
router.post('/login', AuthController.login);
router.post('/logout', AuthController.logout);

// Protected routes (require JWT authentication)
router.get('/verify-token', authenticateJWT, AuthController.verifyToken);

module.exports = router; 