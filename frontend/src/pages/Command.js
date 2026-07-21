// frontend/src/pages/Command.js

import React, { Suspense, lazy } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { Box, Paper, Tabs, Tab, CircularProgress } from '@mui/material';
import {
  Science as ScienceIcon,
  Satellite as SatelliteIcon,
  Campaign as CampaignIcon
} from '@mui/icons-material';

const ArchiveStat = lazy(() => import('./ArchiveStat'));
const CommandCenter = lazy(() => import('./CommandCenter'));
const BroadcastCommand = lazy(() => import('./BroadcastCommand'));

const TABS = [
  { value: 'archive-stat', label: 'Archive Stat', icon: <ScienceIcon />, Component: ArchiveStat },
  { value: 'command-center', label: 'Command Center', icon: <SatelliteIcon />, Component: CommandCenter },
  { value: 'broadcast', label: 'Broadcast Command', icon: <CampaignIcon />, Component: BroadcastCommand }
];

function TabLoader() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
      <CircularProgress />
    </Box>
  );
}

const Command = () => {
  const navigate = useNavigate();
  const { tab } = useParams();

  const activeTab = TABS.find((item) => item.value === tab);
  if (!activeTab) {
    return <Navigate to="/command/archive-stat" replace />;
  }

  const { Component } = activeTab;

  return (
    <Box>
      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeTab.value}
          onChange={(event, value) => navigate(`/command/${value}`)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TABS.map((item) => (
            <Tab
              key={item.value}
              value={item.value}
              label={item.label}
              icon={item.icon}
              iconPosition="start"
              sx={{ minHeight: 56, textTransform: 'none', fontWeight: 600 }}
            />
          ))}
        </Tabs>
      </Paper>
      <Suspense fallback={<TabLoader />}>
        <Component />
      </Suspense>
    </Box>
  );
};

export default Command;
