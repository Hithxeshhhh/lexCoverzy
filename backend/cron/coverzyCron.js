require('dotenv').config();
const axios = require('axios');
const pool = require('../config/db');
const { sendCronErrorEmail, sendDailySummaryEmail } = require('../smtp/errorEmail');
const {
   
    LEX_SHIPMENT_API,
    LEX_CUSTOMER_DETAIL_API,
    LEX_DAILY_SHIPMENTS_DATA_API,
    BEARER_TOKEN,
    COVRZY_API_ENDPOINT,
    COVRZY_BEARER_TOKEN
} = process.env;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Log error to database
const logErrorToDatabase = async (errorData) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            jobName,
            errorType,
            errorMessage,
            errorDetails,
            executionDate,
            shipmentAwb = null
        } = errorData;

        const insertQuery = `
            INSERT INTO coverzy_error_logs 
            (job_name, error_type, error_message, error_details, execution_date, shipment_awb) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const [result] = await connection.execute(insertQuery, [
            jobName,
            errorType,
            errorMessage,
            errorDetails ? JSON.stringify(errorDetails) : null,
            executionDate,
            shipmentAwb
        ]);
        
        console.log(`📝 Error logged to database with ID: ${result.insertId}`);
        return result.insertId;
        
    } catch (error) {
        console.error('❌ Failed to log error to database:', error.message);
        // Don't throw here as we don't want to fail the main process due to logging issues
        return null;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Get current coverzy settings from database
const getCoverzySettings = async () => {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT 
                supplier_names,
                destination_countries,
                max_shipments,
                cutoff_time,
                cip_time,
                min_shipment_value_usd,
                usd_to_inr_rate
            FROM coverzy_settings 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        
        if (rows.length > 0) {
            const settings = rows[0];
            return {
                suppliers: settings.supplier_names.split(',').map(name => name.trim()),
                countries: settings.destination_countries.split(',').map(country => country.trim()),
                maxShipments: settings.max_shipments,
                cutoffTime: settings.cutoff_time,
                cipTime: settings.cip_time,
                minShipmentValueUsd: settings.min_shipment_value_usd,
                usdToInrRate: settings.usd_to_inr_rate
            };
        } else {
            throw new Error('No coverzy settings found in database');
        }
    } catch (error) {
        console.error('Error fetching coverzy settings:', error.message);
        
        // Log database error
        await logErrorToDatabase({
            jobName: 'coverzy_daily_shipments',
            errorType: 'database_error',
            errorMessage: `Failed to fetch coverzy settings: ${error.message}`,
            errorDetails: { function: 'getCoverzySettings', stack: error.stack },
            executionDate: new Date().toISOString().split('T')[0]
        });
        
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Validate if destination country is allowed
const isDestinationAllowed = (destinationCountry, allowedCountries) => {
    return allowedCountries.includes(destinationCountry.toUpperCase());
};

// Validate if supplier is allowed
const isSupplierAllowed = (companyName, allowedSuppliers) => {
    if (!companyName) return false;
    return allowedSuppliers.some(supplier => 
        supplier.toLowerCase().includes(companyName.toLowerCase()) ||
        companyName.toLowerCase().includes(supplier.toLowerCase())
    );
};

// Validate if pickup time is within allowed time range
const isPickupTimeValid = (pickupTime, cutoffTime, cipTime) => {
    try {
        // Extract time from pickup datetime (assuming format: YYYY-MM-DD HH:MM:SS)
        const pickupTimeStr = pickupTime.split(' ')[1] || pickupTime;
        
        // Convert times to comparable format (minutes from midnight)
        const timeToMinutes = (timeStr) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };
        
        const pickupMinutes = timeToMinutes(pickupTimeStr);
        const cutoffMinutes = timeToMinutes(cutoffTime);
        
        // Check if pickup time is before the cutoff time
        return pickupMinutes < cutoffMinutes;
    } catch (error) {
        console.error('Error validating pickup time:', error.message);
        return false;
    }
};

// Convert INR to USD for validation purposes only
const convertInrToUsd = (inrAmount, usdToInrRate) => {
    try {
        const inrValue = parseFloat(inrAmount);
        const rate = parseFloat(usdToInrRate);
        
        if (isNaN(inrValue) || isNaN(rate) || rate <= 0) {
            throw new Error('Invalid amount or exchange rate');
        }
        
        return inrValue / rate;
    } catch (error) {
        console.error('Error converting INR to USD:', error.message);
        return 0;
    }
};

// Validate if shipment value meets minimum USD threshold
const isShipmentValueValid = (packageValue, minShipmentValueUsd, usdToInrRate) => {
    try {
        const usdValue = convertInrToUsd(packageValue, usdToInrRate);
        const minValue = parseFloat(minShipmentValueUsd);
        
        return usdValue >= minValue;
    } catch (error) {
        console.error('Error validating shipment value:', error.message);
        return false;
    }
};

const getPreviousDate = () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    
    const day = String(yesterday.getDate()).padStart(2, '0');
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const year = yesterday.getFullYear();
    
    return `${day}-${month}-${year}`;
};

const getDailyShipmentsData = async (fromDate, toDate = null) => {
    try {
        await delay(500);

        // Ensure both dates are set to the same date (strictly yesterday for our use case)
        const targetDate = toDate || fromDate;
        const requestData = {
            "fromdate": fromDate,
            "todate": targetDate
        };

        console.log(`Fetching shipments from ${fromDate} to ${targetDate}`);

        const response = await axios.post(LEX_DAILY_SHIPMENTS_DATA_API, requestData, {
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        // Parse the response to extract AWB numbers
        // The response contains "Customer Shipment Count X" followed by the array
        let responseData = response.data;
        
        // If response is a string, we need to parse it
        if (typeof responseData === 'string') {
            // Remove the "Customer Shipment Count X" part and parse the JSON array
            const jsonStart = responseData.indexOf('[');
            if (jsonStart !== -1) {
                const jsonPart = responseData.substring(jsonStart);
                responseData = JSON.parse(jsonPart);
            }
        }

        // Extract only the full_awb_number values
        const awbNumbers = responseData.map(item => item.full_awb_number).filter(awb => awb);
        
        console.log(`Found ${awbNumbers.length} AWB numbers for date ${fromDate}`);
        return awbNumbers;
    } catch (error) {
        console.error(`Failed to fetch daily shipments data: ${error.message}`);
        throw error;
    }
};

const getShipmentDetails = async (awb) => {
    try {
        await delay(500); 

        const url = `${LEX_SHIPMENT_API}AWB=${awb}`;
        const headers = {
            'Authorization': `Bearer ${BEARER_TOKEN}`,
            'Content-Type': 'application/json',
        };
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        throw new Error(`Failed to fetch shipment details for AWB: ${awb}, Error: ${error.message}`);
    }
};

const getCustomerDetails = async (customerId) => {
    try {
        await delay(500); 

        const response = await axios.get(`${LEX_CUSTOMER_DETAIL_API}Customer_Id=${customerId}`, {
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Failed to fetch customer details: ${error.message}`);
        return null;
    }
};

