const express = require('express');
const router = express.Router();
const CoverzySettingsController = require('../controller/coverzySettingsController');

// Authentication middleware using BEARER_TOKEN from env
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.',
            timestamp: new Date().toISOString()
        });
    }
    
    if (token !== process.env.BEARER_TOKEN) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Invalid token.',
            timestamp: new Date().toISOString()
        });
    }
    
    next();
};

// Apply authentication middleware to all routes
router.use(authenticateToken);



// Get all coverzy settings
router.get('/coverzy-settings', CoverzySettingsController.getAllSettings);

// Get current/latest settings (formatted for frontend use)
router.get('/coverzy-settings/current', CoverzySettingsController.getCurrentSettings);

// Update all settings (full update)
router.put('/coverzy-settings', CoverzySettingsController.updateAllSettings);

// Partial update settings (update specific fields only)
router.patch('/coverzy-settings', CoverzySettingsController.updatePartialSettings);

// Reset settings to defaults
router.post('/coverzy-settings/reset', CoverzySettingsController.resetToDefaults);

// Email service management endpoints
// Get email service status
router.get('/email/status', CoverzySettingsController.getEmailStatus);

// Toggle email service on/off
router.post('/email/toggle', CoverzySettingsController.toggleEmailService);

// Health check endpoint
router.get('/health', CoverzySettingsController.healthCheck);

// Run Coverzy Cron Process manually
router.post('/run-coverzy-process', CoverzySettingsController.runCoverzyProcess);

// Get all processed shipments
router.get('/shipments', CoverzySettingsController.getAllShipments);

// Get shipment by AWB
router.get('/shipments/:awb', CoverzySettingsController.getShipmentByAWB);

// Update PDF URL for a specific shipment by Policy ID
router.put('/shipments/update-pdf', CoverzySettingsController.updateShipmentPdfUrl);

// Filter shipments by date range and optionally by supplier name
router.post('/shipments/filter', CoverzySettingsController.getShipmentsFiltered);



module.exports = router; 