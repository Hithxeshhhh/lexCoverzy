import axios from "axios";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const ViewPolicies = () => {
  const { toast } = useToast();
  
  // Environment-based URL selection
  let backendUrl = '';
  if (import.meta.env.VITE_ENV === 'prod') {
    backendUrl = import.meta.env.VITE_BACKEND_PROD_URL;
  } else {
    backendUrl = import.meta.env.VITE_BACKEND_LOCAL_URL;
  }
  
  const [startDate, setStartDate] = useState('2025-06-30');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [isSuppliersLoading, setIsSuppliersLoading] = useState(true);

  // Fetch suppliers from settings on component mount
  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      setIsSuppliersLoading(true);
      const response = await axios.get(`${backendUrl}/api/v1/coverzy-settings`, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;
      
      if (data.success && data.data && data.data.length > 0) {
        const settings = data.data[0]; // Get the first (latest) settings record
        
        // Parse supplier_names (comma-separated string) into array
        if (settings.supplier_names) {
          const supplierArray = settings.supplier_names
            .split(',')
            .map(supplier => supplier.trim())
            .filter(supplier => supplier.length > 0);
          setSuppliers(supplierArray);
        }
      } else {
        console.warn('No settings found for suppliers');
        toast({
          title: "Warning",
          description: "Could not load supplier list from settings.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast({
        title: "Error Loading Suppliers",
        description: "Failed to load supplier list. Using default options.",
        variant: "destructive",
      });
      // Fallback to default suppliers if API fails
      setSuppliers([
        'V T GEMS',
        'MACHINERY AND AUTOCRAFT STORE', 
        'AURA GEMSTONES',
        'GEMS PLANET',
        'YAHVI FASHION',
        'JEWELLERY HUB'
      ]);
    } finally {
      setIsSuppliersLoading(false);
    }
  };

  const handleFilter = async () => {
    try {
      setIsLoading(true);
      
      // Validate required fields
      if (!startDate || !endDate) {
        toast({
          title: "Validation Error",
          description: "Please select both start and end dates.",
          variant: "destructive",
        });
        return;
      }

      // Format dates for API (YYYY-MM-DD)
      const filterData = {
        fromdate: startDate,
        todate: endDate,
        // Only include supplier_name if one is selected
        ...(selectedSupplier && selectedSupplier.trim() !== '' && { supplier_name: selectedSupplier })
      };

      console.log('Filtering policies with:', filterData);

      const response = await axios.post(`${backendUrl}/api/v1/shipments/filter`, filterData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_BEARER_TOKEN}`
        }
      });

      const data = response.data;

      if (data.success) {
        setPolicies(data.data || []);
        setShowTable(true);
        
        toast({
          title: "Policies Loaded",
          description: `Found ${data.total_records || 0} shipment(s) for the selected criteria.`,
        });
      } else {
        throw new Error(data.message || 'Failed to fetch policies');
      }
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast({
        title: "Error Loading Policies",
        description: "Failed to load policies. Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to handle PDF viewing with API key
  const handlePdfView = async (pdfUrl, policyId) => {
    if (!pdfUrl) return;

    try {
      // Show loading state
      toast({
        title: "Loading PDF",
        description: "Please wait while we fetch the PDF...",
      });

      // Fetch PDF with x-api-key header using axios
      const response = await axios.get(pdfUrl, {
        headers: {
          'x-api-key': import.meta.env.VITE_ADMIN_API_KEY_UPLOADING_PDF
        },
        responseType: 'blob' // Important: tells axios to expect binary data
      });

      // Create a URL for the blob and open it
      const blobUrl = URL.createObjectURL(response.data);
      window.open(blobUrl, '_blank');
      
      // Clean up the blob URL after a delay
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 5000); // Increased delay to 5 seconds

    } catch (error) {
      console.error('Error viewing PDF:', error);
      toast({
        title: "Error Loading PDF",
        description: "Failed to load the PDF. Please check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  // Helper function to handle PDF download with API key
  const handlePdfDownload = async (pdfUrl, policyId) => {
    if (!pdfUrl) return;

    try {
      // Show loading state
      toast({
        title: "Downloading PDF",
        description: "Please wait while we download the PDF...",
      });

      // Fetch PDF with x-api-key header using axios
      const response = await axios.get(pdfUrl, {
        headers: {
          'x-api-key': import.meta.env.VITE_ADMIN_API_KEY_UPLOADING_PDF
        },
        responseType: 'blob' // Important: tells axios to expect binary data
      });

      // Create a download link
      const blobUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `policy_${policyId || 'document'}.pdf`; // Set filename
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1000);

      toast({
        title: "Download Started",
        description: "PDF download has started successfully.",
      });

    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast({
        title: "Error Downloading PDF",
        description: "Failed to download the PDF. Please check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  // Format date for display (DD-MM-YYYY)
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    } catch (error) {
      return dateString;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl">View Policies</CardTitle>
          <CardDescription>
            Filter and view policy information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date:</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">End Date:</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier:</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier} disabled={isSuppliersLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={isSuppliersLoading ? "Loading suppliers..." : "Select supplier (optional)"} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier} value={supplier}>
                      {supplier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            onClick={handleFilter} 
            className="w-full sm:w-auto"
            disabled={isLoading}
          >
            {isLoading ? "Filtering..." : "Filter"}
          </Button>
        </CardContent>
      </Card>

      {showTable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">
              Policy Results ({policies.length} shipment{policies.length !== 1 ? 's' : ''})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {policies.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No policies found for the selected criteria.</p>
                <p className="text-sm text-gray-400 mt-2">Try adjusting your date range or removing the supplier filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Shipment ID</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Supplier Name</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Destination</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Policy ID</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Amount</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Currency</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Created Date</th>
                      <th className="border border-gray-300 px-2 py-2 text-left text-xs md:text-sm font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy, index) => (
                      <tr key={policy.id || index} className="hover:bg-gray-50">
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.shipment_id || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.supplier_name || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.destination_country || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.policy_id || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.amount || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{policy.currency || 'N/A'}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">{formatDate(policy.created_at)}</td>
                        <td className="border border-gray-300 px-2 py-2 text-xs md:text-sm">
                          {policy.view_pdf ? (
                            <div className="flex flex-col sm:flex-row gap-1">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => handlePdfView(policy.view_pdf, policy.policy_id)}
                              >
                                View
                              </Button>
                              <Button 
                                variant="default" 
                                size="sm" 
                                className="text-xs"
                                onClick={() => handlePdfDownload(policy.view_pdf, policy.policy_id)}
                              >
                                Download
                              </Button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">PDF NOT AVAILABLE</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ViewPolicies;
