import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import { useAuthStore } from './store/auth.store';

function App() {
  const { token, checkAuth } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    setLoading(false);
  }, [checkAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={token ? <Navigate to="/" /> : <LoginPage />}
        />
        <Route
          path="/"
          element={token ? <DashboardPage /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;






