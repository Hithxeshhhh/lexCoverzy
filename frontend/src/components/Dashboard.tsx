import ManageCoverzySettings from "./ManageCoverzySettings";
import ViewPolicies from "./ViewPolicies";
import { FileText, LogOut, Settings, User } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar';

const Dashboard = () => {
  const [activeSection, setActiveSection] = useState<'settings' | 'policies'>('settings');
  const { logout, user } = useAuth();
  const { toast } = useToast();

  const handleLogout = () => {
    logout();
    toast({
      title: "Logged Out",
      description: "You have been successfully logged out.",
    });
  };

  const menuItems = [
    {
      title: 'Manage Coverzy Settings',
      icon: Settings,
      key: 'settings' as const,
    },
    {
      title: 'View Policies',
      icon: FileText,
      key: 'policies' as const,
    },
  ];

  const AppSidebar = () => (
    <Sidebar>
      <SidebarContent>
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-gray-900">Lexcoverzy Admin</h1>
        </div>
        
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    onClick={() => setActiveSection(item.key)}
                    isActive={activeSection === item.key}
                    className="w-full justify-start"
                  >
                    <item.icon className="mr-3 h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="px-2 py-1 mb-2">
              <div className="flex items-center text-sm text-gray-600">
                <User className="mr-2 h-4 w-4" />
                <span className="truncate">{user?.username}</span>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              className="w-full justify-start text-red-600 hover:bg-red-50"
            >
              <LogOut className="mr-3 h-4 w-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <SidebarInset>
          <div className="flex flex-col h-full">
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <div className="ml-auto" />
            </header>
            <main className="flex-1 p-4 md:p-8">
              {activeSection === 'settings' ? (
                <ManageCoverzySettings />
              ) : (
                <ViewPolicies />
              )}
            </main>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Dashboard;
