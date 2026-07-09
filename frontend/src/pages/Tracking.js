import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Box,
  Card,
  CardContent,
  Chip,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Slider,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Map as MapIcon,
  Satellite as SatelliteIcon,
  DirectionsBoat as BoatIcon,
  Visibility as VisibilityIcon,
  Water as WaterIcon,
  Public as PublicIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  OpenInNew as OpenInNewIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
  SkipNext as NextIcon,
  SkipPrevious as PrevIcon,
  Speed as SpeedIcon,
  DirectionsCar as CarIcon,
  DirectionsBoat as ShipIcon
} from '@mui/icons-material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import TrackingMapPanel from '../components/tracking/TrackingMapPanel';
import TrackInfoPanel from '../components/tracking/TrackInfoPanel';
import { BASE_URL, fetchDevices } from '../services/api';
import { useSnackbar } from 'notistack';
import { advancedGPSFilter } from '../utils/gpsFilter';
import { decimateTrackPoints, resolveTrackTimestamp } from '../utils/trackDecimation';

const MAX_MAP_POINTS = 4000;

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const Tracking = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [startDate, setStartDate] = useState(new Date(Date.now() - 24 * 60 * 60 * 1000)); // 24 hours ago
  const [endDate, setEndDate] = useState(new Date());
  const [trackingData, setTrackingData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapCenter, setMapCenter] = useState([0, 0]);
  const [mapZoom, setMapZoom] = useState(2);
  const [debugInfo, setDebugInfo] = useState('');
  const [mapType, setMapType] = useState('osm'); // 'osm', 'openseamap', 'satellite'
  // const [deviceLocations, setDeviceLocations] = useState({});
  const [filteringEnabled, setFilteringEnabled] = useState(true);
  const [filteringStats, setFilteringStats] = useState(null);
  const [filteringOptions, setFilteringOptions] = useState({
    maxDistanceKm: 50,
    maxSpeedKmh: 200,
    enableSpeedFilter: true,
    enableDistanceFilter: true,
    enableCoordinateValidation: true
  });

  // Replay functionality state
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [currentReplayIndex, setCurrentReplayIndex] = useState(0);
  const [replayProgress, setReplayProgress] = useState(0);
  const replayIntervalRef = useRef(null);
  const [replayData, setReplayData] = useState([]);

  // GPS icon customization
  const [gpsIconType, setGpsIconType] = useState('default');
  const [showSpeedColors, setShowSpeedColors] = useState(false);
  const [mapDecimationInfo, setMapDecimationInfo] = useState(null);
  const [serverTruncated, setServerTruncated] = useState(false);
  const [mapPointMode, setMapPointMode] = useState('optimized'); // 'optimized' | 'all'

  // Load devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        console.log('Loading devices...');
        const response = await fetchDevices();
        
        if (!response.ok) {
          if (response.status === 401) {
            console.log('User not authenticated, using empty devices array');
            setDevices([]);
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const devicesData = await response.json();
        console.log('Devices loaded:', devicesData);
        setDevices(Array.isArray(devicesData) ? devicesData : []);
        setDebugInfo(`Loaded ${devicesData.length} devices`);
      } catch (error) {
        console.error('Error loading devices:', error);
        setError(`Failed to load devices: ${error.message}`);
        setDebugInfo(`Error: ${error.message}`);
        setDevices([]); // Ensure devices is always an array
      }
    };
    loadDevices();
  }, []);

  // Apply GPS filtering to existing data
  const applyFiltering = () => {
    if (!trackingData || trackingData.length === 0) return;
    
    if (filteringEnabled) {
      const result = advancedGPSFilter(trackingData, filteringOptions);
      setTrackingData(result.filteredData);
      setFilteringStats(result.stats);
      setDebugInfo(`Reapplied filtering: ${result.stats.totalPoints} total points → ${result.stats.filteredPoints} valid points (${result.stats.removalPercentage}% removed)`);
    } else {
      setFilteringStats(null);
      setDebugInfo('Filtering disabled');
    }
  };

  // Load tracking data
  const loadTrackingData = async () => {
    if (!selectedDevice) {
      setError('Please select a device');
      return;
    }

    setLoading(true);
    setError('');
    setDebugInfo('Loading tracking data...');

    try {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });

      // Use the new IMEI-based endpoint that only requires read permission
      const url = `${BASE_URL}/api/data/imei/${selectedDevice}/tracking?${params}`;
      console.log('Fetching tracking data from:', url);

      const response = await fetch(url, {
        credentials: 'include' // Include cookies in the request
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const truncated = response.headers.get('X-Tracking-Truncated') === 'true';
      const maxPoints = response.headers.get('X-Tracking-Max-Points');
      setServerTruncated(truncated);

      const data = await response.json();
      const rawData = Array.isArray(data) ? data : [];
      
      // Apply GPS filtering if enabled
      let processedData = rawData;
      let stats = null;
      
      if (filteringEnabled && rawData.length > 0) {
        const result = advancedGPSFilter(rawData, filteringOptions);
        processedData = result.filteredData;
        stats = result.stats;
        setFilteringStats(stats);
        console.log('GPS filtering applied:', stats);
      } else {
        setFilteringStats(null);
      }
      
      setTrackingData(processedData);
      setDebugInfo(`Loaded ${rawData.length} tracking points${stats ? `, filtered to ${stats.filteredPoints} points (${stats.removalPercentage}% removed)` : ''}`);

      if (truncated) {
        enqueueSnackbar(
          `Track limited to ${maxPoints || 'server max'} points. Narrow the date range for full detail.`,
          { variant: 'warning' }
        );
      } else {
        enqueueSnackbar(`Loaded ${processedData.length} tracking points`, { variant: 'success' });
      }

      if (processedData.length > 0) {
        setMapCenter([processedData[0].latitude, processedData[0].longitude]);
        setMapZoom(13);
      }
    } catch (error) {
      console.error('Error loading tracking data:', error);
      setError(`Failed to load tracking data: ${error.message}`);
      setDebugInfo(`Error: ${error.message}`);
      enqueueSnackbar(`Failed to load tracking data: ${error.message}`, { variant: 'error' });
      setTrackingData([]);
    } finally {
      setLoading(false);
    }
  };

  const mapTrack = useMemo(() => {
    if (mapPointMode === 'all') {
      return {
        points: trackingData,
        decimated: false,
        originalCount: trackingData.length
      };
    }
    return decimateTrackPoints(trackingData, MAX_MAP_POINTS);
  }, [trackingData, mapPointMode]);

  useEffect(() => {
    if (mapTrack.decimated) {
      setMapDecimationInfo({
        original: mapTrack.originalCount,
        displayed: mapTrack.points.length
      });
    } else {
      setMapDecimationInfo(null);
    }
  }, [mapTrack]);

  const trackCoordinates = useMemo(
    () => mapTrack.points.map((point) => [point.latitude, point.longitude]),
    [mapTrack.points]
  );

  const trackSummary = useMemo(() => {
    if (trackingData.length === 0) {
      return null;
    }
    const startTs = resolveTrackTimestamp(trackingData[0]);
    const endTs = resolveTrackTimestamp(trackingData[trackingData.length - 1]);
    return {
      points: trackingData.length,
      startTs,
      endTs,
      durationHours: startTs && endTs
        ? Math.round((new Date(endTs) - new Date(startTs)) / (1000 * 60 * 60))
        : null
    };
  }, [trackingData]);

  // Function to open Marine Traffic with current coordinates
  const openMarineTraffic = () => {
    if (trackingData.length > 0) {
      const centerLat = trackingData[0].latitude;
      const centerLon = trackingData[0].longitude;
      const zoom = 10; // Default zoom level
      const url = `https://www.marinetraffic.com/en/ais/home/centerx:${centerLon}/centery:${centerLat}/zoom:${zoom}`;
      window.open(url, '_blank');
    } else {
      // Default to a general marine traffic view
      const url = 'https://www.marinetraffic.com/en/ais/home/centerx:1.9/centery:51.6/zoom:6';
      window.open(url, '_blank');
    }
  };

  // const fetchDeviceLocations = useCallback(async () => {
  //   try {
  //     const response = await fetch(`${BASE_URL}/api/devices/locations`, {
  //       credentials: 'include' // Include cookies in the request
  //     });
  //     
  //     if (response.ok) {
  //       const locations = await response.json();
  //       setDeviceLocations(locations);
  //     } else {
  //       console.error('Failed to fetch device locations:', response.status);
  //       setDeviceLocations([]);
  //     }
  //   } catch (error) {
  //     console.error('Error fetching device locations:', error);
  //     setDeviceLocations([]);
  //   }
  // };

  // Replay control functions
  const startReplay = () => {
    if (trackingData.length === 0) return;
    
    setIsReplaying(true);
    setCurrentReplayIndex(0);
    setReplayProgress(0);
    setReplayData(trackingData);
    
    const interval = setInterval(() => {
      setCurrentReplayIndex(prevIndex => {
        const nextIndex = prevIndex + 1;
        if (nextIndex >= trackingData.length) {
          setIsReplaying(false);
          clearInterval(interval);
          return prevIndex;
        }
        setReplayProgress((nextIndex / trackingData.length) * 100);
        return nextIndex;
      });
    }, 1000 / replaySpeed); // Adjust interval based on speed
    
    replayIntervalRef.current = interval;
  };

  const pauseReplay = () => {
    setIsReplaying(false);
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
  };

  const stopReplay = () => {
    setIsReplaying(false);
    setCurrentReplayIndex(0);
    setReplayProgress(0);
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
  };

  const nextPoint = () => {
    if (currentReplayIndex < trackingData.length - 1) {
      setCurrentReplayIndex(prev => prev + 1);
      setReplayProgress(((currentReplayIndex + 1) / trackingData.length) * 100);
    }
  };

  const prevPoint = () => {
    if (currentReplayIndex > 0) {
      setCurrentReplayIndex(prev => prev - 1);
      setReplayProgress(((currentReplayIndex - 1) / trackingData.length) * 100);
    }
  };

  const handleReplaySpeedChange = (event, newValue) => {
    setReplaySpeed(newValue);
    if (isReplaying) {
      pauseReplay();
      startReplay();
    }
  };

  const handleReplayProgressChange = (event, newValue) => {
    const newIndex = Math.floor((newValue / 100) * trackingData.length);
    setCurrentReplayIndex(newIndex);
    setReplayProgress(newValue);
  };

  const getCurrentReplayPoint = useCallback(() => {
    if (trackingData.length === 0 || currentReplayIndex >= trackingData.length) {
      return null;
    }
    return trackingData[currentReplayIndex];
  }, [trackingData, currentReplayIndex]);

  const currentReplayPoint = useMemo(
    () => getCurrentReplayPoint(),
    [getCurrentReplayPoint]
  );

  // Update map center when replaying
  useEffect(() => {
    if (isReplaying && currentReplayPoint) {
      setMapCenter([currentReplayPoint.latitude, currentReplayPoint.longitude]);
      setMapZoom(15);
    }
  }, [isReplaying, currentReplayPoint]);

  // Cleanup replay interval on unmount
  useEffect(() => {
    return () => {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    };
  }, []);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Grid container spacing={3}>
        {/* Controls */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              Device Tracking
            </Typography>
            
            {/* Debug Info */}
            {debugInfo && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Debug: {debugInfo}
              </Alert>
            )}

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {serverTruncated && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Server returned a capped number of points. Use a shorter date range for complete tracks.
              </Alert>
            )}

            {mapDecimationInfo && mapPointMode === 'optimized' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Map displays {mapDecimationInfo.displayed.toLocaleString()} of {mapDecimationInfo.original.toLocaleString()} points for smoother rendering.
                Switch to &quot;All points&quot; below to draw every loaded point.
              </Alert>
            )}

            {mapPointMode === 'all' && trackingData.length > 0 && (
              <Alert
                severity={trackingData.length > MAX_MAP_POINTS ? 'warning' : 'info'}
                sx={{ mb: 2 }}
              >
                Map displays all {trackingData.length.toLocaleString()} loaded points.
                {trackingData.length > MAX_MAP_POINTS
                  ? ' Large tracks may slow pan/zoom on this device.'
                  : ''}
              </Alert>
            )}
            
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Device</InputLabel>
                  <Select
                    value={selectedDevice}
                    onChange={(e) => setSelectedDevice(e.target.value)}
                    label="Device"
                  >
                    {devices.map((device) => (
                      <MenuItem key={device.imei} value={device.imei}>
                        {device.name || device.imei}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} md={3}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DateTimePicker
                    label="Start Date"
                    value={startDate}
                    onChange={setStartDate}
                    slotProps={{
                      textField: {
                        fullWidth: true
                      }
                    }}
                  />
                </LocalizationProvider>
              </Grid>
              
              <Grid item xs={12} md={3}>
                <LocalizationProvider dateAdapter={AdapterDateFns}>
                  <DateTimePicker
                    label="End Date"
                    value={endDate}
                    onChange={setEndDate}
                    slotProps={{
                      textField: {
                        fullWidth: true
                      }
                    }}
                  />
                </LocalizationProvider>
              </Grid>
              
              <Grid item xs={12} md={3}>
                <Button
                  variant="contained"
                  onClick={loadTrackingData}
                  disabled={loading || !selectedDevice}
                  fullWidth
                >
                  {loading ? 'Loading...' : 'Load Track'}
                </Button>
              </Grid>
            </Grid>

            {/* GPS Filtering Controls */}
            <Box sx={{ mt: 3, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fafafa' }}>
              <Typography variant="h6" gutterBottom>
                GPS Filtering Options
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Filter out invalid GPS coordinates that are too far from other points or have unrealistic speeds
              </Typography>
              
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel>Enable Filtering</InputLabel>
                    <Select
                      value={filteringEnabled ? 'enabled' : 'disabled'}
                      onChange={(e) => setFilteringEnabled(e.target.value === 'enabled')}
                      label="Enable Filtering"
                    >
                      <MenuItem value="enabled">Enabled</MenuItem>
                      <MenuItem value="disabled">Disabled</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel>Max Distance (km)</InputLabel>
                    <Select
                      value={filteringOptions.maxDistanceKm}
                      onChange={(e) => setFilteringOptions(prev => ({ ...prev, maxDistanceKm: e.target.value }))}
                      label="Max Distance (km)"
                      disabled={!filteringEnabled}
                    >
                      <MenuItem value={10}>10 km</MenuItem>
                      <MenuItem value={25}>25 km</MenuItem>
                      <MenuItem value={50}>50 km</MenuItem>
                      <MenuItem value={100}>100 km</MenuItem>
                      <MenuItem value={200}>200 km</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth>
                    <InputLabel>Max Speed (km/h)</InputLabel>
                    <Select
                      value={filteringOptions.maxSpeedKmh}
                      onChange={(e) => setFilteringOptions(prev => ({ ...prev, maxSpeedKmh: e.target.value }))}
                      label="Max Speed (km/h)"
                      disabled={!filteringEnabled}
                    >
                      <MenuItem value={50}>50 km/h</MenuItem>
                      <MenuItem value={100}>100 km/h</MenuItem>
                      <MenuItem value={200}>200 km/h</MenuItem>
                      <MenuItem value={500}>500 km/h</MenuItem>
                      <MenuItem value={1000}>1000 km/h</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label="Coordinate Validation"
                      color={filteringOptions.enableCoordinateValidation ? "primary" : "default"}
                      onClick={() => setFilteringOptions(prev => ({ 
                        ...prev, 
                        enableCoordinateValidation: !prev.enableCoordinateValidation 
                      }))}
                      disabled={!filteringEnabled}
                      variant={filteringOptions.enableCoordinateValidation ? "filled" : "outlined"}
                    />
                    <Chip
                      label="Distance Filter"
                      color={filteringOptions.enableDistanceFilter ? "primary" : "default"}
                      onClick={() => setFilteringOptions(prev => ({ 
                        ...prev, 
                        enableDistanceFilter: !prev.enableDistanceFilter 
                      }))}
                      disabled={!filteringEnabled}
                      variant={filteringOptions.enableDistanceFilter ? "filled" : "outlined"}
                    />
                    <Chip
                      label="Speed Filter"
                      color={filteringOptions.enableSpeedFilter ? "primary" : "default"}
                      onClick={() => setFilteringOptions(prev => ({ 
                        ...prev, 
                        enableSpeedFilter: !prev.enableSpeedFilter 
                      }))}
                      disabled={!filteringEnabled}
                      variant={filteringOptions.enableSpeedFilter ? "filled" : "outlined"}
                    />
                  </Box>
                </Grid>
                
                <Grid item xs={12} md={2}>
                  <Button
                    variant="outlined"
                    onClick={applyFiltering}
                    disabled={!trackingData || trackingData.length === 0}
                    fullWidth
                  >
                    Reapply Filter
                  </Button>
                </Grid>
              </Grid>

              {/* Filtering Statistics */}
              {filteringStats && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    <strong>Filtering Results:</strong> {filteringStats.totalPoints} total points → {filteringStats.filteredPoints} valid points 
                    ({filteringStats.removedPoints} removed, {filteringStats.removalPercentage}% filtered out)
                  </Typography>
                </Alert>
              )}
            </Box>

            {/* Map display options */}
            <Box sx={{ mt: 3, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fafafa' }}>
              <Typography variant="h6" gutterBottom>
                Map Display Options
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Choose how many GPS points are drawn on the track map after loading
              </Typography>

              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth>
                    <InputLabel>Map Points</InputLabel>
                    <Select
                      value={mapPointMode}
                      onChange={(e) => setMapPointMode(e.target.value)}
                      label="Map Points"
                    >
                      <MenuItem value="optimized">
                        Optimized (max {MAX_MAP_POINTS.toLocaleString()} points)
                      </MenuItem>
                      <MenuItem value="all">
                        All loaded points
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} md={8}>
                  <Typography variant="body2" color="text.secondary">
                    {mapPointMode === 'optimized'
                      ? `Draws up to ${MAX_MAP_POINTS.toLocaleString()} evenly spaced points for smooth map performance.`
                      : trackingData.length > 0
                        ? `Will draw all ${trackingData.length.toLocaleString()} points currently loaded (after GPS filtering).`
                        : 'Will draw every point returned for the selected date range.'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          </Paper>
        </Grid>

        {/* GPS Icon Customization */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              GPS Icon Customization
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Choose the icon type and appearance for GPS markers on the map
            </Typography>
            
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Icon Type</InputLabel>
                  <Select
                    value={gpsIconType}
                    onChange={(e) => setGpsIconType(e.target.value)}
                    label="Icon Type"
                  >
                    <MenuItem value="default">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: '#1976d2' }} />
                        Default
                      </Box>
                    </MenuItem>
                    <MenuItem value="boat">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BoatIcon sx={{ color: '#1976d2' }} />
                        Boat
                      </Box>
                    </MenuItem>
                    <MenuItem value="ship">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ShipIcon sx={{ color: '#2e7d32' }} />
                        Ship
                      </Box>
                    </MenuItem>
                    <MenuItem value="vehicle">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CarIcon sx={{ color: '#ed6c02' }} />
                        Vehicle
                      </Box>
                    </MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} md={3}>
                <FormControl fullWidth>
                  <InputLabel>Speed Colors</InputLabel>
                  <Select
                    value={showSpeedColors ? 'enabled' : 'disabled'}
                    onChange={(e) => setShowSpeedColors(e.target.value === 'enabled')}
                    label="Speed Colors"
                  >
                    <MenuItem value="enabled">Enabled</MenuItem>
                    <MenuItem value="disabled">Disabled</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {showSpeedColors ? 
                    'Icons will change color based on speed: Green (slow), Orange (medium), Red (fast)' :
                    'Icons will use the default color for the selected type'
                  }
                </Typography>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Map Type Selector */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                Map Type
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Choose your preferred map layer for tracking visualization
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                  onClick={openMarineTraffic}
                  size="small"
                  sx={{ 
                    backgroundColor: '#1976d2',
                    color: 'white',
                    '&:hover': {
                      backgroundColor: '#1565c0',
                    }
                  }}
                >
                  Marine Traffic
                </Button>
              </Box>
            </Box>
            <ToggleButtonGroup
              value={mapType}
              exclusive
              onChange={(event, newValue) => {
                if (newValue !== null) {
                  setMapType(newValue);
                }
              }}
              sx={{
                '& .MuiToggleButton-root': {
                  px: 2,
                  py: 1,
                  fontWeight: 600,
                  textTransform: 'none',
                  minWidth: 120,
                  fontSize: '0.8rem'
                },
                flexWrap: 'wrap',
                gap: 1
              }}
            >
              <ToggleButton value="osm" aria-label="osm">
                <MapIcon sx={{ mr: 0.5, fontSize: 16 }} />
                OSM
              </ToggleButton>
              <ToggleButton value="openseamap" aria-label="openseamap">
                <BoatIcon sx={{ mr: 0.5, fontSize: 16 }} />
                SeaMap
              </ToggleButton>
              <ToggleButton value="marine_traffic" aria-label="marine_traffic">
                <VisibilityIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Traffic
              </ToggleButton>
              <ToggleButton value="noaa_charts" aria-label="noaa_charts">
                <PublicIcon sx={{ mr: 0.5, fontSize: 16 }} />
                NOAA
              </ToggleButton>
              <ToggleButton value="emodnet_bathymetry" aria-label="emodnet_bathymetry">
                <WaterIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Bathymetry
              </ToggleButton>
              <ToggleButton value="opencpn_charts" aria-label="opencpn_charts">
                <BoatIcon sx={{ mr: 0.5, fontSize: 16 }} />
                OpenCPN
              </ToggleButton>
              <ToggleButton value="cartodb_dark" aria-label="cartodb_dark">
                <DarkModeIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Dark Marine
              </ToggleButton>
              <ToggleButton value="cartodb_light" aria-label="cartodb_light">
                <LightModeIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Light Marine
              </ToggleButton>
              <ToggleButton value="satellite" aria-label="satellite">
                <SatelliteIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Satellite
              </ToggleButton>
              <ToggleButton value="marine_traffic_web" aria-label="marine_traffic_web">
                <OpenInNewIcon sx={{ mr: 0.5, fontSize: 16 }} />
                Marine Traffic
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {mapType === 'osm' && 'Standard street map with roads and landmarks'}
              {mapType === 'openseamap' && 'Marine navigation map with nautical features and sea marks'}
              {mapType === 'marine_traffic' && 'Voyager style map optimized for marine traffic visualization'}
              {mapType === 'noaa_charts' && 'Light nautical chart style without labels for clean navigation'}
              {mapType === 'emodnet_bathymetry' && 'Dark nautical chart style for depth and bathymetry data'}
              {mapType === 'opencpn_charts' && 'Light nautical chart style with all features for marine navigation'}
              {mapType === 'cartodb_dark' && 'Dark marine chart theme for low-light conditions'}
              {mapType === 'cartodb_light' && 'Light marine chart theme for clear visibility'}
              {mapType === 'satellite' && 'High-resolution satellite imagery'}
              {mapType === 'marine_traffic_web' && 'Open Marine Traffic web interface with real-time vessel tracking'}
            </Typography>
          </Paper>
        </Grid>

        {/* Replay Controls */}
        {trackingData.length > 0 && (
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Track Replay
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Replay the tracking history with customizable speed and controls
              </Typography>
              
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={2}>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                    <Tooltip title="Previous Point">
                      <IconButton 
                        onClick={prevPoint} 
                        disabled={currentReplayIndex === 0}
                        size="small"
                      >
                        <PrevIcon />
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title={isReplaying ? "Pause" : "Play"}>
                      <IconButton 
                        onClick={isReplaying ? pauseReplay : startReplay}
                        disabled={trackingData.length === 0}
                        color="primary"
                        size="small"
                      >
                        {isReplaying ? <PauseIcon /> : <PlayIcon />}
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title="Stop">
                      <IconButton 
                        onClick={stopReplay}
                        disabled={!isReplaying && currentReplayIndex === 0}
                        size="small"
                      >
                        <StopIcon />
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title="Next Point">
                      <IconButton 
                        onClick={nextPoint}
                        disabled={currentReplayIndex >= trackingData.length - 1}
                        size="small"
                      >
                        <NextIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Grid>
                
                <Grid item xs={12} md={3}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SpeedIcon sx={{ fontSize: 16 }} />
                    <Typography variant="body2" sx={{ minWidth: 60 }}>
                      Speed: {replaySpeed}x
                    </Typography>
                    <Slider
                      value={replaySpeed}
                      onChange={handleReplaySpeedChange}
                      min={0.1}
                      max={10}
                      step={0.1}
                      marks={[
                        { value: 0.1, label: '0.1x' },
                        { value: 1, label: '1x' },
                        { value: 5, label: '5x' },
                        { value: 10, label: '10x' }
                      ]}
                      sx={{ flex: 1 }}
                    />
                  </Box>
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 80 }}>
                      Progress: {Math.round(replayProgress)}%
                    </Typography>
                    <Slider
                      value={replayProgress}
                      onChange={handleReplayProgressChange}
                      min={0}
                      max={100}
                      step={0.1}
                      sx={{ flex: 1 }}
                    />
                  </Box>
                </Grid>
                
                <Grid item xs={12} md={3}>
                  <Typography variant="body2" color="text.secondary">
                    {currentReplayPoint ? (
                      <>
                        Point {currentReplayIndex + 1} of {trackingData.length}<br />
                        Time: {resolveTrackTimestamp(currentReplayPoint) ? new Date(resolveTrackTimestamp(currentReplayPoint)).toLocaleString() : 'N/A'}<br />
                        Speed: {currentReplayPoint.speed || 0} km/h
                      </>
                    ) : (
                      'No data available'
                    )}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>
        )}

        <Grid item xs={12} md={8}>
          <TrackingMapPanel
            mapCenter={mapCenter}
            mapZoom={mapZoom}
            mapType={mapType}
            trackCoordinates={trackCoordinates}
            mapTrackPoints={mapTrack.points}
            trackingData={trackingData}
            currentReplayPoint={currentReplayPoint}
            currentReplayIndex={currentReplayIndex}
            isReplaying={isReplaying}
            gpsIconType={gpsIconType}
            showSpeedColors={showSpeedColors}
          />
        </Grid>

        <Grid item xs={12} md={4}>
          <TrackInfoPanel
            trackingData={trackingData}
            trackSummary={trackSummary}
            mapType={mapType}
          />
        </Grid>
      </Grid>
    </Container>
  );
};

export default Tracking; 