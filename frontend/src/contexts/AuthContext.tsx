import React, { ReactNode, createContext, useContext, useEffect, useState } from "react";
import axios from "axios";

interface User {
  username: string;
  role: string;
  loginTime: string;
  tokenExpiry: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Environment-based URL selection
  let BACKEND_URL = '';
  if (import.meta.env.VITE_ENV === 'prod') {
    BACKEND_URL = import.meta.env.VITE_BACKEND_PROD_URL;
  } else {
    BACKEND_URL = import.meta.env.VITE_BACKEND_LOCAL_URL;
  }

  // Check authentication status on app load
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const storedToken = localStorage.getItem('lexcoverzy_token');
      const storedUser = localStorage.getItem('lexcoverzy_user');
      
      if (storedToken && storedUser) {
        const userData = JSON.parse(storedUser);
        
        // Check if token is expired locally first
        if (userData.tokenExpiry && new Date() < new Date(userData.tokenExpiry)) {
          // Verify token with backend
          try {
            const response = await axios.get(`${BACKEND_URL}/api/auth/verify-token`, {
              headers: {
                'Authorization': `Bearer ${storedToken}`
              }
            });

            if (response.data.success) {
              setToken(storedToken);
              setUser(userData);
              setIsAuthenticated(true);
            } else {
              clearAuthData();
            }
          } catch (error) {
            console.log('Token verification failed:', error);
            clearAuthData();
          }
        } else {
          // Token expired locally
          clearAuthData();
        }
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      clearAuthData();
    } finally {
      setLoading(false);
    }
  };

  const clearAuthData = () => {
    localStorage.removeItem('lexcoverzy_token');
    localStorage.removeItem('lexcoverzy_user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  const login = async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/login`, {
        username: username.trim(),
        password: password.trim()
      });

      if (response.data.success) {
        const { token: authToken, user: userData } = response.data.data;
        
        // Store in localStorage
        localStorage.setItem('lexcoverzy_token', authToken);
        localStorage.setItem('lexcoverzy_user', JSON.stringify(userData));
        
        // Update state
        setToken(authToken);
        setUser(userData);
        setIsAuthenticated(true);
        
        return { success: true };
      } else {
        return { success: false, message: response.data.message || 'Login failed' };
      }
    } catch (error: any) {
      console.error('Login error:', error);
      
      if (error.response?.data?.message) {
        return { success: false, message: error.response.data.message };
      } else if (error.response?.status === 401) {
        return { success: false, message: 'Invalid username or password' };
      } else {
        return { success: false, message: 'Network error. Please try again.' };
      }
    }
  };

  const logout = async () => {
    try {
      // Call backend logout endpoint (optional)
      if (token) {
        await axios.post(`${BACKEND_URL}/api/auth/logout`, {}, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      // Clear local auth data regardless of API call success
      clearAuthData();
    }
  };

  const value: AuthContextType = {
    isAuthenticated,
    user,
    token,
    login,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use the auth context
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext; 