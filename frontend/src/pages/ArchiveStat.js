// frontend/src/pages/ArchiveStat.js

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip
} from '@mui/material';
import useWebSocket from '../hooks/useWebSocket';
import { apiFetchArchiveStats } from '../services/api';

const ArchiveStat = () => {
  const [stats, setStats] = useState([]);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiFetchArchiveStats();
      const data = await response.json();
      if (response.ok) {
        setStats(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      setStats([]);
    }
  }, []);

  const handleWebSocketMessage = useCallback((message) => {
    if (message.topic !== 'archivestat_update') return;
    setStats(prev => {
      const incoming = message.data || message;
      const index = prev.findIndex(item => item.imei === incoming.imei);
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], ...incoming, isConnected: true };
        return next;
      }
      return [{ ...incoming, isConnected: true }, ...prev];
    });
  }, []);

  useWebSocket(null, handleWebSocketMessage);

  useEffect(() => {
    loadStats();
    const intervalId = setInterval(loadStats, 30000);
    return () => clearInterval(intervalId);
  }, [loadStats]);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>Archive Stat</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Last known archive queue status per device. Data is kept after disconnect and server restart.
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Device Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Serv1 Data Transmitted</TableCell>
              <TableCell>Serv1 Data Queue</TableCell>
              <TableCell>Serv2 Data Transmitted</TableCell>
              <TableCell>Serv2 Data Queue</TableCell>
              <TableCell>Updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stats.map(row => (
              <TableRow key={row.imei}>
                <TableCell>{row.deviceName || row.imei}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={row.isConnected ? 'Online' : 'Offline'}
                    color={row.isConnected ? 'primary' : 'default'}
                    variant={row.isConnected ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell>{row.serv1Transmitted ?? '-'}</TableCell>
                <TableCell>
                  {row.serv1Queue ?? '-'}
                  {typeof row.serv1Queue === 'number' && row.serv1Queue < 20 && (
                    <Chip
                      size="small"
                      label="COMPLETED"
                      color="success"
                      sx={{ ml: 1, backgroundColor: 'success.light', color: 'success.contrastText' }}
                    />
                  )}
                </TableCell>
                <TableCell>{row.serv2Transmitted ?? '-'}</TableCell>
                <TableCell>
                  {row.serv2Queue ?? '-'}
                  {typeof row.serv2Queue === 'number' && row.serv2Queue < 20 && (
                    <Chip
                      size="small"
                      label="COMPLETED"
                      color="success"
                      sx={{ ml: 1, backgroundColor: 'success.light', color: 'success.contrastText' }}
                    />
                  )}
                </TableCell>
                <TableCell>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}</TableCell>
              </TableRow>
            ))}
            {stats.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No archive stats yet.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
};

export default ArchiveStat;
