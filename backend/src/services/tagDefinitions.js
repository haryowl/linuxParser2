// backend/src/services/tagDefinitions.js

const tagDefinitions = {
    // Basic Device Information
    '0x01': {
        name: 'Hardware Version',
        type: 'uint8',
        length: 1,
        description: 'Hardware version of the device'
    },
    '0x02': {
        name: 'Firmware Version',
        type: 'uint8',
        length: 1,
        description: 'Firmware version of the device'
    },
    '0x03': {
        name: 'IMEI',
        type: 'string',
        length: 15,
        description: 'IMEI number of the device'
    },
    '0x04': {
        name: 'Device Identifier',
        type: 'uint16',
        length: 2,
        description: 'Identifier of the device'
    },

    // Command Tags
    '0xE0': {
        name: 'Command Number',
        type: 'uint32',
        length: 4,
        description: 'Command identifier'
    },
    '0xE1': {
        name: 'Command Text/Reply',
        type: 'string',
        length: null,
        description: 'Command text or reply string'
    },
    '0xEB': {
        name: 'Command Binary Data',
        type: 'bytes',
        length: null,
        description: 'Command reply binary payload'
    },

    // Archive and Time Information
    '0x10': {
        name: 'Archive Record Number',
        type: 'uint16',
        length: 2,
        description: 'Sequential number of archive record'
    },
    '0x20': {
        name: 'Date Time',
        type: 'datetime',
        length: 4,
        description: 'Date and time in Unix timestamp format'
    },
    '0x21': {
        name: 'Milliseconds',
        type: 'uint16',
        length: 2,
        description: 'Milliseconds (0-999) to complete date and time value'
    },

    // Location and Navigation
    '0x30': {
        name: 'Coordinates',
        type: 'coordinates',
        length: 9,
        description: 'GPS/GLONASS coordinates and satellites info'
    },
    '0x33': {
        name: 'Speed and Direction',
        type: 'speedDirection',
        length: 4,
        description: 'Speed in km/h and direction in degrees'
    },
    '0x34': {
        name: 'Height',
        type: 'int16',
        length: 2,
        description: 'Height above sea level in meters'
    },
    '0x35': {
        name: 'HDOP',
        type: 'uint8',
        length: 1,
        description: 'HDOP or cellular location error in meters'
    },

    // Device Status
    '0x40': {
        name: 'Status',
        type: 'status',
        length: 2,
        description: 'Device status bits'
    },
    '0x41': {
        name: 'Supply Voltage',
        type: 'uint16',
        length: 2,
        description: 'Supply voltage in mV'
    },
    '0x42': {
        name: 'Battery Voltage',
        type: 'uint16',
        length: 2,
        description: 'Battery voltage in mV'
    },
    '0x43': {
        name: 'Inside Temperature',
        type: 'int8',
        length: 1,
        description: 'Internal temperature in °C'
    },
    '0x44': {
        name: 'Acceleration',
        type: 'uint32',
        length: 4,
        description: 'Acceleration'
    },
    '0x45': {
        name: 'Status of outputs',
        type: 'outputs',
        length: 2,
        description: 'Status of outputs (each bit represents an output state)'
    },
    '0x46': {
        name: 'Status of inputs',
        type: 'inputs',
        length: 2,
        description: 'Status of inputs (each bit represents an input state)'
    },
    '0x47': {
        name: 'ECO and driving style',
        type: 'uint32',
        length: 4,
        description: 'ECO and driving style'
    },
    '0x48': {
        name: 'Expanded status of the device',
        type: 'uint16',
        length: 2,
        description: 'Expanded status of the device'
    },
    '0x49': {
        name: 'Transmission channel',
        type: 'uint8',
        length: 1,
        description: 'Transmission channel'
    },
    '0x50': {
        name: 'Input voltage 0',
        type: 'uint16',
        length: 2,
        description: 'Input voltage 0'
    },
    '0x51': {
        name: 'Input voltage 1',
        type: 'uint16',
        length: 2,
        description: 'Input voltage 1'
    },
    '0x52': {
        name: 'Input voltage 2',
        type: 'uint16',
        length: 2,
        description: 'Input voltage 2'
    },
    '0x53': {
        name: 'Input voltage 3',
        type: 'uint16',
        length: 2,
        description: 'Input voltage 3'
    },
    '0x54': {
        name: 'Input 4 Values',
        type: 'uint16',
        length: 2,
        description: 'Input 4 Values'
    },
    '0x55': {
        name: 'Input 5 Values',
        type: 'uint16',
        length: 2,
        description: 'Input 5 Values'
    },
    '0x56': {
        name: 'Input 6 Values',
        type: 'uint16',
        length: 2,
        description: 'Input 6 Values'
    },
    '0x57': {
        name: 'Input 7 Values',
        type: 'uint16',
        length: 2,
        description: 'Input 7 Values'
    },
    '0x58': {
        name: 'RS232 0',
        type: 'uint16',
        length: 2,
        description: 'RS232 0'
    },
    '0x59': {
        name: 'RS232 1',
        type: 'uint16',
        length: 2,
        description: 'RS232 1'
    },
    '0x60': {
        name: 'GSM Network Code',
        type: 'uint32',
        length: 4,
        description: 'GSM network code (extended)'
    },
    '0x61': {
        name: 'GSM Location Area Code',
        type: 'uint32',
        length: 4,
        description: 'GSM location area code (extended)'
    },
    '0x62': {
        name: 'GSM Signal Level',
        type: 'uint8',
        length: 1,
        description: 'GSM signal level (0-31)'
    },
    '0x63': {
        name: 'GSM Cell ID',
        type: 'uint16',
        length: 2,
        description: 'GSM cell identifier'
    },
    '0x64': {
        name: 'GSM Area Code',
        type: 'uint16',
        length: 2,
        description: 'GSM area code'
    },
    '0x65': {
        name: 'GSM Operator Code',
        type: 'uint16',
        length: 2,
        description: 'GSM operator code'
    },
    '0x66': {
        name: 'GSM Base Station',
        type: 'uint16',
        length: 2,
        description: 'GSM base station identifier'
    },
    '0x67': {
        name: 'GSM Country Code',
        type: 'uint16',
        length: 2,
        description: 'GSM country code'
    },
    '0x68': {
        name: 'GSM Network Code',
        type: 'uint16',
        length: 2,
        description: 'GSM network code'
    },
    '0x69': {
        name: 'GSM Location Area Code',
        type: 'uint16',
        length: 2,
        description: 'GSM location area code'
    },
    '0x70': {
        name: 'GSM Location Area Code',
        type: 'uint32',
        length: 4,
        description: 'GSM location area code (extended)'
    },
    '0x71': {
        name: 'GSM Signal Level',
        type: 'uint8',
        length: 1,
        description: 'GSM signal level (0-31)'
    },
    '0x72': {
        name: 'GSM Cell ID',
        type: 'uint16',
        length: 2,
        description: 'GSM cell identifier'
    },
    '0x73': {
        name: 'Temperature Sensor',
        type: 'int16',
        length: 2,
        description: 'Temperature sensor reading in °C'
    },
    '0x74': {
        name: 'Humidity Sensor',
        type: 'uint8',
        length: 1,
        description: 'Humidity sensor reading in %'
    },
    '0x75': {
        name: 'Pressure Sensor',
        type: 'uint16',
        length: 2,
        description: 'Pressure sensor reading in hPa'
    },
    '0x76': {
        name: 'Light Sensor',
        type: 'uint16',
        length: 2,
        description: 'Light sensor reading in lux'
    },
    '0x77': {
        name: 'Accelerometer',
        type: 'int16',
        length: 2,
        description: 'Accelerometer readings (X, Y, Z) in m/s²'
    },
    '0x78': {
        name: 'Input 8 Value',
        type: 'int16',
        length: 2,
        description: 'Input 8 Value'
    },
    '0x79': {
        name: 'Input 9 Value',
        type: 'int16',
        length: 2,
        description: 'Input 9 Value'
    },
    '0x7a': {
        name: 'Input 10 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 10 Value'
    },
    '0x7b': {
        name: 'Input 11 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 11 Value'
    },
    '0x7c': {
        name: 'Input 12 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 12 Value'
    },
    '0x7d': {
        name: 'Input 13 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 13 Value'
    },
    '0x7e': {
        name: 'Input 14 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 14 Value'
    },
    '0x7f': {
        name: 'Input 15 Value',
        type: 'uint16',
        length: 2,
        description: 'Input 15 Value'
    },
    '0x5a': {
        name: 'CAN 16-bit register 0',
        type: 'uint16',
        length: 2,
        description: 'CAN 16-bit register 0'
    },
    '0x5b': {
        name: 'CAN variable block',
        type: 'bytes',
        length: 7,
        description: 'CAN variable-length block'
    },
    '0x5c': {
        name: 'CAN 68-byte block',
        type: 'bytes',
        length: 68,
        description: 'CAN 68-byte data block'
    },
    '0x5d': {
        name: 'CAN 3-byte value',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value'
    },
    '0x5e': {
        name: 'CAN 3-byte value',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value'
    },
    '0x5f': {
        name: 'CAN 3-byte value',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value'
    },
    '0x6f': {
        name: 'CAN 3-byte value',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value'
    },
    '0x80': {
        name: 'CAN 3-byte value 0',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 0'
    },
    '0x81': {
        name: 'CAN 3-byte value 1',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 1'
    },
    '0x82': {
        name: 'CAN 3-byte value 2',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 2'
    },
    '0x83': {
        name: 'CAN 3-byte value 3',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 3'
    },
    '0x84': {
        name: 'CAN 3-byte value 4',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 4'
    },
    '0x85': {
        name: 'CAN 3-byte value 5',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 5'
    },
    '0x86': {
        name: 'CAN 3-byte value 6',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 6'
    },
    '0x87': {
        name: 'CAN 3-byte value 7',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value 7'
    },
    '0x88': {
        name: 'CAN 8-bit register 16',
        type: 'uint8',
        length: 1,
        description: 'CAN 8-bit register 16'
    },
    '0x89': {
        name: 'CAN 8-bit register 17',
        type: 'uint8',
        length: 1,
        description: 'CAN 8-bit register 17'
    },
    '0x8a': {
        name: 'CAN 8-bit register 18',
        type: 'uint8',
        length: 1,
        description: 'CAN 8-bit register 18'
    },
    '0x8b': {
        name: 'CAN 8-bit register 19',
        type: 'uint8',
        length: 1,
        description: 'CAN 8-bit register 19'
    },
    '0x8c': {
        name: 'CAN 8-bit register 20',
        type: 'uint8',
        length: 1,
        description: 'CAN 8-bit register 20'
    },
    '0x90': {
        name: 'Driver unique ID',
        type: 'uint32',
        length: 4,
        description: 'Driver unique identifier (iButton / RFID)'
    },
    '0xa0': { name: 'CAN 8-bit R15', type: 'uint8', length: 1, description: 'CAN 8-bit register 15' },
    '0xa1': { name: 'CAN 8-bit R16', type: 'uint8', length: 1, description: 'CAN 8-bit register 16' },
    '0xa2': { name: 'CAN 8-bit R17', type: 'uint8', length: 1, description: 'CAN 8-bit register 17' },
    '0xa3': { name: 'CAN 8-bit R18', type: 'uint8', length: 1, description: 'CAN 8-bit register 18' },
    '0xa4': { name: 'CAN 8-bit R19', type: 'uint8', length: 1, description: 'CAN 8-bit register 19' },
    '0xa5': { name: 'CAN 8-bit R20', type: 'uint8', length: 1, description: 'CAN 8-bit register 20' },
    '0xa6': { name: 'CAN 8-bit R21', type: 'uint8', length: 1, description: 'CAN 8-bit register 21' },
    '0xa7': { name: 'CAN 8-bit R22', type: 'uint8', length: 1, description: 'CAN 8-bit register 22' },
    '0xa8': { name: 'CAN 8-bit R23', type: 'uint8', length: 1, description: 'CAN 8-bit register 23' },
    '0xa9': { name: 'CAN 8-bit R24', type: 'uint8', length: 1, description: 'CAN 8-bit register 24' },
    '0xaa': { name: 'CAN 8-bit R25', type: 'uint8', length: 1, description: 'CAN 8-bit register 25' },
    '0xab': { name: 'CAN 8-bit R26', type: 'uint8', length: 1, description: 'CAN 8-bit register 26' },
    '0xac': { name: 'CAN 8-bit R27', type: 'uint8', length: 1, description: 'CAN 8-bit register 27' },
    '0xad': { name: 'CAN 8-bit R28', type: 'uint8', length: 1, description: 'CAN 8-bit register 28' },
    '0xae': { name: 'CAN 8-bit R29', type: 'uint8', length: 1, description: 'CAN 8-bit register 29' },
    '0xaf': { name: 'CAN 8-bit R30', type: 'uint8', length: 1, description: 'CAN 8-bit register 30' },
    '0xb0': { name: 'CAN 16-bit R5', type: 'uint16', length: 2, description: 'CAN 16-bit register 5' },
    '0xb1': { name: 'CAN 16-bit R6', type: 'uint16', length: 2, description: 'CAN 16-bit register 6' },
    '0xb2': { name: 'CAN 16-bit R7', type: 'uint16', length: 2, description: 'CAN 16-bit register 7' },
    '0xb3': { name: 'CAN 16-bit R8', type: 'uint16', length: 2, description: 'CAN 16-bit register 8' },
    '0xb4': { name: 'CAN 16-bit R9', type: 'uint16', length: 2, description: 'CAN 16-bit register 9' },
    '0xb5': { name: 'CAN 16-bit R10', type: 'uint16', length: 2, description: 'CAN 16-bit register 10' },
    '0xb6': { name: 'CAN 16-bit R11', type: 'uint16', length: 2, description: 'CAN 16-bit register 11' },
    '0xb7': { name: 'CAN 16-bit R12', type: 'uint16', length: 2, description: 'CAN 16-bit register 12' },
    '0xb8': { name: 'CAN 16-bit R13', type: 'uint16', length: 2, description: 'CAN 16-bit register 13' },
    '0xb9': { name: 'CAN 16-bit R14', type: 'uint16', length: 2, description: 'CAN 16-bit register 14' },
    '0xc0': {
        name: 'Fuel total',
        type: 'uint32',
        length: 4,
        description: 'Total fuel consumed (0.5 L units)'
    },
    '0xc1': {
        name: 'Fuel level / temp / RPM',
        type: 'bytes',
        length: 4,
        description: 'Fuel level, temperature, and RPM composite'
    },
    '0xc2': { name: 'CAN B0', type: 'uint32', length: 4, description: 'CAN 32-bit register B0' },
    '0xc3': { name: 'CAN B1', type: 'uint32', length: 4, description: 'CAN 32-bit register B1' },
    '0xc4': { name: 'CAN 8-bit R0', type: 'uint8', length: 1, description: 'CAN 8-bit register 0' },
    '0xc5': { name: 'CAN 8-bit R1', type: 'uint8', length: 1, description: 'CAN 8-bit register 1' },
    '0xc6': { name: 'CAN 8-bit R2', type: 'uint8', length: 1, description: 'CAN 8-bit register 2' },
    '0xc7': { name: 'CAN 8-bit R3', type: 'uint8', length: 1, description: 'CAN 8-bit register 3' },
    '0xc8': { name: 'CAN 8-bit R4', type: 'uint8', length: 1, description: 'CAN 8-bit register 4' },
    '0xc9': { name: 'CAN 8-bit R5', type: 'uint8', length: 1, description: 'CAN 8-bit register 5' },
    '0xca': { name: 'CAN 8-bit R6', type: 'uint8', length: 1, description: 'CAN 8-bit register 6' },
    '0xcb': { name: 'CAN 8-bit R7', type: 'uint8', length: 1, description: 'CAN 8-bit register 7' },
    '0xcc': { name: 'CAN 8-bit R8', type: 'uint8', length: 1, description: 'CAN 8-bit register 8' },
    '0xcd': { name: 'CAN 8-bit R9', type: 'uint8', length: 1, description: 'CAN 8-bit register 9' },
    '0xce': { name: 'CAN 8-bit R10', type: 'uint8', length: 1, description: 'CAN 8-bit register 10' },
    '0xcf': { name: 'CAN 8-bit R11', type: 'uint8', length: 1, description: 'CAN 8-bit register 11' },
    '0xd0': { name: 'CAN 8-bit R12', type: 'uint8', length: 1, description: 'CAN 8-bit register 12' },
    '0xd1': { name: 'CAN 8-bit R13', type: 'uint8', length: 1, description: 'CAN 8-bit register 13' },
    '0xd2': { name: 'CAN 8-bit R14', type: 'uint8', length: 1, description: 'CAN 8-bit register 14' },
    '0xd5': { name: 'CAN 8-bit R15', type: 'uint8', length: 1, description: 'CAN 8-bit register 15' },
    '0xd6': { name: 'CAN 16-bit R0', type: 'uint16', length: 2, description: 'CAN 16-bit register 0' },
    '0xd7': { name: 'CAN 16-bit R1', type: 'uint16', length: 2, description: 'CAN 16-bit register 1' },
    '0xd8': { name: 'CAN 16-bit R2', type: 'uint16', length: 2, description: 'CAN 16-bit register 2' },
    '0xd9': { name: 'CAN 16-bit R3', type: 'uint16', length: 2, description: 'CAN 16-bit register 3' },
    '0xda': { name: 'CAN 16-bit R4', type: 'uint16', length: 2, description: 'CAN 16-bit register 4' },
    '0xdb': { name: 'CAN 32-bit R0', type: 'uint32', length: 4, description: 'CAN 32-bit register 0' },
    '0xdc': { name: 'CAN 32-bit R1', type: 'uint32', length: 4, description: 'CAN 32-bit register 1' },
    '0xdd': { name: 'CAN 32-bit R2', type: 'uint32', length: 4, description: 'CAN 32-bit register 2' },
    '0xde': { name: 'CAN 32-bit R3', type: 'uint32', length: 4, description: 'CAN 32-bit register 3' },
    '0xdf': { name: 'CAN 32-bit R4', type: 'uint32', length: 4, description: 'CAN 32-bit register 4' },
    '0xea': {
        name: 'User data array',
        type: 'bytes',
        length: null,
        description: 'Variable-length user data array'
    },
    '0xfa': {
        name: 'CAN 3-byte value',
        type: 'bytes',
        length: 3,
        description: 'CAN 3-byte value'
    },
    '0xfd': {
        name: 'CAN 8-byte block',
        type: 'bytes',
        length: 8,
        description: 'CAN 8-byte data block'
    },
    '0xf0': { name: 'CAN 32-bit R5', type: 'uint32', length: 4, description: 'CAN 32-bit register 5' },
    '0xf1': { name: 'CAN 32-bit R6', type: 'uint32', length: 4, description: 'CAN 32-bit register 6' },
    '0xf2': { name: 'CAN 32-bit R7', type: 'uint32', length: 4, description: 'CAN 32-bit register 7' },
    '0xf3': { name: 'CAN 32-bit R8', type: 'uint32', length: 4, description: 'CAN 32-bit register 8' },
    '0xf4': { name: 'CAN 32-bit R9', type: 'uint32', length: 4, description: 'CAN 32-bit register 9' },
    '0xf5': { name: 'CAN 32-bit R10', type: 'uint32', length: 4, description: 'CAN 32-bit register 10' },
    '0xf6': { name: 'CAN 32-bit R11', type: 'uint32', length: 4, description: 'CAN 32-bit register 11' },
    '0xf7': { name: 'CAN 32-bit R12', type: 'uint32', length: 4, description: 'CAN 32-bit register 12' },
    '0xf8': { name: 'CAN 32-bit R13', type: 'uint32', length: 4, description: 'CAN 32-bit register 13' },
    '0xf9': { name: 'CAN 32-bit R14', type: 'uint32', length: 4, description: 'CAN 32-bit register 14' },
    '0xe2': {
        name: 'User data 0',
        type: 'uint32',
        length: 4,
        description: 'User data 0'
    },
    '0xe3': {
        name: 'User data 1',
        type: 'uint32',
        length: 4,
        description: 'User data 1'
    },
    '0xe4': {
        name: 'User data 2',
        type: 'uint32',
        length: 4,
        description: 'User data 2'
    },
    '0xe5': {
        name: 'User data 3',
        type: 'uint32',
        length: 4,
        description: 'User data 3'
    },
    '0xe6': {
        name: 'User data 4',
        type: 'uint32',
        length: 4,
        description: 'User data 4'
    },
    '0xe7': {
        name: 'User data 5',
        type: 'uint32',
        length: 4,
        description: 'User data 5'
    },
    '0xe8': {
        name: 'User data 6',
        type: 'uint32',
        length: 4,
        description: 'User data 6'
    },
    '0xe9': {
        name: 'User data 7',
        type: 'uint32',
        length: 4,
        description: 'User data 7'
    },
    '0x0001': {
        name: 'Modbus 0',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 0'
    },
    '0x0002': {
        name: 'Modbus 1',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 1'
    },
    '0x0003': {
        name: 'Modbus 2',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 2'
    },
    '0x0004': {
        name: 'Modbus 3',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 3'
    },
    '0x0005': {
        name: 'Modbus 4',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 4'
    },
    '0x0006': {
        name: 'Modbus 5',
        type: 'uint32_modbus',
        length: 4,
        description: 'Modbus 5'
    },
    '0x0007': {
        name: 'Modbus 6',
        type: 'uint32',
        length: 4,
        description: 'Modbus 6'
    },
    '0x0008': {
        name: 'Modbus 7',
        type: 'uint32',
        length: 4,
        description: 'Modbus 7'
    },
    '0x0009': {
        name: 'Modbus 8',
        type: 'uint32',
        length: 4,
        description: 'Modbus 8'
    },
    '0x000a': {
        name: 'Modbus 9',
        type: 'uint32',
        length: 4,
        description: 'Modbus 9'
    },
    '0x000b': {
        name: 'Modbus 10',
        type: 'uint32',
        length: 4,
        description: 'Modbus 10'
    },
    '0x000c': {
        name: 'Modbus 11',
        type: 'uint32',
        length: 4,
        description: 'Modbus 11'
    },
    '0x000d': {
        name: 'Modbus 12',
        type: 'uint32',
        length: 4,
        description: 'Modbus 12'
    },
    '0x000e': {
        name: 'Modbus 13',
        type: 'uint32',
        length: 4,
        description: 'Modbus 13'
    },
    '0x000f': {
        name: 'Modbus 14',
        type: 'uint32',
        length: 4,
        description: 'Modbus 14'
    },
    '0x0010': {
        name: 'Modbus 15',
        type: 'uint32',
        length: 4,
        description: 'Modbus 15'
    },
    '0xd4': {
        name: 'Total Milleage GPS',
        type: 'uint32',
        length: 4,
        description: 'Total Milleage GPS'
    },
	'0xe0': { type: 'uint32', length: 4, description: 'Command identifier' },
'0xe1': { type: 'string', length: null, description: 'Command text or reply string' },
'0xeb': { type: 'bytes', length: null, description: 'Command reply binary payload' }
};

module.exports = tagDefinitions;
