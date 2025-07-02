require('dotenv').config();
const jwt = require('jsonwebtoken');

// Admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

class AuthController {
  // Login endpoint for frontend
  static async login(req, res) {
    try {
      const { username, password } = req.body;

      // Validation
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: 'Username and password are required',
          timestamp: new Date().toISOString()
        });
      }

      // Check if username matches
      if (username.trim() !== ADMIN_USERNAME) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          timestamp: new Date().toISOString()
        });
      }

      // Check password
      if (password.trim() !== ADMIN_PASSWORD) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          timestamp: new Date().toISOString()
        });
      }

      // Generate JWT token
      const payload = {
        username: ADMIN_USERNAME,
        role: 'admin',
        loginTime: new Date().toISOString()
      };

      const token = jwt.sign(payload, JWT_SECRET, { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'lexcoverzy-admin'
      });

      // Calculate expiry time
      const expiryTime = new Date();
      const expiryHours = JWT_EXPIRES_IN.includes('h') ? parseInt(JWT_EXPIRES_IN) : 24;
      expiryTime.setHours(expiryTime.getHours() + expiryHours);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: {
            username: ADMIN_USERNAME,
            role: 'admin',
            loginTime: payload.loginTime,
            tokenExpiry: expiryTime.toISOString()
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Login error:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error during login',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Verify token endpoint
  static async verifyToken(req, res) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'No token provided',
          timestamp: new Date().toISOString()
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        res.status(200).json({
          success: true,
          message: 'Token is valid',
          data: {
            user: {
              username: decoded.username,
              role: decoded.role,
              loginTime: decoded.loginTime
            },
            tokenInfo: {
              issuedAt: new Date(decoded.iat * 1000).toISOString(),
              expiresAt: new Date(decoded.exp * 1000).toISOString()
            }
          },
          timestamp: new Date().toISOString()
        });

      } catch (jwtError) {
        if (jwtError.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            message: 'Token has expired',
            error: 'TOKEN_EXPIRED',
            timestamp: new Date().toISOString()
          });
        } else if (jwtError.name === 'JsonWebTokenError') {
          return res.status(401).json({
            success: false,
            message: 'Invalid token',
            error: 'INVALID_TOKEN',
            timestamp: new Date().toISOString()
          });
        } else {
          throw jwtError;
        }
      }

    } catch (error) {
      console.error('Token verification error:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error during token verification',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Logout endpoint (mainly for token invalidation logging)
  static async logout(req, res) {
    try {
      // In a production app, you might want to maintain a blacklist of tokens
      // For now, we'll just log the logout and let the frontend handle token removal
      
      res.status(200).json({
        success: true,
        message: 'Logout successful',
        note: 'Please remove the token from client storage',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Logout error:', error);
      
      res.status(500).json({
        success: false,
        message: 'Internal server error during logout',
        timestamp: new Date().toISOString()
      });
    }
  }


}

module.exports = AuthController; 