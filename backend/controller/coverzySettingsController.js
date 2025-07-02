const pool = require('../config/db');
const { processPreviousDayShipments, processShipmentsForDate, processShipment, getCoverzySettings } = require('../cron/coverzyCron');

class CoverzySettingsController {
  


  // Get all coverzy settings
  static async getAllSettings(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute('SELECT * FROM coverzy_settings ORDER BY created_at DESC');
      
      if (rows.length > 0) {
        res.status(200).json({
          success: true,
          message: ' Settings retrieved successfully',
          data: rows,
          total_records: rows.length,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(200).json({
          success: true,
          message: ' coverzy_settings table exists but has no data',
          data: [],
          total_records: 0,
          recommendation: 'Import the complete_setup.sql file to add default data',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error fetching coverzy settings:', error);
      
      let errorMessage = 'Failed to fetch coverzy settings';
      let troubleshooting = [];
      
      if (error.code === 'ER_NO_SUCH_TABLE') {
        errorMessage = 'coverzy_settings table does not exist';
        troubleshooting.push('Import the complete_setup.sql file');
        troubleshooting.push('Make sure you created the table structure');
      }
      
      res.status(500).json({
        success: false,
        message: errorMessage,
        error_code: error.code,
        error_details: error.message,
        troubleshooting: troubleshooting,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Get current/latest settings (formatted for frontend use)
  static async getCurrentSettings(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(`
        SELECT 
          id,
          supplier_names,
          destination_countries,
          max_shipments,
          cutoff_time,
          cip_time,
          admin_email,
          email_enabled,
          created_at,
          updated_at
        FROM coverzy_settings 
        ORDER BY created_at DESC 
        LIMIT 1
      `);
      
      if (rows.length > 0) {
        const settings = rows[0];
        
        // Format the data for easier frontend consumption
        const formattedSettings = {
          id: settings.id,
          suppliers: settings.supplier_names.split(',').map(name => name.trim()),
          countries: settings.destination_countries.split(',').map(country => country.trim()),
          maxShipments: settings.max_shipments,
          cutoffTime: settings.cutoff_time,
          cipTime: settings.cip_time,
          adminEmail: settings.admin_email,
          emailEnabled: Boolean(settings.email_enabled),
          createdAt: settings.created_at,
          updatedAt: settings.updated_at
        };
        
        res.status(200).json({
          success: true,
          message: ' Current settings retrieved successfully',
          data: formattedSettings,
          raw_data: settings, // Also include raw data for reference
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'No settings found',
          recommendation: 'Import the complete_setup.sql file to add default data',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error fetching current settings:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch current settings',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Update all settings (full update)
  static async updateAllSettings(req, res) {
    let connection;
    
    try {
      const {
        supplier_names,
        destination_countries,
        max_shipments,
        cutoff_time,
        cip_time,
        admin_email,
        email_enabled
      } = req.body;
      
      // Validation
      if (!supplier_names || !destination_countries || !max_shipments || !cutoff_time || !cip_time || !admin_email) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields',
          required_fields: ['supplier_names', 'destination_countries', 'max_shipments', 'cutoff_time', 'cip_time', 'admin_email'],
          optional_fields: ['email_enabled'],
          provided_fields: Object.keys(req.body),
          timestamp: new Date().toISOString()
        });
      }
      
      connection = await pool.getConnection();
      
      // Update the settings (assuming there's only one record, or update the latest one)
      const updateQuery = `
        UPDATE coverzy_settings 
        SET 
          supplier_names = ?,
          destination_countries = ?,
          max_shipments = ?,
          cutoff_time = ?,
          cip_time = ?,
          admin_email = ?,
          email_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const [result] = await connection.execute(updateQuery, [
        supplier_names,
        destination_countries,
        parseInt(max_shipments),
        cutoff_time,
        cip_time,
        admin_email,
        email_enabled !== undefined ? email_enabled : true // Default to true if not provided
      ]);
      
      if (result.affectedRows > 0) {
        // Fetch the updated record
        const [updatedRows] = await connection.execute(`
          SELECT * FROM coverzy_settings ORDER BY created_at DESC LIMIT 1
        `);
        
        res.status(200).json({
          success: true,
          message: ' Settings updated successfully',
          data: updatedRows[0],
          affected_rows: result.affectedRows,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'No settings found to update',
          recommendation: 'Import the complete_setup.sql file first',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error updating settings:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to update settings',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Partial update settings (update specific fields only)
  static async updatePartialSettings(req, res) {
    let connection;
    
    try {
      const allowedFields = [
        'supplier_names',
        'destination_countries', 
        'max_shipments',
        'cutoff_time',
        'cip_time',
        'admin_email',
        'email_enabled'
      ];
      
      const updateFields = {};
      const updateValues = [];
      
      // Build dynamic update query based on provided fields
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateFields[field] = '?';
          updateValues.push(field === 'max_shipments' ? parseInt(req.body[field]) : req.body[field]);
        }
      }
      
      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields provided for update',
          allowed_fields: allowedFields,
          provided_fields: Object.keys(req.body),
          timestamp: new Date().toISOString()
        });
      }
      
      connection = await pool.getConnection();
      
      const setClause = Object.keys(updateFields).map(field => `${field} = ?`).join(', ');
      const updateQuery = `
        UPDATE coverzy_settings 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const [result] = await connection.execute(updateQuery, updateValues);
      
      if (result.affectedRows > 0) {
        // Fetch the updated record
        const [updatedRows] = await connection.execute(`
          SELECT * FROM coverzy_settings ORDER BY created_at DESC LIMIT 1
        `);
        
        res.status(200).json({
          success: true,
          message: ' Settings partially updated successfully',
          updated_fields: Object.keys(updateFields),
          data: updatedRows[0],
          affected_rows: result.affectedRows,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'No settings found to update',
          recommendation: 'Import the complete_setup.sql file first',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error partially updating settings:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to partially update settings',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Reset settings to defaults
  static async resetToDefaults(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const defaultSettings = {
        supplier_names: 'V T GEMS,MACHINERY AND AUTOCRAFT STORE,AURA GEMSTONES,GEMS PLANET,YAHVI FASHION,JEWELLERY HUB,MINI AUTO ELEKTRIK PRODUCTS,R.K. INTERNATIONAL,SHREEJI FASHION,The Medical Equipment Co.,vintagemetalcustoms,USMANI SUPER STORE,Jewels Central,TUSHANT DENTAL DEPOT,Teaxpress Private Limited',
        destination_countries: 'US,GB,UK',
        max_shipments: 20,
        cutoff_time: '19:00:00',
        cip_time: '23:30:00',
        admin_email: 'intern.tech@logilinkscs.com',
        email_enabled: true
      };
      
      const updateQuery = `
        UPDATE coverzy_settings 
        SET 
          supplier_names = ?,
          destination_countries = ?,
          max_shipments = ?,
          cutoff_time = ?,
          cip_time = ?,
          admin_email = ?,
          email_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const [result] = await connection.execute(updateQuery, [
        defaultSettings.supplier_names,
        defaultSettings.destination_countries,
        defaultSettings.max_shipments,
        defaultSettings.cutoff_time,
        defaultSettings.cip_time,
        defaultSettings.admin_email,
        defaultSettings.email_enabled
      ]);
      
      if (result.affectedRows > 0) {
        // Fetch the updated record
        const [updatedRows] = await connection.execute(`
          SELECT * FROM coverzy_settings ORDER BY created_at DESC LIMIT 1
        `);
        
        res.status(200).json({
          success: true,
          message: 'Settings reset to defaults successfully',
          data: updatedRows[0],
          affected_rows: result.affectedRows,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'No settings found to reset',
          recommendation: 'Import the complete_setup.sql file first',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error resetting settings:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to reset settings',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Health check endpoint
  static async healthCheck(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      await connection.execute('SELECT 1');
      
      // Check if coverzy_settings table exists and has data
      const [tableRows] = await connection.execute(`
        SELECT COUNT(*) as count FROM coverzy_settings
      `);
      
      const hasData = tableRows[0].count > 0;
      
      res.status(200).json({
        success: true,
        message: ' System is healthy',
        status: {
          database_connection: ' Connected',
          coverzy_settings_table: ' Exists',
          has_default_data: hasData ? ' Yes' : ' No',
          server_time: new Date().toISOString()
        },
        recommendations: hasData ? [] : ['Import complete_setup.sql to add default data']
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: ' System health check failed',
        status: {
          database_connection: ' Failed',
          error: error.message,
          server_time: new Date().toISOString()
        }
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Run Coverzy Cron Job manually
  static async runCoverzyProcess(req, res) {
    try {
      console.log(' Starting manual Coverzy process...');
      
      // Check if a specific date is provided in request body
      const { date } = req.body;
      
      let result;
      if (date) {
        console.log(`Processing shipments for specific date: ${date}`);
        result = await processShipmentsForDate(date);
      } else {
        console.log('Processing shipments for previous day (default)');
        result = await processPreviousDayShipments();
      }
      
      res.status(200).json({
        success: true,
        message: ' Coverzy process completed successfully',
        data: {
          date: result.date || date,
          total_shipments: result.total,
          successful_shipments: result.results?.length || 0,
          failed_shipments: result.errors?.length || 0,
          results: result.results,
          errors: result.errors
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(' Error running Coverzy process:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to run Coverzy process',
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Get all processed shipments
  static async getAllShipments(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(`
        SELECT 
          id,
          shipment_id,
          supplier_name,
          destination_country,
          policy_id,
          amount,
          currency,
          view_pdf,
          created_at,
          updated_at
        FROM coverzy_shipments 
        ORDER BY created_at DESC
      `);
      
      res.status(200).json({
        success: true,
        message: ' Shipments retrieved successfully',
        data: rows,
        total_records: rows.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error fetching shipments:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch shipments',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Get shipment by AWB
  static async getShipmentByAWB(req, res) {
    let connection;
    
    try {
      const { awb } = req.params;
      
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(`
        SELECT 
          id,
          shipment_id,
          supplier_name,
          destination_country,
          policy_id,
          amount,
          currency,
          view_pdf,
          created_at,
          updated_at
        FROM coverzy_shipments 
        WHERE shipment_id = ?
      `, [awb]);
      
      if (rows.length > 0) {
        res.status(200).json({
          success: true,
          message: 'Shipment found',
          data: rows[0],
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: `No shipment found with AWB: ${awb}`,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error fetching shipment by AWB:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch shipment',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Filter shipments by date range and optionally by supplier name
  static async getShipmentsFiltered(req, res) {
    let connection;
    
    try {
      const { fromdate, todate, supplier_name } = req.body;
      
      // Validation - fromdate and todate are required
      if (!fromdate || !todate) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: fromdate and todate are required',
          required_fields: ['fromdate', 'todate'],
          optional_fields: ['supplier_name'],
          provided_fields: Object.keys(req.body),
          timestamp: new Date().toISOString()
        });
      }
      
      connection = await pool.getConnection();
      
      // Build dynamic query based on whether supplier_name is provided
      let query = `
        SELECT 
          id,
          shipment_id,
          supplier_name,
          destination_country,
          policy_id,
          amount,
          currency,
          view_pdf,
          created_at,
          updated_at
        FROM coverzy_shipments 
        WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
      `;
      
      let queryParams = [fromdate, todate];
      
      // Add supplier filter if provided (using LIKE to handle any spacing issues)
      if (supplier_name && supplier_name.trim() !== '') {
        query += ` AND TRIM(supplier_name) = ?`;
        queryParams.push(supplier_name.trim());
      }
      
      // Order by created_at descending (newest first)
      query += ` ORDER BY created_at DESC`;
      
      const [rows] = await connection.execute(query, queryParams);
      
      res.status(200).json({
        success: true,
        message: 'Shipments retrieved successfully',
        filters_applied: {
          date_range: {
            from: fromdate,
            to: todate
          },
          supplier_name: supplier_name || 'All suppliers'
        },
        total_records: rows.length,
        data: rows,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error fetching filtered shipments:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch filtered shipments',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Update PDF URL for a specific shipment by Policy ID
  static async updateShipmentPdfUrl(req, res) {
    let connection;
    
    try {
      const { policy_id, url } = req.body;
      
      // Validation
      if (!policy_id || !url) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: policy_id and url are required',
          required_fields: ['policy_id', 'url'],
          provided_fields: Object.keys(req.body),
          timestamp: new Date().toISOString()
        });
      }
      
      connection = await pool.getConnection();
      
      // Check if shipment exists with the given policy_id
      const [existingRows] = await connection.execute(`
        SELECT shipment_id, supplier_name, destination_country, policy_id 
        FROM coverzy_shipments 
        WHERE policy_id = ?
      `, [policy_id]);
      
      if (existingRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No shipment found with Policy ID: ${policy_id}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Update the PDF URL
      const updateQuery = `
        UPDATE coverzy_shipments 
        SET view_pdf = ?, updated_at = CURRENT_TIMESTAMP
        WHERE policy_id = ?
      `;
      
      const [result] = await connection.execute(updateQuery, [url, policy_id]);
      
      if (result.affectedRows > 0) {
        res.status(200).json({
          success: true,
          message: 'PDF URL updated successfully',
          policy_id: policy_id,
          updated_url: url,
          shipment_info: existingRows[0],
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to update PDF URL',
          policy_id: policy_id,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error updating shipment PDF URL:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to update PDF URL',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }



  // Get email service status
  static async getEmailStatus(req, res) {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const [rows] = await connection.execute(`
        SELECT email_enabled, admin_email 
        FROM coverzy_settings 
        ORDER BY created_at DESC 
        LIMIT 1
      `);
      
      if (rows.length > 0) {
        const settings = rows[0];
        
        res.status(200).json({
          success: true,
          message: 'Email service status retrieved successfully',
          data: {
            emailEnabled: Boolean(settings.email_enabled),
            adminEmail: settings.admin_email,
            status: settings.email_enabled ? 'enabled' : 'disabled'
          },
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'No email settings found',
          recommendation: 'Import the complete_setup.sql file to add default data',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error fetching email status:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch email status',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Toggle email service on/off
  static async toggleEmailService(req, res) {
    let connection;
    
    try {
      const { enabled } = req.body;
      
      // Validate input
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'Invalid input: enabled field must be a boolean (true/false)',
          example: { "enabled": true },
          provided: { enabled },
          timestamp: new Date().toISOString()
        });
      }
      
      connection = await pool.getConnection();
      
      // Update email_enabled status
      const [result] = await connection.execute(`
        UPDATE coverzy_settings 
        SET email_enabled = ?, updated_at = CURRENT_TIMESTAMP
        ORDER BY created_at DESC 
        LIMIT 1
      `, [enabled]);
      
      if (result.affectedRows > 0) {
        // Fetch the updated settings
        const [updatedRows] = await connection.execute(`
          SELECT email_enabled, admin_email 
          FROM coverzy_settings 
          ORDER BY created_at DESC 
          LIMIT 1
        `);
        
        const settings = updatedRows[0];
        
        res.status(200).json({
          success: true,
          message: `Email service ${enabled ? 'enabled' : 'disabled'} successfully`,
          data: {
            emailEnabled: Boolean(settings.email_enabled),
            adminEmail: settings.admin_email,
            status: settings.email_enabled ? 'enabled' : 'disabled',
            previousStatus: enabled ? 'disabled' : 'enabled'
          },
          affected_rows: result.affectedRows,
          timestamp: new Date().toISOString()
        });
        
        console.log(`📧 Email service ${enabled ? 'enabled' : 'disabled'} via API`);
        
      } else {
        res.status(404).json({
          success: false,
          message: 'No settings found to update',
          recommendation: 'Import the complete_setup.sql file first',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Error toggling email service:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to toggle email service',
        error_code: error.code,
        error_details: error.message,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

module.exports = CoverzySettingsController; 