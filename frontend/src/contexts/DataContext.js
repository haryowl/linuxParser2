import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSnackbar } from 'notistack';
import { useWebSocketMessage } from '../hooks/useWebSocket';
import { BASE_URL } from '../services/api';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [devices, setDevices] = useState([]);
  const [records, setRecords] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalDevices: 0,
    activeDevices: 0,
    totalRecords: 0,
    totalAlerts: 0,
    lastUpdate: null
  });
  const [serverStatsLoaded, setServerStatsLoaded] = useState(false);
  const { enqueueSnackbar } = useSnackbar();
  const { user, loading: authLoading } = useAuth();

  const handleWebSocketMessage = useCallback((message) => {
    try {
      const { topic, data } = message;

      switch (topic) {
        case 'device_update':
        case 'device_updated':
          setDevices((prevDevices) => {
            const index = prevDevices.findIndex((d) => d.imei === data.imei);
            if (index >= 0) {
              const updated = [...prevDevices];
              updated[index] = { ...updated[index], ...data };
              return updated;
            }
            return [...prevDevices, data];
          });
          break;

        case 'new_record':
          setRecords((prevRecords) => [data, ...prevRecords.slice(0, 999)]);
          setStats((prev) => ({
            ...prev,
            totalRecords: prev.totalRecords + 1,
            lastUpdate: new Date()
          }));
          break;

        case 'new_alert':
          setAlerts((prevAlerts) => [data, ...prevAlerts.slice(0, 99)]);
          setStats((prev) => ({
            ...prev,
            totalAlerts: prev.totalAlerts + 1,
            lastUpdate: new Date()
          }));
          enqueueSnackbar(`New alert: ${data.message}`, { variant: 'warning' });
          break;

        case 'system_status':
          setStats((prev) => ({
            ...prev,
            ...data,
            lastUpdate: new Date()
          }));
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  }, [enqueueSnackbar]);

  useWebSocketMessage(handleWebSocketMessage);

  const fetchDevices = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/devices`, {
        credentials: 'include'
      });

      if (response.ok) {
        const deviceList = await response.json();
        setDevices(deviceList);
        return deviceList;
      }
      return [];
    } catch (err) {
      console.error('Error fetching devices:', err);
      return [];
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/records?range=1h&limit=100&lite=1`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setRecords(data);
        return data;
      }
      return [];
    } catch (err) {
      console.error('Error fetching records:', err);
      return [];
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/alerts`, {
        credentials: 'include'
      });
      if (!response.ok) {
        if (response.status === 401) {
          setAlerts([]);
          return;
        }
        throw new Error('Failed to fetch alerts');
      }
      const data = await response.json();
      setAlerts(data);
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError('Failed to load alerts');
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/dashboard/stats`, {
        credentials: 'include'
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setStats((prev) => ({
        ...prev,
        ...data,
        lastUpdate: new Date()
      }));
      setServerStatsLoaded(true);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return undefined;
    }

    if (!user) {
      setDevices([]);
      setRecords([]);
      setAlerts([]);
      setError(null);
      setServerStatsLoaded(false);
      setStats({
        totalDevices: 0,
        activeDevices: 0,
        totalRecords: 0,
        totalAlerts: 0,
        lastUpdate: null
      });
      setLoading(false);
      setLoadingSecondary(false);
      return undefined;
    }

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      setLoadingSecondary(true);
      setError(null);

      try {
        // Critical path: devices only — unlock Dashboard shell asap
        await fetchDevices();
        if (!cancelled) {
          setLoading(false);
        }

        // Non-blocking: alerts first (usually empty/fast), then records + stats
        void fetchAlerts().catch((err) => {
          if (!cancelled) console.error('Alerts load failed:', err);
        });

        // Defer Records/stats slightly so /locations can use free DB connection
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (cancelled) return;

        void Promise.all([
          fetchRecords(),
          fetchStats()
        ]).catch((err) => {
          if (!cancelled) {
            console.error('Secondary data load failed:', err);
            setError('Failed to load some application data');
          }
        }).finally(() => {
          if (!cancelled) {
            setLoadingSecondary(false);
          }
        });
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load application data');
          setLoading(false);
          setLoadingSecondary(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, fetchDevices, fetchRecords, fetchAlerts, fetchStats]);

  useEffect(() => {
    if (authLoading || !user) {
      return undefined;
    }

    const interval = setInterval(() => {
      fetchStats();
    }, 30000);

    return () => clearInterval(interval);
  }, [authLoading, user, fetchStats]);

  useEffect(() => {
    if (serverStatsLoaded) {
      return;
    }
    setStats((prev) => ({
      ...prev,
      totalDevices: devices.length,
      activeDevices: devices.filter((d) => d.status === 'active').length,
      totalRecords: records.length,
      totalAlerts: alerts.length,
      lastUpdate: new Date()
    }));
  }, [devices, records, alerts, serverStatsLoaded]);

  const value = {
    devices,
    records,
    alerts,
    stats,
    loading,
    loadingSecondary,
    error,
    refreshDevices: fetchDevices,
    refreshRecords: fetchRecords,
    refreshAlerts: fetchAlerts,
    refreshStats: fetchStats
  };

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
