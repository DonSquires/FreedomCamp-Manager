import React, { useState } from 'react';
import { PlateScanner } from './PlateScanner';
import { OfficerDashboard } from './OfficerDashboard';
import { OfficerReports } from './OfficerReports';

// The three "Mini-Portals"
type ViewMode = 'SCANNER' | 'DASHBOARD' | 'REPORTS';

export const FieldOfficerPortal = () => {
  const [currentView, setCurrentView] = useState<ViewMode>('SCANNER');
  const [currentZoneId, setCurrentZoneId] = useState<string | null>(null);

  // Simple Tab Navigation
  const renderView = () => {
    switch (currentView) {
      case 'SCANNER':
        return <PlateScanner zoneId={currentZoneId} />;
      case 'DASHBOARD':
        return <OfficerDashboard />;
      case 'REPORTS':
        return <OfficerReports />;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Top Bar: Zone Selector & Status */}
      <header className="bg-blue-900 text-white p-4 shadow-md">
        <div className="flex justify-between items-center">
          <h1 className="font-bold text-lg">Officer Portal</h1>
          <div className="text-xs bg-blue-800 px-2 py-1 rounded">
            {currentZoneId ? `Zone: ${currentZoneId}` : 'Detecting Zone...'}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-2">
        {renderView()}
      </main>

      {/* Bottom Navigation Tabs */}
      <nav className="bg-white border-t border-gray-200 flex justify-around p-3 pb-5">
        <NavButton 
          label="Scan" 
          active={currentView === 'SCANNER'} 
          onClick={() => setCurrentView('SCANNER')} 
        />
        <NavButton 
          label="Stats" 
          active={currentView === 'DASHBOARD'} 
          onClick={() => setCurrentView('DASHBOARD')} 
        />
        <NavButton 
          label="Reports" 
          active={currentView === 'REPORTS'} 
          onClick={() => setCurrentView('REPORTS')} 
        />
      </nav>
    </div>
  );
};

const NavButton = ({ label, active, onClick }: any) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center ${active ? 'text-blue-600 font-bold' : 'text-gray-500'}`}
  >
    {/* Icon placeholder */}
    <span className="text-sm">{label}</span>
  </button>
);