// Calculate ETA based on pickup date and business days
const calculateETA = (pickupDate, businessDays) => {
    try {
        // Parse the pickup date (assuming format: YYYY-MM-DD HH:MM:SS or DD-MM-YYYY HH:MM:SS)
        let date;
        if (pickupDate.includes(' ')) {
            const dateStr = pickupDate.split(' ')[0];
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts[0].length === 4) {
                    // YYYY-MM-DD format
                    date = new Date(dateStr);
                } else {
                    // DD-MM-YYYY format
                    const [day, month, year] = parts;
                    date = new Date(year, month - 1, day);
                }
            }
        } else {
            date = new Date(pickupDate);
        }

        if (isNaN(date.getTime())) {
            throw new Error('Invalid pickup date format');
        }

        // Add business days (excluding weekends)
        let currentDate = new Date(date);
        let addedDays = 0;
        
        while (addedDays < businessDays) {
            currentDate.setDate(currentDate.getDate() + 1);
            const dayOfWeek = currentDate.getDay();
            
            // Skip weekends (0 = Sunday, 6 = Saturday)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                addedDays++;
            }
        }
        
        // Return in YYYY-MM-DD HH:MM:SS format with static time
        const dateStr = currentDate.toISOString().split('T')[0];
        const staticTime = "00:00:00"; // Static delivery time (midnight)
        return `${dateStr} ${staticTime}`;
    } catch (error) {
        console.error('Error calculating ETA:', error.message);
        return null;
    }
};

