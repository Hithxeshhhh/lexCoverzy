require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET ;

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
      error: 'NO_TOKEN',
      timestamp: new Date().toISOString()
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Add user info to request object
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        error: 'TOKEN_EXPIRED',
        timestamp: new Date().toISOString()
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        error: 'INVALID_TOKEN',
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('JWT verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during token verification',
        timestamp: new Date().toISOString()
      });
    }
  }
};

// Optional JWT middleware (doesn't fail if no token, but adds user info if token exists)
const optionalJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // Add user info to request object
    } catch (error) {
      // Don't fail, just continue without user info
      console.log('Optional JWT verification failed:', error.message);
    }
  }
  
  next();
};

module.exports = {
  authenticateJWT,
  optionalJWT
}; 