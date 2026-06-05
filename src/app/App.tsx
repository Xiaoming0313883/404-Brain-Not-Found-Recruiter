import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Toaster } from 'sonner';
import { CandidatePortal } from './components/CandidatePortal';
import { DemoReset } from './components/DemoReset';
import { HiringManagerPortal } from './components/HiringManagerPortal';
import { PortalSelector } from './components/PortalSelector';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PortalSelector />} />
        <Route path="/reset" element={<DemoReset />} />
        <Route path="/candidate/*" element={<CandidatePortal />} />
        <Route path="/hiring-manager/*" element={<HiringManagerPortal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  );
}
