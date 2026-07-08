// frontend/src/services/api.js

import { BASE_URL as API_BASE_URL } from '../config/apiUrl';

export const BASE_URL = API_BASE_URL;
export { getWebSocketUrl } from '../config/apiUrl';

// Helper function to get auth headers (for cookie-based auth, we don't need Authorization header)
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}

// Helper function for authenticated requests
export async function authenticatedFetch(url, options = {}) {
  // Construct full URL if it's a relative path
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  
  const response = await fetch(fullUrl, {
    ...options,
    credentials: 'include', // Include cookies in all requests
    headers: {
      ...getAuthHeaders(),
      ...options.headers
    }
  });
  
  // Don't automatically redirect on 401 - let components handle it
  return response;
}

export async function fetchDashboardData() {
  const response = await authenticatedFetch(`${BASE_URL}/api/dashboard`);
  return response;
}

export async function fetchDeviceData(deviceId) {
  const response = await authenticatedFetch(`${BASE_URL}/api/devices/${deviceId}`);
  return response;
}

export async function fetchDevices() {
  const response = await authenticatedFetch(`${BASE_URL}/api/devices`);
  return response;
}

export async function apiFetchDevices() {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/devices`);
    const data = await response.json();
    
    if (response.ok) {
      return {
        success: true,
        data: data
      };
    } else {
      return {
        success: false,
        message: data.message || 'Failed to fetch devices'
      };
    }
  } catch (error) {
    console.error('Error fetching devices:', error);
    return {
      success: false,
      message: 'Network error while fetching devices'
    };
  }
}

// Simple version that returns raw data (for consistency with device groups API)
export async function apiFetchDevicesRaw() {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/devices`);
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.message || 'Failed to fetch devices');
    }
  } catch (error) {
    console.error('Error fetching devices:', error);
    throw error;
  }
}

export async function updateDeviceMapping(deviceId, mapping) {
  const response = await authenticatedFetch(`${BASE_URL}/api/devices/${deviceId}/mapping`, {
    method: 'PUT',
    body: JSON.stringify(mapping),
  });
  return response;
}

export async function fetchAlerts() {
  const response = await authenticatedFetch(`${BASE_URL}/api/alerts`);
  return response;
}

export async function createAlert(alert) {
  const response = await authenticatedFetch(`${BASE_URL}/api/alerts`, {
    method: 'POST',
    body: JSON.stringify(alert),
  });
  return response;
}

export async function updateAlert(alertId, alert) {
  const response = await authenticatedFetch(`${BASE_URL}/api/alerts/${alertId}`, {
    method: 'PUT',
    body: JSON.stringify(alert),
  });
  return response;
}

export async function deleteAlert(alertId) {
  const response = await authenticatedFetch(`${BASE_URL}/api/alerts/${alertId}`, {
    method: 'DELETE',
  });
  return response;
}

export async function fetchMappings() {
  const response = await authenticatedFetch(`${BASE_URL}/api/mappings`);
  return response;
}

export async function createMapping(mapping) {
  const response = await authenticatedFetch(`${BASE_URL}/api/mappings`, {
    method: 'POST',
    body: JSON.stringify(mapping),
  });
  return response;
}

export async function updateMapping(mappingId, mapping) {
  const response = await authenticatedFetch(`${BASE_URL}/api/mappings/${mappingId}`, {
    method: 'PUT',
    body: JSON.stringify(mapping),
  });
  return response;
}

export async function deleteMapping(mappingId) {
  const response = await authenticatedFetch(`${BASE_URL}/api/mappings/${mappingId}`, {
    method: 'DELETE',
  });
  return response;
}

export async function fetchSettings() {
  const response = await authenticatedFetch(`${BASE_URL}/api/settings`);
  return response;
}

export async function updateSettings(settings) {
  const response = await authenticatedFetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
  return response;
}

export async function fetchDataForwarderConfig() {
  const response = await authenticatedFetch(`${BASE_URL}/api/settings/data-forwarder`);
  return response;
}

