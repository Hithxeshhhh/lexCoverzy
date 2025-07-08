import axios from "axios";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const ManageCoverzySettings = () => {
  const { toast } = useToast();
  
  // Environment-based URL selection
  let backendUrl = '';
  if (import.meta.env.VITE_ENV === 'prod') {
    backendUrl = import.meta.env.VITE_BACKEND_PROD_URL;
  } else {
    backendUrl = import.meta.env.VITE_BACKEND_LOCAL_URL;
  }
  
  // Current form values
  const [supplierNames, setSupplierNames] = useState('');
  const [destinationCountries, setDestinationCountries] = useState('');
  const [maxShipments, setMaxShipments] = useState('');
  const [cutoffTime, setCutoffTime] = useState('');
  const [cipTime, setCipTime] = useState('');
  const [minShipmentValueUsd, setMinShipmentValueUsd] = useState('');
  const [usdToInrRate, setUsdToInrRate] = useState('');
  const [adminEmails, setAdminEmails] = useState(['']);
  
  // Email service toggle
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [isTogglingEmail, setIsTogglingEmail] = useState(false);
  
  // Original values for comparison
  const [originalValues, setOriginalValues] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Fetch current settings and email status on component mount
  useEffect(() => {
    fetchSettings();
    fetchEmailStatus();
  }, []);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${backendUrl}/api/v1/coverzy-settings`, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;
      
      if (data.success && data.data && data.data.length > 0) {
        const settings = data.data[0]; // Get the first (latest) settings record
        
        // Set form values
        setSupplierNames(settings.supplier_names || '');
        setDestinationCountries(settings.destination_countries || '');
        setMaxShipments(settings.max_shipments?.toString() || '');
        setCutoffTime(settings.cutoff_time || '');
        setCipTime(settings.cip_time || '');
        setMinShipmentValueUsd(settings.min_shipment_value_usd?.toString() || '');
        setUsdToInrRate(settings.usd_to_inr_rate?.toString() || '');
        setAdminEmails(settings.admin_emails ? settings.admin_emails.split(',').map(email => email.trim()) : ['']);
        
        // Store original values for comparison
        setOriginalValues({
          supplier_names: settings.supplier_names || '',
          destination_countries: settings.destination_countries || '',
          max_shipments: settings.max_shipments?.toString() || '',
          cutoff_time: settings.cutoff_time || '',
          cip_time: settings.cip_time || '',
          min_shipment_value_usd: settings.min_shipment_value_usd?.toString() || '',
          usd_to_inr_rate: settings.usd_to_inr_rate?.toString() || '',
          admin_emails: settings.admin_emails ? settings.admin_emails.split(',').map(email => email.trim()) : ['']
        });

        
      } else {
        toast({
          title: "No Settings Found",
          description: "No existing settings found. You can create new settings.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast({
        title: "Error Loading Settings",
        description: "Failed to load current settings. Please check your connection.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchEmailStatus = async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/v1/email/status`, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;
      
      if (data.success && data.data) {
        setEmailEnabled(data.data.emailEnabled || false);
      }
    } catch (error) {
      console.error('Error fetching email status:', error);
      // Don't show toast for email status failure as it's not critical
      // Just log the error and keep default state
    }
  };

  const handleEmailToggle = async (enabled) => {
    try {
      setIsTogglingEmail(true);
      
      const response = await axios.post(`${backendUrl}/api/v1/email/toggle`, {
        enabled: enabled
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;
      
      if (data.success) {
        setEmailEnabled(enabled);
        toast({
          title: `Email Service ${enabled ? 'Enabled' : 'Disabled'}`,
          description: `Email notifications are now ${enabled ? 'enabled' : 'disabled'}.`,
        });
      } else {
        throw new Error(data.message || 'Failed to toggle email service');
      }
    } catch (error) {
      console.error('Error toggling email service:', error);
      toast({
        title: "Error Toggling Email Service",
        description: "Failed to change email service status. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTogglingEmail(false);
    }
  };

  // Helper functions for managing admin emails
  const addAdminEmail = () => {
    setAdminEmails([...adminEmails, '']);
  };

  const removeAdminEmail = (index) => {
    if (adminEmails.length > 1) {
      const newEmails = adminEmails.filter((_, i) => i !== index);
      setAdminEmails(newEmails);
    }
  };

  const updateAdminEmail = (index, value) => {
    const newEmails = [...adminEmails];
    newEmails[index] = value;
    setAdminEmails(newEmails);
  };

  // Count the number of changed fields
  const getChangedFields = () => {
    const currentValues = {
      supplier_names: supplierNames,
      destination_countries: destinationCountries,
      max_shipments: maxShipments,
      cutoff_time: cutoffTime,
      cip_time: cipTime,
      min_shipment_value_usd: minShipmentValueUsd,
      usd_to_inr_rate: usdToInrRate,
      admin_emails: adminEmails
    };

    const changedFields = {};
    let changeCount = 0;

    Object.keys(currentValues).forEach(key => {
      if (currentValues[key] !== originalValues[key]) {
        changedFields[key] = currentValues[key];
        changeCount++;
      }
    });

    return { changedFields, changeCount };
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      
      const { changedFields, changeCount } = getChangedFields();
      
      if (changeCount === 0) {
        toast({
          title: "No Changes",
          description: "No changes detected. Nothing to save.",
        });
        return;
      }

      // Determine API method based on number of changes
      const isMajorChange = changeCount >= 3;
      const method = isMajorChange ? 'PUT' : 'PATCH';
      const endpoint = `${backendUrl}/api/v1/coverzy-settings`;

      // Prepare payload based on method
      let payload;
      if (isMajorChange) {
        // PUT: Send all fields
        payload = {
          supplier_names: supplierNames,
          destination_countries: destinationCountries,
          max_shipments: parseInt(maxShipments),
          cutoff_time: cutoffTime,
          cip_time: cipTime,
          min_shipment_value_usd: parseFloat(minShipmentValueUsd),
          usd_to_inr_rate: parseFloat(usdToInrRate),
          admin_emails: adminEmails
        };
      } else {
        // PATCH: Send only changed fields
        payload = { ...changedFields };
        if (payload.max_shipments) {
          payload.max_shipments = parseInt(payload.max_shipments);
        }
        if (payload.min_shipment_value_usd) {
          payload.min_shipment_value_usd = parseFloat(payload.min_shipment_value_usd);
        }
        if (payload.usd_to_inr_rate) {
          payload.usd_to_inr_rate = parseFloat(payload.usd_to_inr_rate);
        }
      }

      const response = await axios({
        method: method,
        url: endpoint,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        },
        data: payload,
      });

      const data = response.data;
      
      if (data.success) {
        // Update original values after successful save
        setOriginalValues({
          supplier_names: supplierNames,
          destination_countries: destinationCountries,
          max_shipments: maxShipments,
          cutoff_time: cutoffTime,
          cip_time: cipTime,
          min_shipment_value_usd: minShipmentValueUsd,
          usd_to_inr_rate: usdToInrRate,
          admin_emails: adminEmails
        });

        toast({
          title: "Settings Saved",
          description: `Your Coverzy settings have been saved successfully  (${changeCount} field${changeCount > 1 ? 's' : ''} changed).`,
        });
      } else {
        throw new Error(data.message || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error Saving Settings",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setIsResetting(true);
      
      const response = await axios.post(`${backendUrl}/api/v1/coverzy-settings/reset`, {}, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;
      
      if (data.success) {
        toast({
          title: "Settings Reset",
          description: "Coverzy settings have been reset to default values successfully.",
        });
        
        // Reload settings to show the default values
        await fetchSettings();
      } else {
        throw new Error(data.message || 'Failed to reset settings');
      }
    } catch (error) {
      console.error('Error resetting settings:', error);
      toast({
        title: "Error Resetting Settings",
        description: "Failed to reset settings to defaults. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl">Manage Coverzy Settings</CardTitle>
          <CardDescription>
            Configure your Coverzy settings and preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                <p className="text-sm text-gray-600">Loading settings...</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:gap-6">
              <div className="space-y-2">
                <Label htmlFor="suppliers">Supplier Names (comma separated):</Label>
                <textarea
                  id="suppliers"
                  className="w-full min-h-[100px] px-3 py-2 text-sm border border-input rounded-md bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-vertical"
                  value={supplierNames}
                  onChange={(e) => setSupplierNames(e.target.value)}
                  placeholder="Enter supplier names separated by commas"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="countries">Destination Countries (comma separated):</Label>
                  <Input
                    id="countries"
                    value={destinationCountries}
                    onChange={(e) => setDestinationCountries(e.target.value)}
                    placeholder="US,GB,UK"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxShipments">Max Shipments per Day:</Label>
                  <Input
                    id="maxShipments"
                    type="number"
                    value={maxShipments}
                    onChange={(e) => setMaxShipments(e.target.value)}
                    placeholder="20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cutoffTime">Daily Cutoff Time (HH:MM:SS):</Label>
                  <Input
                    id="cutoffTime"
                    type="time"
                    step="1"
                    value={cutoffTime}
                    onChange={(e) => setCutoffTime(e.target.value + ':00')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cipTime">CIP Initiation Time (HH:MM:SS):</Label>
                  <Input
                    id="cipTime"
                    type="time"
                    step="1"
                    value={cipTime}
                    onChange={(e) => setCipTime(e.target.value + ':00')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minShipmentValue">Minimum Shipment Value (USD):</Label>
                  <Input
                    id="minShipmentValue"
                    type="number"
                    step="0.01"
                    min="0"
                    value={minShipmentValueUsd}
                    onChange={(e) => setMinShipmentValueUsd(e.target.value)}
                    placeholder="20.00"
                  />
                  <p className="text-xs text-gray-600">
                    Shipments below this USD value will be rejected
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="usdToInrRate">USD to INR Exchange Rate:</Label>
                  <Input
                    id="usdToInrRate"
                    type="number"
                    step="0.0001"
                    min="0"
                    value={usdToInrRate}
                    onChange={(e) => setUsdToInrRate(e.target.value)}
                    placeholder="83.0000"
                  />
                  <p className="text-xs text-gray-600">
                    Rate used to convert INR shipment values to USD for validation
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Admin Emails:</Label>
                {adminEmails.map((email, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => updateAdminEmail(index, e.target.value)}
                      placeholder="admin@example.com"
                    />
                    {adminEmails.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeAdminEmail(index)}
                        className="px-3"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAdminEmail}
                  className="w-fit"
                >
                  + Add Another Email
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50/50">
                  <div className="space-y-1">
                    <Label htmlFor="emailToggle" className="text-sm font-medium">
                      Email Notifications
                    </Label>
                    <p className="text-xs text-gray-600">
                      {emailEnabled ? 'Email alerts and notifications are enabled' : 'Email alerts and notifications are disabled'}
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    {isTogglingEmail && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    )}
                    <Switch
                      id="emailToggle"
                      checked={emailEnabled}
                      onCheckedChange={handleEmailToggle}
                      disabled={isTogglingEmail}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row gap-3">
                <Button 
                  onClick={handleSave} 
                  className="w-full sm:w-auto" 
                  disabled={isSaving || isResetting}
                >
                  {isSaving ? "Saving..." : "Save Settings"}
                </Button>
                <Button 
                  onClick={handleReset} 
                  variant="outline"
                  className="w-full sm:w-auto" 
                  disabled={isSaving || isResetting}
                >
                  {isResetting ? "Resetting..." : "Reset to Defaults"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ManageCoverzySettings;