// Get carrier code and delivery days based on destination and service type
const getCarrierInfo = (destinationCountry, serviceType) => {
    const destination = destinationCountry.toUpperCase();
    const service = serviceType.toLowerCase();
    
    // USA mapping
    if (destination === 'USA' || destination === 'US' || destination === 'UNITED STATES') {
        if (service === 'ship+') {
            return { carrierCode: 'USPS', deliveryDays: 15 };
        } else if (service === 'shipd') {
            return { carrierCode: 'USPS', deliveryDays: 12 };
        }
    }
    
    // UK/GB mapping - handle all possible variations
    if (destination === 'UK' || 
        destination === 'GB' || destination === 'UNITED KINGDOM') {
        if (service === 'ship+') {
            return { carrierCode: 'Royal Mail', deliveryDays: 10 };
        } else if (service === 'shipd') {
            return { carrierCode: 'Royal Mail', deliveryDays: 8 };
        }
    }
    
    return null; // Unsupported combination
};

// Validate service type and destination combination
const isServiceDestinationValid = (destinationCountry, serviceType) => {
    const carrierInfo = getCarrierInfo(destinationCountry, serviceType);
    return carrierInfo !== null;
};

const mapShipmentDetailsToPayload = async(shipmentDetails) => {
    // Get customer details using Customer_ID from shipment
    const customerDetails = await getCustomerDetails(shipmentDetails.Customer_ID);
    
    // Extract customer info
    const customerInfo = customerDetails ? customerDetails[0] : {};
    const customerAddresses = customerDetails ? customerDetails[1] : [];
    const registeredAddress = customerAddresses.find(addr => addr.label === "Registered Address") || {};

    // Get carrier info and calculate ETA
    const carrierInfo = getCarrierInfo(shipmentDetails.Destination_Country, shipmentDetails.Service_Type);
    const eta = carrierInfo ? calculateETA(shipmentDetails.Create_Pick_Up_Date, carrierInfo.deliveryDays) : null;

    const payload = {
        "transportMode": "air",
        "shipment": {
          "awb": shipmentDetails.Name,
          "departureDate": shipmentDetails.Create_Pick_Up_Date,
          "origin": "IN",
          "destination": shipmentDetails.Destination_Country,
          "eta": eta,
          "carrierCode": carrierInfo ? carrierInfo.carrierCode : null,
          "value": {
            "amount": shipmentDetails.Package_Value,
            "currency": "INR"
          },
          "goods_description": shipmentDetails.Description
        },
        "customerName": customerInfo.company_name || "",
        "customerCountry": registeredAddress.country_code || "IN",
        "customerEmail": customerInfo.email || ""
      }

    return payload;
}