export async function updateDataForwarderConfig(config) {
  const response = await authenticatedFetch(`${BASE_URL}/api/settings/data-forwarder`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return response;
}

export async function fetchDataForwarderLogs() {
  const response = await authenticatedFetch(`${BASE_URL}/api/settings/data-forwarder/logs`);
  return response;
}

export async function fetchRetentionConfig() {
  return authenticatedFetch(`${BASE_URL}/api/settings/retention`);
}

export async function updateRetentionConfig(config) {
  return authenticatedFetch(`${BASE_URL}/api/settings/retention`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function runRetentionPurge() {
  return authenticatedFetch(`${BASE_URL}/api/settings/retention/purge`, {
    method: 'POST',
  });
}

export async function fetchStorageConfig() {
  return authenticatedFetch(`${BASE_URL}/api/settings/storage`);
}

export async function updateStorageConfig(config) {
  return authenticatedFetch(`${BASE_URL}/api/settings/storage`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function runStorageCleanup(section) {
  const suffix = section ? `/${section}` : '';
  return authenticatedFetch(`${BASE_URL}/api/settings/storage/cleanup${suffix}`, {
    method: 'POST',
  });
}

export async function startAsyncExport(payload) {
  return authenticatedFetch(`${BASE_URL}/api/records/export/async`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchExportJobStatus(jobId) {
  return authenticatedFetch(`${BASE_URL}/api/records/export/jobs/${jobId}`);
}

export function getExportJobDownloadUrl(jobId) {
  return `${BASE_URL}/api/records/export/jobs/${jobId}/download`;
}

// Device Group Management API Functions
// Returns { success, data, message } — never throws (Devices page must load even if groups fail).
export async function apiFetchDeviceGroups() {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups`);
    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        data: Array.isArray(data) ? data : []
      };
    }

    return {
      success: false,
      data: [],
      message: data.error || 'Failed to fetch device groups'
    };
  } catch (error) {
    console.error('Error fetching device groups:', error);
    return {
      success: false,
      data: [],
      message: 'Network error while fetching device groups'
    };
  }
}

// Device Commands API Functions
export async function apiFetchCommandList() {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/command-list`);
  return response;
}

export async function apiFetchCommandPresets(deviceId) {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/${deviceId}/presets`);
  return response;
}

export async function apiFetchCommandHistory(deviceId) {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/${deviceId}/history`);
  return response;
}

export async function apiSendDeviceCommand(deviceId, payload) {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/${deviceId}/send`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response;
}

export async function apiSendDeviceCommandsBulk(deviceIds, payload) {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/send-bulk`, {
    method: 'POST',
    body: JSON.stringify({ deviceIds, ...payload })
  });
  return response;
}

export async function apiFetchArchiveStats() {
  const response = await authenticatedFetch(`${BASE_URL}/api/device-commands/archivestat`);
  return response;
}

export async function apiCreateDeviceGroup(groupData) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups`, {
      method: 'POST',
      body: JSON.stringify(groupData),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to create device group');
    }
  } catch (error) {
    console.error('Error creating device group:', error);
    throw error;
  }
}

export async function apiUpdateDeviceGroup(groupId, groupData) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(groupData),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to update device group');
    }
  } catch (error) {
    console.error('Error updating device group:', error);
    throw error;
  }
}

export async function apiDeleteDeviceGroup(groupId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups/${groupId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to delete device group');
    }
  } catch (error) {
    console.error('Error deleting device group:', error);
    throw error;
  }
}

export async function apiAddDeviceToGroup(groupId, deviceId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups/${groupId}/devices`, {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to add device to group');
    }
  } catch (error) {
    console.error('Error adding device to group:', error);
    throw error;
  }
}

export async function apiRemoveDeviceFromGroup(groupId, deviceId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/device-groups/${groupId}/devices/${deviceId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to remove device from group');
    }
  } catch (error) {
    console.error('Error removing device from group:', error);
    throw error;
  }
}

// User Device Group Access API Functions
export async function apiFetchUserDeviceGroupAccess() {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access`);
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to fetch user device group access');
    }
  } catch (error) {
    console.error('Error fetching user device group access:', error);
    throw error;
  }
}

export async function apiFetchUserDeviceGroupAccessByUser(userId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access/user/${userId}`);
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to fetch user device group access');
    }
  } catch (error) {
    console.error('Error fetching user device group access:', error);
    throw error;
  }
}

export async function apiFetchUserDeviceGroupAccessByGroup(groupId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access/group/${groupId}`);
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to fetch device group access');
    }
  } catch (error) {
    console.error('Error fetching device group access:', error);
    throw error;
  }
}

export async function apiGrantUserDeviceGroupAccess(accessData) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access`, {
      method: 'POST',
      body: JSON.stringify(accessData),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to grant user device group access');
    }
  } catch (error) {
    console.error('Error granting user device group access:', error);
    throw error;
  }
}

export async function apiUpdateUserDeviceGroupAccess(accessId, accessData) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access/${accessId}`, {
      method: 'PUT',
      body: JSON.stringify(accessData),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to update user device group access');
    }
  } catch (error) {
    console.error('Error updating user device group access:', error);
    throw error;
  }
}

export async function apiRevokeUserDeviceGroupAccess(accessId) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access/${accessId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to revoke user device group access');
    }
  } catch (error) {
    console.error('Error revoking user device group access:', error);
    throw error;
  }
}

export async function apiBulkGrantUserDeviceGroupAccess(bulkData) {
  try {
    const response = await authenticatedFetch(`${BASE_URL}/api/user-device-group-access/bulk`, {
      method: 'POST',
      body: JSON.stringify(bulkData),
    });
    const data = await response.json();
    
    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || 'Failed to bulk grant user device group access');
    }
  } catch (error) {
    console.error('Error bulk granting user device group access:', error);
    throw error;
  }
}

// Add more API functions as needed
