import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('bssbms_token');
    const saved = localStorage.getItem('bssbms_user');
    if (token && saved) {
      setUser(JSON.parse(saved));
      api.get('/auth/me')
        .then((res) => {
          setUser(res.data.data.user);
          localStorage.setItem('bssbms_user', JSON.stringify(res.data.data.user));
        })
        .catch(() => {
          localStorage.removeItem('bssbms_token');
          localStorage.removeItem('bssbms_user');
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { token, user } = res.data.data;
    localStorage.setItem('bssbms_token', token);
    localStorage.setItem('bssbms_user', JSON.stringify(user));
    setUser(user);
    return user;
  };

  const logout = () => {
    localStorage.removeItem('bssbms_token');
    localStorage.removeItem('bssbms_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