const sendToCovrzyAPI = async (payload) => {
    try {
        await delay(500);

        const covrzyEndpoint = COVRZY_API_ENDPOINT;
        
        // Console the final payload being sent to Coverzy API
        console.log('Final payload being sent to Coverzy API:');
        console.log(JSON.stringify(payload, null, 2));
        
        const response = await axios.post(covrzyEndpoint, payload, {
            headers: {
                'Authorization': `Bearer ${COVRZY_BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Successfully sent to Covrzy API:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Failed to send to Covrzy API: ${error.message}`);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        throw error;
    }
}

// Save shipment data to coverzy_shipments table
const saveShipmentToDatabase = async (awb, supplierName, destinationCountry, coverzyResponse) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Extract data from Coverzy API response
        const { amount, policyId, status } = coverzyResponse;
        
        // Leave view_pdf empty for now
        const viewPdfUrl = null;
        
        const insertQuery = `
            INSERT INTO coverzy_shipments 
            (shipment_id, supplier_name, destination_country, policy_id, amount, currency, view_pdf) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            supplier_name = VALUES(supplier_name),
            destination_country = VALUES(destination_country),
            policy_id = VALUES(policy_id),
            amount = VALUES(amount),
            currency = VALUES(currency),
            view_pdf = VALUES(view_pdf),
            updated_at = CURRENT_TIMESTAMP
        `;
        
        const [result] = await connection.execute(insertQuery, [
            awb,
            supplierName,
            destinationCountry,
            policyId,
            amount,
            'INR',  // Set currency as INR
            viewPdfUrl
        ]);
        
        console.log(`    Shipment data saved to database for AWB: ${awb}`);
        console.log(`   - Policy ID: ${policyId}`);
        console.log(`   - Amount: ${amount}`);
        
        
        return result;
    } catch (error) {
        console.error(`  Failed to save shipment data to database for AWB ${awb}:`, error.message);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Validate shipment without processing to Coverzy API
const validateShipmentOnly = async (awb, settings) => {
    try {
        console.log(`Validating shipment with AWB: ${awb}`);
        
        // Get shipment details
        const shipmentDetails = await getShipmentDetails(awb);
        
        // Validate destination country
        if (!isDestinationAllowed(shipmentDetails.Destination_Country, settings.countries)) {
            throw new Error(`Destination country '${shipmentDetails.Destination_Country}' not allowed. Allowed countries: ${settings.countries.join(', ')}`);
        }
        
        // Validate service type and destination combination
        if (!isServiceDestinationValid(shipmentDetails.Destination_Country, shipmentDetails.Service_Type)) {
            throw new Error(`Service type '${shipmentDetails.Service_Type}' not supported for destination '${shipmentDetails.Destination_Country}'. Supported combinations: USA(Ship+/ShipD), UK/GB(Ship+/ShipD)`);
        }
        
        // Validate pickup time
        if (!isPickupTimeValid(shipmentDetails.Create_Pick_Up_Date, settings.cutoffTime, settings.cipTime)) {
            throw new Error(`Pickup time '${shipmentDetails.Create_Pick_Up_Date}' is not before cutoff time (${settings.cutoffTime})`);
        }
        
        // Validate shipment value
        if (!isShipmentValueValid(shipmentDetails.Package_Value, settings.minShipmentValueUsd, settings.usdToInrRate)) {
            const usdValue = convertInrToUsd(shipmentDetails.Package_Value, settings.usdToInrRate);
            throw new Error(`Shipment value ₹${shipmentDetails.Package_Value} ($${usdValue.toFixed(2)}) is below minimum threshold of $${settings.minShipmentValueUsd}`);
        }
        
        // Get customer details for supplier validation
        const customerDetails = await getCustomerDetails(shipmentDetails.Customer_ID);
        const customerInfo = customerDetails ? customerDetails[0] : {};
        
        // Validate supplier
        if (!isSupplierAllowed(customerInfo.company_name, settings.suppliers)) {
            throw new Error(`Supplier '${customerInfo.company_name}' not allowed. Allowed suppliers: ${settings.suppliers.join(', ')}`);
        }
        
        const usdValue = convertInrToUsd(shipmentDetails.Package_Value, settings.usdToInrRate);
        const carrierInfo = getCarrierInfo(shipmentDetails.Destination_Country, shipmentDetails.Service_Type);
        const eta = calculateETA(shipmentDetails.Create_Pick_Up_Date, carrierInfo.deliveryDays);
        
        console.log(`   ✓ Validation passed for AWB: ${awb}`);
        console.log(`     - Destination: ${shipmentDetails.Destination_Country} ✓`);
        console.log(`     - Service Type: ${shipmentDetails.Service_Type} ✓`);
        console.log(`     - Carrier: ${carrierInfo.carrierCode} (${carrierInfo.deliveryDays} business days) ✓`);
        console.log(`     - ETA: ${eta} ✓`);
        console.log(`     - Pickup Time: ${shipmentDetails.Create_Pick_Up_Date} ✓`);
        console.log(`     - Shipment Value: ₹${shipmentDetails.Package_Value} ($${usdValue.toFixed(2)}) ✓`);
        console.log(`     - Supplier: ${customerInfo.company_name} ✓`);
        
        return {
            valid: true,
            awb,
            shipmentDetails,
            customerInfo
        };
    } catch (error) {
        console.log(`   ✗ Validation failed for AWB: ${awb} - ${error.message}`);
        return {
            valid: false,
            awb,
            error: error.message
        };
    }
};

const processShipment = async (awb, settings) => {
    try {
        console.log(`Processing shipment with AWB: ${awb}`);
        
        // Get shipment details
        const shipmentDetails = await getShipmentDetails(awb);
        
        // Validate destination country
        if (!isDestinationAllowed(shipmentDetails.Destination_Country, settings.countries)) {
            throw new Error(`Destination country '${shipmentDetails.Destination_Country}' not allowed. Allowed countries: ${settings.countries.join(', ')}`);
        }
        
        // Validate service type and destination combination
        if (!isServiceDestinationValid(shipmentDetails.Destination_Country, shipmentDetails.Service_Type)) {
            throw new Error(`Service type '${shipmentDetails.Service_Type}' not supported for destination '${shipmentDetails.Destination_Country}'. Supported combinations: USA(Ship+/ShipD), UK/GB(Ship+/ShipD)`);
        }
        
        // Validate pickup time
        if (!isPickupTimeValid(shipmentDetails.Create_Pick_Up_Date, settings.cutoffTime, settings.cipTime)) {
            throw new Error(`Pickup time '${shipmentDetails.Create_Pick_Up_Date}' is not before cutoff time (${settings.cutoffTime})`);
        }
        
        // Validate shipment value
        if (!isShipmentValueValid(shipmentDetails.Package_Value, settings.minShipmentValueUsd, settings.usdToInrRate)) {
            const usdValue = convertInrToUsd(shipmentDetails.Package_Value, settings.usdToInrRate);
            throw new Error(`Shipment value ₹${shipmentDetails.Package_Value} ($${usdValue.toFixed(2)}) is below minimum threshold of $${settings.minShipmentValueUsd}`);
        }
        
        // Get customer details for supplier validation
        const customerDetails = await getCustomerDetails(shipmentDetails.Customer_ID);
        const customerInfo = customerDetails ? customerDetails[0] : {};
        
        // Validate supplier
        if (!isSupplierAllowed(customerInfo.company_name, settings.suppliers)) {
            throw new Error(`Supplier '${customerInfo.company_name}' not allowed. Allowed suppliers: ${settings.suppliers.join(', ')}`);
        }
        
        const usdValue = convertInrToUsd(shipmentDetails.Package_Value, settings.usdToInrRate);
        const carrierInfo = getCarrierInfo(shipmentDetails.Destination_Country, shipmentDetails.Service_Type);
        const eta = calculateETA(shipmentDetails.Create_Pick_Up_Date, carrierInfo.deliveryDays);
        
        console.log(`   All validations passed for AWB: ${awb}`);
        console.log(`  - Destination: ${shipmentDetails.Destination_Country} ✓`);
        console.log(`  - Service Type: ${shipmentDetails.Service_Type} ✓`);
        console.log(`  - Carrier: ${carrierInfo.carrierCode} (${carrierInfo.deliveryDays} business days) ✓`);
        console.log(`  - ETA: ${eta} ✓`);
        console.log(`  - Pickup Time: ${shipmentDetails.Create_Pick_Up_Date} ✓`);
        console.log(`  - Shipment Value: ₹${shipmentDetails.Package_Value} ($${usdValue.toFixed(2)}) ✓`);
        console.log(`  - Supplier: ${customerInfo.company_name} ✓`);
        
        // Map shipment details to payload
        const payload = await mapShipmentDetailsToPayload(shipmentDetails);
        
        // Send to Covrzy API
        const coverzyResponse = await sendToCovrzyAPI(payload);
        
        // Check if Coverzy API response is successful
        if (coverzyResponse.status === 'success' && coverzyResponse.policyId) {
            // Save shipment data to database
            await saveShipmentToDatabase(
                awb,
                customerInfo.company_name,
                shipmentDetails.Destination_Country,
                coverzyResponse
            );
            
            console.log(`    Successfully processed and saved shipment ${awb}`);
            return {
                coverzyResponse,
                savedToDatabase: true,
                pdfUrl: null // PDF URL not stored in database
            };
        } else {
            console.log(`  Coverzy API response not successful for AWB ${awb}:`, coverzyResponse);
            return {
                coverzyResponse,
                savedToDatabase: false,
                error: 'Coverzy API response not successful'
            };
        }
    } catch (error) {
        console.error(`Error processing shipment ${awb}:`, error.message);
        throw error;
    }
}

// Process validated shipment (shipment details already fetched and validated)
const processValidatedShipment = async (validationResult, settings) => {
    try {
        const { awb, shipmentDetails, customerInfo } = validationResult;
        console.log(`Processing validated shipment with AWB: ${awb}`);
        
        // Map shipment details to payload
        const payload = await mapShipmentDetailsToPayload(shipmentDetails);
        
        // Send to Covrzy API
        const coverzyResponse = await sendToCovrzyAPI(payload);
        
        // Check if Coverzy API response is successful
        if (coverzyResponse.status === 'success' && coverzyResponse.policyId) {
            // Save shipment data to database
            await saveShipmentToDatabase(
                awb,
                customerInfo.company_name,
                shipmentDetails.Destination_Country,
                coverzyResponse
            );
            
            console.log(`    Successfully processed and saved shipment ${awb}`);
            return {
                coverzyResponse,
                savedToDatabase: true,
                pdfUrl: null // PDF URL not stored in database
            };
        } else {
            console.log(`  Coverzy API response not successful for AWB ${awb}:`, coverzyResponse);
            return {
                coverzyResponse,
                savedToDatabase: false,
                error: 'Coverzy API response not successful'
            };
        }
    } catch (error) {
        console.error(`Error processing validated shipment ${validationResult.awb}:`, error.message);
        throw error;
    }
};

const processPreviousDayShipments = async () => {
    const yesterdayDate = getPreviousDate(); // DD-MM-YYYY format for API
    const yesterdayDateMySQL = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0]; // YYYY-MM-DD format for database
    const jobName = 'coverzy_daily_shipments';
    
    try {
        console.log(`Processing shipments for yesterday's date: ${yesterdayDate}`);
        console.log(`Note: Both fromdate and todate will be set to ${yesterdayDate}`);
        
        // Get coverzy settings for validation
        const settings = await getCoverzySettings();
        console.log(` Loaded coverzy settings:`);
        console.log(`  - Max shipments: ${settings.maxShipments}`);
        console.log(`  - Allowed countries: ${settings.countries.join(', ')}`);
        console.log(`  - Pickup time validation: Before cutoff time (${settings.cutoffTime})`);
        console.log(`  - Min shipment value: $${settings.minShipmentValueUsd} (Rate: ₹${settings.usdToInrRate}/USD)`);
        console.log(`  - Allowed suppliers: ${settings.suppliers.length} suppliers loaded`);
        
        // Get all AWB numbers for yesterday only (both fromdate and todate set to yesterday)
        let awbNumbers;
        try {
            awbNumbers = await getDailyShipmentsData(yesterdayDate, yesterdayDate);
        } catch (error) {
            // Log API failures that prevent the cron from running
            await logErrorToDatabase({
                jobName,
                errorType: 'api_error',
                errorMessage: `Failed to fetch daily shipments data: ${error.message}`,
                errorDetails: { 
                    function: 'getDailyShipmentsData', 
                    date: yesterdayDate,
                    stack: error.stack,
                    statusCode: error.response?.status 
                },
                executionDate: yesterdayDateMySQL
            });
            
            // Send critical error email for API failures
            await sendCronErrorEmail({
                jobName,
                errorType: 'api_error',
                errorMessage: `Critical API Failure: Unable to fetch shipments data - ${error.message}`,
                executionDate: yesterdayDate,
                totalShipments: 0,
                processedShipments: 0,
                failedShipments: 0,
                errorDetails: { 
                    apiEndpoint: 'LEX_DAILY_SHIPMENTS_DATA_API',
                    statusCode: error.response?.status,
                    function: 'getDailyShipmentsData'
                }
            });
            
            throw error; // Re-throw to stop execution
        }
        
        if (awbNumbers.length === 0) {
            console.log('No shipments found for yesterday');
            // Don't log this as an error - it's normal business flow
            return { results: [], errors: [], total: 0, date: yesterdayDate };
        }
        
        console.log(`\n=== Starting Validation Phase ===`);
        console.log(`Found ${awbNumbers.length} total shipments to validate`);
        
        const validShipments = [];
        const invalidShipments = [];
        
        // First pass: Validate all shipments
        for (let i = 0; i < awbNumbers.length; i++) {
            const awb = awbNumbers[i];
            console.log(`\n[${i + 1}/${awbNumbers.length}] Validating AWB: ${awb}`);
            
            try {
                const validationResult = await validateShipmentOnly(awb, settings);
                
                if (validationResult.valid) {
                    validShipments.push(validationResult);
                    console.log(`     ✓ Valid shipment added to processing queue (${validShipments.length} valid so far)`);
                } else {
                    invalidShipments.push(validationResult);
                    // Don't log individual validation errors to database
                }
                
                // Add delay between validations
                await delay(500);
                
            } catch (error) {
                console.error(`   ✗ Error during validation for AWB ${awb}:`, error.message);
                const errorData = {
                    valid: false,
                    awb,
                    error: error.message
                };
                invalidShipments.push(errorData);
                // Don't log individual API errors during validation - only log if it's a systematic failure
            }
        }
        
        console.log(`\n=== Validation Phase Complete ===`);
        console.log(`Total shipments checked: ${awbNumbers.length}`);
        console.log(`Valid shipments found: ${validShipments.length}`);
        console.log(`Invalid shipments: ${invalidShipments.length}`);
        
        if (validShipments.length === 0) {
            console.log('No valid shipments found to process');
            // Don't log this as an error - it's normal business flow when no shipments meet criteria
            return { 
                results: [], 
                errors: invalidShipments.map(inv => ({ awb: inv.awb, error: inv.error })), 
                total: awbNumbers.length, 
                processed: 0,
                validFound: 0,
                date: yesterdayDate 
            };
        }
        
        // Limit valid shipments based on max_shipments setting
        const shipmentsToProcess = validShipments.slice(0, settings.maxShipments);
        
        console.log(`\n=== Starting Processing Phase ===`);
        console.log(`Processing ${shipmentsToProcess.length} valid shipments (limited by max_shipments: ${settings.maxShipments})`);
        
        const results = [];
        const processingErrors = [];
        
        // Second pass: Process only valid shipments up to the limit
        for (let i = 0; i < shipmentsToProcess.length; i++) {
            const validationResult = shipmentsToProcess[i];
            console.log(`\n[${i + 1}/${shipmentsToProcess.length}] Processing AWB: ${validationResult.awb}`);
            
            try {
                const result = await processValidatedShipment(validationResult, settings);
                results.push({ awb: validationResult.awb, success: true, result });
            } catch (error) {
                console.error(`Failed to process validated shipment ${validationResult.awb}:`, error.message);
                processingErrors.push({ awb: validationResult.awb, error: error.message });
                // Don't log individual processing errors - only log systematic failures
            }
            
            // Add a delay between processing shipments
            await delay(1000);
        }
        
        // Combine validation errors and processing errors
        const allErrors = [
            ...invalidShipments.map(inv => ({ awb: inv.awb, error: inv.error })),
            ...processingErrors
        ];
        
        console.log(`\n=== Processing Summary for ${yesterdayDate} ===`);
        console.log(`Total shipments found: ${awbNumbers.length}`);
        console.log(`Valid shipments found: ${validShipments.length}`);
        console.log(`Processed (limited by settings): ${shipmentsToProcess.length}`);
        console.log(`Successfully processed: ${results.length}`);
        console.log(`Failed validation: ${invalidShipments.length}`);
        console.log(`Failed processing: ${processingErrors.length}`);
        console.log(`Skipped valid shipments due to limit: ${validShipments.length - shipmentsToProcess.length}`);
        
        if (invalidShipments.length > 0) {
            console.log('\nShipments that failed validation:');
            invalidShipments.forEach(invalid => console.log(`- ${invalid.awb}: ${invalid.error}`));
        }
        
        if (processingErrors.length > 0) {
            console.log('\nValid shipments that failed processing:');
            processingErrors.forEach(error => console.log(`- ${error.awb}: ${error.error}`));
        }
        
        // Only send daily summary for successful runs, don't send low success rate emails
        // as those are business logic issues, not system failures
        const successRate = shipmentsToProcess.length > 0 ? (results.length / shipmentsToProcess.length) * 100 : 0;
        
        if (successRate >= 80) {
            // Send daily summary email for successful runs
            await sendDailySummaryEmail({
                executionDate: yesterdayDate,
                totalShipments: awbNumbers.length,
                validShipments: validShipments.length,
                processedShipments: shipmentsToProcess.length,
                successfulShipments: results.length,
                failedValidation: invalidShipments.length,
                failedProcessing: processingErrors.length
            });
        }
        // Don't send error emails for low success rates - that's normal business flow
        
        return { 
            results, 
            errors: allErrors, 
            total: awbNumbers.length, 
            processed: shipmentsToProcess.length,
            validFound: validShipments.length,
            date: yesterdayDate 
        };
    } catch (error) {
        console.error('Critical error processing previous day shipments:', error.message);
        
        // Log critical error to database
        await logErrorToDatabase({
            jobName,
            errorType: 'cron_failure',
            errorMessage: `Critical cron failure: ${error.message}`,
            errorDetails: { function: 'processPreviousDayShipments', stack: error.stack },
            executionDate: yesterdayDateMySQL
        });
        
        // Send critical error email
        await sendCronErrorEmail({
            jobName,
            errorType: 'cron_failure',
            errorMessage: `Critical cron job failure: ${error.message}`,
            executionDate: yesterdayDate,
            totalShipments: 0,
            processedShipments: 0,
            failedShipments: 0,
            errorDetails: { 
                function: 'processPreviousDayShipments',
                timestamp: new Date().toISOString(),
                stack: error.stack
            }
        });
        
        throw error;
    }
}

const processShipmentsForDate = async (date) => {
    try {
        console.log(`Processing shipments for date: ${date}`);
        
        // Get coverzy settings for validation
        const settings = await getCoverzySettings();
        console.log(`    Loaded coverzy settings:`);
        console.log(`  - Max shipments: ${settings.maxShipments}`);
        console.log(`  - Allowed countries: ${settings.countries.join(', ')}`);
        console.log(`  - Pickup time validation: Before cutoff time (${settings.cutoffTime})`);
        console.log(`  - Min shipment value: $${settings.minShipmentValueUsd} (Rate: ₹${settings.usdToInrRate}/USD)`);
        console.log(`  - Allowed suppliers: ${settings.suppliers.length} suppliers loaded`);
        
        // Get all AWB numbers for the specified date
        const awbNumbers = await getDailyShipmentsData(date);
        
        if (awbNumbers.length === 0) {
            console.log(`No shipments found for date: ${date}`);
            return { results: [], errors: [], total: 0, processed: 0 };
        }
        
        // Limit shipments based on max_shipments setting
        const limitedAwbNumbers = awbNumbers.slice(0, settings.maxShipments);
        if (awbNumbers.length > settings.maxShipments) {
            console.log(`  Limited processing to ${settings.maxShipments} shipments (found ${awbNumbers.length} total)`);
        }
        
        const results = [];
        const errors = [];
        
        // Process each shipment
        for (const awb of limitedAwbNumbers) {
            try {
                const result = await processShipment(awb, settings);
                results.push({ awb, success: true, result });
            } catch (error) {
                console.error(`Failed to process shipment ${awb}:`, error.message);
                errors.push({ awb, error: error.message });
            }
            
            // Add a small delay between processing shipments
            await delay(1000);
        }
        
        console.log(`\n=== Processing Summary for ${date} ===`);
        console.log(`Total shipments found: ${awbNumbers.length}`);
        console.log(`Processed (limited by settings): ${limitedAwbNumbers.length}`);
        console.log(`Successfully processed: ${results.length}`);
        console.log(`Failed validation/processing: ${errors.length}`);
        console.log(`Skipped due to limit: ${awbNumbers.length - limitedAwbNumbers.length}`);
        
        return { 
            results, 
            errors, 
            total: awbNumbers.length, 
            processed: limitedAwbNumbers.length 
        };
    } catch (error) {
        console.error(`Error processing shipments for date ${date}:`, error.message);
        throw error;
    }
}

module.exports = {
    processShipment,
    processPreviousDayShipments,
    processShipmentsForDate,
    getDailyShipmentsData,
    getShipmentDetails,
    getCustomerDetails,
    mapShipmentDetailsToPayload,
    sendToCovrzyAPI,
    saveShipmentToDatabase,
    getPreviousDate,
    getCoverzySettings,
    isDestinationAllowed,
    isSupplierAllowed,
    isPickupTimeValid,
    isShipmentValueValid,
    convertInrToUsd,
    validateShipmentOnly,
    processValidatedShipment,
    logErrorToDatabase,
    calculateETA,
    getCarrierInfo,
    isServiceDestinationValid
};