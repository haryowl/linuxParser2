import React, { useState, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Box,
    CircularProgress,
    TextField,
    InputAdornment,
    Alert,
    Button
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useSnackbar } from 'notistack';
import { BASE_URL } from '../services/api';

const DataTable = () => {
    const { enqueueSnackbar } = useSnackbar();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchRecords();
        // Set up polling every 30 seconds
        const interval = setInterval(fetchRecords, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchRecords = async () => {
        try {
            const apiUrl = BASE_URL;
            const response = await fetch(`${apiUrl}/api/records?range=24h&limit=500`);
            if (!response.ok) {
                throw new Error('Failed to fetch records');
            }
            const data = await response.json();
            setRecords(data);
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('Error fetching records:', err);
            setError(err.message);
            enqueueSnackbar('Failed to load records', { variant: 'error' });
            setLoading(false);
        }
    };

    const filteredRecords = records.filter(record => {
        const searchString = searchTerm.toLowerCase();
        return (
            record.deviceImei?.toLowerCase().includes(searchString) ||
            record.timestamp?.toLowerCase().includes(searchString)
        );
    });

    const getInputVoltage = (record, index) => {
        const voltageFields = [
            record.inputVoltage0,
            record.inputVoltage1,
            record.inputVoltage2,
            record.inputVoltage3,
            record.inputVoltage4,
            record.inputVoltage5,
            record.inputVoltage6
        ];
        const value = voltageFields[index] || 0;
        return value ? `${value}V` : '0V';
    };

    const getInputState = (record, index) => {
        const inputFields = [
            record.input0,
            record.input1,
            record.input2,
            record.input3
        ];
        return inputFields[index] ? 'ON' : 'OFF';
    };

    const getUserData = (record, index) => {
        const userDataFields = [
            record.userData0,
            record.userData1,
            record.userData2,
            record.userData3,
            record.userData4,
            record.userData5,
            record.userData6,
            record.userData7
        ];
        return userDataFields[index] || 0;
    };

    const getModbusData = (record, index) => {
        const modbusFields = [
            record.modbus0,
            record.modbus1,
            record.modbus2,
            record.modbus3,
            record.modbus4,
            record.modbus5,
            record.modbus6,
            record.modbus7,
            record.modbus8,
            record.modbus9,
            record.modbus10,
            record.modbus11,
            record.modbus12,
            record.modbus13,
            record.modbus14,
            record.modbus15
        ];
        return modbusFields[index] || 0;
    };

    const handleExport = async () => {
        try {
            const fields = [
                'timestamp',
                'deviceImei',
                'recordNumber',
                'latitude',
                'longitude',
                'speed',
                'direction',
                'status',
                'supplyVoltage',
                'batteryVoltage',
                'inputVoltage0', 'inputVoltage1', 'inputVoltage2', 'inputVoltage3', 'inputVoltage4', 'inputVoltage5', 'inputVoltage6',
                'input0', 'input1', 'input2', 'input3',
                'userData0', 'userData1', 'userData2', 'userData3', 'userData4', 'userData5', 'userData6', 'userData7',
                'modbus0', 'modbus1', 'modbus2', 'modbus3', 'modbus4', 'modbus5', 'modbus6', 'modbus7', 'modbus8', 'modbus9', 'modbus10', 'modbus11', 'modbus12', 'modbus13', 'modbus14', 'modbus15'
            ];
            const apiUrl = BASE_URL;
            const response = await fetch(`${apiUrl}/api/records/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    format: 'csv',
                    fields,
                })
            });
            if (!response.ok) throw new Error('Failed to export data');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'data-export.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            alert('Error exporting data: ' + err.message);
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box p={3}>
                <Alert severity="error">
                    Error loading data: {error}
                </Alert>
            </Box>
        );
    }

    return (
        <Box p={3}>
            <Typography variant="h4" gutterBottom>
                Device Data Records
            </Typography>
            
            <Button
                variant="contained"
                color="primary"
                startIcon={<FileDownloadIcon />}
                onClick={handleExport}
                sx={{ mb: 2 }}
            >
                Export to CSV
            </Button>

            <TextField
                fullWidth
                variant="outlined"
                placeholder="Search by IMEI or timestamp..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                margin="normal"
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchIcon />
                        </InputAdornment>
                    ),
                }}
            />

            {filteredRecords.length === 0 ? (
                <Box mt={2}>
                    <Alert severity="info">No records found</Alert>
                </Box>
            ) : (
                <TableContainer component={Paper} sx={{ mt: 2 }}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Timestamp</TableCell>
                                <TableCell>Device IMEI</TableCell>
                                <TableCell>Record Number</TableCell>
                                <TableCell>Coordinates</TableCell>
                                <TableCell>Speed</TableCell>
                                <TableCell>Direction</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Voltages</TableCell>
                                <TableCell>Inputs</TableCell>
                                <TableCell>User Data</TableCell>
                                <TableCell>Modbus</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredRecords.map((record) => (
                                <TableRow key={record.id}>
                                    <TableCell>{new Date(record.timestamp).toLocaleString()}</TableCell>
                                    <TableCell>{record.deviceImei}</TableCell>
                                    <TableCell>{record.recordNumber}</TableCell>
                                    <TableCell>
                                        {record.latitude && record.longitude
                                            ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}`
                                            : '0, 0'}
                                    </TableCell>
                                    <TableCell>{record.speed ? `${record.speed} km/h` : '0 km/h'}</TableCell>
                                    <TableCell>{record.direction ? `${record.direction}°` : '0°'}</TableCell>
                                    <TableCell>
                                        <Box>
                                            <Typography variant="caption" display="block">
                                                Status: {record.status || '0'}
                                            </Typography>
                                            <Typography variant="caption" display="block">
                                                Supply: {record.supplyVoltage ? `${record.supplyVoltage}V` : '0V'}
                                            </Typography>
                                            <Typography variant="caption" display="block">
                                                Battery: {record.batteryVoltage ? `${record.batteryVoltage}V` : '0V'}
                                            </Typography>
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Box>
                                            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                                                <Typography key={i} variant="caption" display="block">
                                                    Input {i}: {getInputVoltage(record, i) || '0V'}
                                                </Typography>
                                            ))}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Box>
                                            {[0, 1, 2, 3].map((i) => (
                                                <Typography key={i} variant="caption" display="block">
                                                    Input {i}: {getInputState(record, i)}
                                                </Typography>
                                            ))}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Box>
                                            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                                                <Typography key={i} variant="caption" display="block">
                                                    User {i}: {getUserData(record, i) || 0}
                                                </Typography>
                                            ))}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Box>
                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
                                                <Typography key={i} variant="caption" display="block">
                                                    Modbus {i}: {getModbusData(record, i) || 0}
                                                </Typography>
                                            ))}
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};

export default DataTable; 